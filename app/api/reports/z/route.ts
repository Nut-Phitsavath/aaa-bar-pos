import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { sessionTotal } from '@/lib/sessions'
import { billTotalOf, balanceOf, paidTotal, isConfirmed } from '@/lib/payments'

export const dynamic = 'force-dynamic'

/**
 * End-of-day reconciliation (requirement #25).
 *
 * The identity this report exists to prove, over bills that CLOSED today:
 *
 *     net = received + comped + owed + unreconciled
 *
 * `unreconciled` should be zero. It is reported rather than hidden because a
 * non-zero value is exactly the thing a manager needs to see: a bill that
 * closed without accounting for its money. Bills closed before split-tender
 * existed show up here; nothing the current code can do produces one, since
 * closing now refuses an outstanding balance.
 *
 * Money taken today against a bill that has NOT closed today - a table still
 * sitting there, or a tab from another night - is its own line, `onOpenBills`.
 * It is in the drawer but it is not a sale yet, and folding it into takings
 * would make tonight's figures irreconcilable tomorrow.
 *
 * Everything is derived from payment rows rather than from an order's
 * paymentMethod, because a split-tendered bill has no single method and would
 * otherwise land in the wrong column or none at all. Comped and owed are shown
 * as their own lines, never folded into takings - the drawer only ever held
 * the cash figure, and that is what a manager counts against.
 */
