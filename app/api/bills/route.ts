import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { startOfDay, endOfDay } from 'date-fns'
import { sessionTotal, BILLABLE_ORDER_STATUSES } from '@/lib/sessions'
import { billTotalOf, discountAmount, paidTotal } from '@/lib/payments'
import { tendersOf, billStatus } from '@/lib/bills'

export const dynamic = 'force-dynamic'

const BILLABLE = BILLABLE_ORDER_STATUSES as readonly string[]

/**
 * Trading history, one row per BILL.
 *
 * The old history listed orders, which suited a cafe where an order is a
 * customer is a payment. Here 94% of orders belong to a table and a bill runs
 * to 2-6 rounds settled once, so listing rounds showed 531 fragments of 176
 * real transactions - and labelled every one of them CASH, because a table
 * order's paymentMethod is an untouched default while the real tenders are
 * payment rows.
 *
 * Walk-in sales come back in the same list as single-round bills. One history,
 * not two: staff should not have to know which screen a sale ended up on.
 */
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url)
        const startDate = searchParams.get('startDate')
        const endDate = searchParams.get('endDate')
        const waiterId = searchParams.get('waiterId')
        const wanted = searchParams.get('status')
        // Nothing is silently hidden at the volumes this bar trades at. A date filter,
        // not a lower cap, is what this page needs once history runs to months.
        const take = Math.min(Number(searchParams.get('take')) || 500, 500)

        const range: { gte?: Date; lte?: Date } = {}
        if (startDate) range.gte = startOfDay(new Date(startDate))
        if (endDate) range.lte = endOfDay(new Date(endDate))
        const hasRange = Boolean(startDate || endDate)

        const sessions = await prisma.tableSession.findMany({
            where: hasRange ? { openedAt: range } : {},
            orderBy: { openedAt: 'desc' },
            take,
            include: {
                table: { select: { name: true, area: true } },
                customer: { select: { id: true, name: true } },
                payments: true,
                orders: {
                    orderBy: { tableOrderNumber: 'asc' },
                    include: {
                        waiter: { select: { id: true, name: true } },
                        user: { select: { name: true } },
                        items: {
                            include: { voidedBy: { select: { name: true } } },
                        },
                    },
                },
            },
        })

        // A counter sale has no session, so it is its own one-round bill.
        const walkIns = await prisma.order.findMany({
            where: { sessionId: null, ...(hasRange ? { createdAt: range } : {}) },
            orderBy: { createdAt: 'desc' },
            take,
            include: {
                user: { select: { name: true } },
                items: { include: { voidedBy: { select: { name: true } } } },
            },
        })

        const line = (i: any) => ({
            id: i.id,
            name: i.name,
            quantity: i.quantity,
            total: i.total,
            voidedAt: i.voidedAt,
            voidReason: i.voidReason,
            voidNote: i.voidNote,
            voidedBy: i.voidedBy?.name ?? null,
        })

        const tableBills = sessions.map((s) => {
            const billable = s.orders.filter((o) => BILLABLE.includes(o.status))
            const gross = sessionTotal(s.orders)
            const total = billTotalOf(gross, s.discountType, s.discountValue)
            const status = billStatus({
                status: s.status,
                total,
                payments: s.payments,
                customerId: s.customerId,
            })

            return {
                id: s.id,
                kind: 'TABLE' as const,
                reference: s.table.name,
                area: s.table.area,
                openedAt: s.openedAt,
                closedAt: s.closedAt,
                // Named separately: the waiter carried it, the till user keyed it.
                servers: [...new Set(billable.map((o) => o.waiter?.name).filter(Boolean))],
                staff: [...new Set(billable.map((o) => o.user?.name).filter(Boolean))],
                rounds: billable.length,
                items: billable.reduce(
                    (n, o) => n + o.items.filter((i) => !i.voidedAt).reduce((m, i) => m + i.quantity, 0),
                    0
                ),
                voidedLines: s.orders.reduce((n, o) => n + o.items.filter((i) => i.voidedAt).length, 0),
                gross,
                discount: discountAmount(gross, s.discountType, s.discountValue),
                total,
                paid: paidTotal(s.payments),
                tenders: tendersOf(s.payments),
                status,
                customer: s.customer ? { id: s.customer.id, name: s.customer.name } : null,
                detail: s.orders.map((o) => ({
                    id: o.id,
                    number: o.tableOrderNumber,
                    at: o.createdAt,
                    status: o.status,
                    waiter: o.waiter?.name ?? null,
                    total: o.total,
                    items: o.items.map(line),
                })),
            }
        })

        const walkInBills = walkIns.map((o) => {
            const live = o.items.filter((i) => !i.voidedAt)
            // No payment rows on a counter sale - here the method really is on
            // the order, because the cafe flow sets it at the point of paying.
            const tenders =
                o.status === 'COMPLETED' && o.total > 0
                    ? [{ method: o.paymentMethod || 'CASH', amount: o.total }]
                    : []

            return {
                id: o.id,
                kind: 'WALK_IN' as const,
                reference: o.orderNumber,
                area: null as string | null,
                openedAt: o.createdAt,
                closedAt: o.status === 'COMPLETED' ? o.createdAt : null,
                // Nobody carried a counter sale to a table.
                servers: [] as string[],
                staff: o.user?.name ? [o.user.name] : [],
                rounds: 1,
                items: live.reduce((n, i) => n + i.quantity, 0),
                voidedLines: o.items.filter((i) => i.voidedAt).length,
                gross: o.subtotal,
                discount: o.discount ?? 0,
                total: o.total,
                paid: o.status === 'COMPLETED' ? o.total : 0,
                tenders,
                status: o.status === 'CANCELLED' ? 'VOIDED' : o.status === 'COMPLETED' ? 'PAID' : 'OPEN',
                customer: null,
                detail: [{
                    id: o.id,
                    number: null,
                    at: o.createdAt,
                    status: o.status,
                    waiter: null,
                    total: o.total,
                    items: o.items.map(line),
                }],
            }
        })

        let bills = [...tableBills, ...walkInBills].sort(
            (a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime()
        )

        // Filtered after shaping: status is derived, not a column, and a server
        // is on the rounds rather than on the bill.
        if (wanted) bills = bills.filter((b) => b.status === wanted)
        if (waiterId) {
            const name = (await prisma.user.findUnique({ where: { id: waiterId }, select: { name: true } }))?.name
            if (name) bills = bills.filter((b) => b.servers.includes(name))
        }

        return NextResponse.json({
            bills: bills.slice(0, take),
            totals: {
                count: bills.length,
                revenue: bills
                    .filter((b) => b.status === 'PAID' || b.status === 'PART_PAID')
                    .reduce((sum, b) => sum + b.paid, 0),
            },
        })
    } catch (error) {
        console.error('[bills] GET failed', error)
        return NextResponse.json({ error: 'Failed to load bills' }, { status: 500 })
    }
}