export async function GET(request: Request) {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    try {
        const { searchParams } = new URL(request.url)
        const dateStr = searchParams.get('date') || new Date().toISOString().split('T')[0]
        const start = new Date(`${dateStr}T00:00:00.000Z`)
        const end = new Date(`${dateStr}T23:59:59.999Z`)

        // Table bills closed in the window, plus tabs opened earlier that were
        // collected on today - the money arrived today either way.
        const sessions = await prisma.tableSession.findMany({
            where: {
                OR: [
                    { closedAt: { gte: start, lte: end } },
                    { payments: { some: { createdAt: { gte: start, lte: end } } } }
                ]
            },
            include: {
                table: { select: { name: true } },
                customer: { select: { name: true } },
                orders: { select: { status: true, total: true, tax: true, items: { select: { total: true, voidedAt: true } } } },
                payments: true
            }
        })

        let gross = 0
        let discounts = 0
        let comped = 0
        let owed = 0
        // Cash physically in the drawer today, whether or not its bill closed.
        let cashInDrawer = 0
        // Money taken today against bills that have not closed today.
        let onOpenBills = 0
        // The three lines a Z-report is expected to carry and this one did not:
        // the tax an accountant needs, and the two ways money leaves after a
        // sale is rung up. All three read from what was already stored.
        let tax = 0
        let tickets = 0
        let voidedCount = 0
        let voidedValue = 0
        const byMethod: Record<string, { amount: number; count: number }> = {}

        const add = (method: string, amount: number) => {
            const row = byMethod[method] ?? { amount: 0, count: 0 }
            row.amount += amount
            row.count += 1
            byMethod[method] = row
        }

        const comps: { table: string; amount: number }[] = []
        const tabs: { table: string; customer: string; amount: number }[] = []

        for (const s of sessions) {
            const rawGross = sessionTotal(s.orders)
            const total = billTotalOf(rawGross, s.discountType, s.discountValue)

            // Only count the sale itself on the day the bill closed; a tab
            // collected today must not book its drinks a second time.
            const closedToday = s.closedAt && s.closedAt >= start && s.closedAt <= end
            if (closedToday) {
                gross += rawGross
                discounts += rawGross - total

                // VAT as it was actually charged, read off the order rather
                // than recomputed from today's rate. Same principle the receipt
                // follows: a bill settled at 7% stays a bill settled at 7% even
                // after the owner changes the setting.
                for (const o of s.orders) {
                    if (o.status === 'CANCELLED' || o.status === 'HOLD') continue
                    tax += o.tax ?? 0
                    tickets += 1
                }
                // Struck lines, counted off every round including cancelled
                // ones - a whole round voided is still money that was rung up
                // and taken back off, which is the thing a manager is looking
                // for when they close the till.
                for (const o of s.orders) {
                    for (const i of o.items) {
                        if (!i.voidedAt) continue
                        voidedCount += 1
                        voidedValue += i.total
                    }
                }

                const balance = balanceOf(total, s.payments)
                if (balance > 0 && s.customerId) {
                    owed += balance
                    tabs.push({
                        table: s.table.name,
                        customer: s.customer?.name ?? '—',
                        amount: balance
                    })
                }
            }

            for (const p of s.payments) {
                if (!isConfirmed(p)) continue
                if (p.createdAt < start || p.createdAt > end) continue

                // Cash is cash the moment it is taken, so the drawer counts it
                // whether or not its bill has closed.
                if (p.method === 'CASH') cashInDrawer += p.amount

                if (!closedToday) {
                    // Money taken tonight on a table still sitting there, or on
                    // a tab opened another day. It is in the drawer but it is
                    // not part of today's closed sales - without its own line
                    // the report's totals cannot be made to balance.
                    onOpenBills += p.amount
                    continue
                }

                add(p.method, p.amount)
                if (p.method === 'OWNER_VIP') {
                    comped += p.amount
                    comps.push({ table: s.table.name, amount: p.amount })
                }
            }
        }

        // Money handed back. Dated by when the refund happened rather than when
        // the tender was taken: a bill settled last night and refunded this
        // afternoon leaves the drawer today, and today is the day that has to
        // account for it.
        const refunded = await prisma.payment.findMany({
            where: { voidedAt: { gte: start, lte: end } },
            select: { amount: true },
        })
        const refundCount = refunded.length
        const refundValue = refunded.reduce((sum, r) => sum + r.amount, 0)

        // Walk-in counter sales never touch a session, so they are counted from
        // orders. Without this the report misses every takeaway sale.
        const walkIns = await prisma.order.findMany({
            where: {
                sessionId: null,
                status: 'COMPLETED',
                isReportable: true,
                createdAt: { gte: start, lte: end }
            },
            select: { total: true, tax: true, paymentMethod: true, items: { select: { total: true, voidedAt: true } } }
        })
        for (const o of walkIns) {
            gross += o.total
            tax += o.tax ?? 0
            tickets += 1
            for (const i of o.items) {
                if (!i.voidedAt) continue
                voidedCount += 1
                voidedValue += i.total
            }
            const method = o.paymentMethod === "BANK_NOTE" ? "CASH" : o.paymentMethod
            add(method, o.total)
            if (method === "CASH") cashInDrawer += o.total
        }

        const shift = await prisma.shift.findFirst({
            where: { startTime: { gte: start, lte: end } },
            orderBy: { startTime: 'desc' },
            select: {
                id: true, status: true, startCash: true, cashPayments: true,
                actualCash: true, difference: true, startTime: true, endTime: true
            }
        })

        const received = Object.entries(byMethod)
            .filter(([m]) => m !== 'OWNER_VIP')
            .reduce((sum, [, r]) => sum + r.amount, 0)

        const net = gross - discounts

        return NextResponse.json({
            date: dateStr,
            gross,
            discounts,
            net,
            received,
            comped,
            owed,
            onOpenBills,
            // Should be 0. Anything else is a bill that closed without its
            // money accounted for, and is worth a manager's attention.
            unreconciled: net - received - comped - owed,
            // VAT as it was charged, summed from the orders themselves. The
            // line an accountant opens this report for, and the one it did not
            // have.
            tax,
            // How many rounds went out, so an average ticket is derivable
            // without exporting anything.
            tickets,
            // Money rung up then struck off, and money handed back afterwards.
            // Both belong on the document you close the day with rather than a
            // screen away in an audit tab.
            voids: { count: voidedCount, value: voidedValue },
            refunds: { count: refundCount, value: refundValue },
            byMethod,
            comps,
            tabs,
            shift,
            // The drawer should hold what it started with plus the cash taken.
            expectedCash: (shift?.startCash ?? 0) + cashInDrawer,
        })
    } catch (error) {
        console.error('[z-report] GET failed', error)
        return NextResponse.json({ error: 'Failed to build report' }, { status: 500 })
    }
}
