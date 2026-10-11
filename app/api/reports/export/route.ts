import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { COUNTED_ORDER, COUNTED_LINE, periodDiscounts } from '@/lib/reporting'
import { sessionTotal, sessionBillTotal } from '@/lib/sessions'
import { isConfirmed } from '@/lib/payments'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'

/**
 * The Excel export behind the button on the reports page.
 *
 * It used to be a raw dump of `prisma.order` and `prisma.orderItem` rows, which
 * meant it answered "what is a sale" on its own - and answered it differently
 * from the page it sits on. Two consequences, both live until now:
 *
 *   - voided lines were exported as sold, because nothing filtered the void
 *     stamp, so anyone summing the items sheet counted drinks the bar had
 *     taken back off;
 *   - the totals were gross of the per-table discount, so summing the orders
 *     column in Excel gave a figure ฿8,041 above what the same period showed
 *     on screen and in the Z-report.
 *
 * Now built from `lib/reporting`, the same definitions the analytics route and
 * the Z-report use. A figure in this workbook and the same figure on screen
 * come from one place and cannot drift again.
 *
 * It also stopped dumping raw rows. The old sheets carried `qrCodeData`,
 * `bankReference` and `promoId` into a file that gets emailed around; these
 * carry what somebody opening a spreadsheet actually wants.
 */
export async function GET(request: Request) {
    // A workbook of the bar's takings is not public. The old route had no
    // guard at all.
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    try {
        const { searchParams } = new URL(request.url)
        const startDate = searchParams.get('startDate')
        const endDate = searchParams.get('endDate')

        if (!startDate || !endDate) {
            return NextResponse.json({ error: 'Missing date range' }, { status: 400 })
        }

        const start = new Date(startDate)
        const end = new Date(endDate)
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return NextResponse.json({ error: 'Invalid date range' }, { status: 400 })
        }

        const period = { createdAt: { gte: start, lte: end } }

        // --- Bills -------------------------------------------------------
        // One row per table bill, priced the way the customer was charged.
        const sessions = await prisma.tableSession.findMany({
            where: { closedAt: { gte: start, lte: end } },
            select: {
                openedAt: true,
                closedAt: true,
                discountType: true,
                discountValue: true,
                promoDiscount: true,
                isOwnerVip: true,
                table: { select: { name: true, area: true } },
                customer: { select: { name: true } },
                orders: {
                    where: COUNTED_ORDER,
                    select: { status: true, total: true, tax: true, waiter: { select: { name: true } } },
                },
                payments: { select: { method: true, amount: true, paymentStatus: true, voidedAt: true } },
            },
            orderBy: { closedAt: 'asc' },
        })

        const bills = sessions.map((s) => {
            const gross = sessionTotal(s.orders)
            const total = sessionBillTotal(s)
            const minutes = s.closedAt
                ? Math.max(0, Math.round((s.closedAt.getTime() - s.openedAt.getTime()) / 60000))
                : null
            return {
                Table: s.table.name,
                Area: s.table.area,
                Opened: s.openedAt,
                Closed: s.closedAt,
                Minutes: minutes,
                Rounds: s.orders.length,
                Servers: Array.from(new Set(s.orders.map((o) => o.waiter?.name).filter(Boolean))).join(', '),
                Customer: s.customer?.name ?? '',
                Gross: gross,
                Discount: gross - total,
                Total: total,
                VAT: s.orders.reduce((n, o) => n + (o.tax ?? 0), 0),
                // Split tender has no single method, so say so rather than
                // picking whichever leg happened to close the bill.
                Paid_By: Array.from(new Set(s.payments.filter(isConfirmed).map((p) => p.method))).join(' + '),
                Owner_VIP: s.isOwnerVip ? 'yes' : '',
            }
        })

        // Counter sales never touch a session and would otherwise be missing.
        const walkIns = await prisma.order.findMany({
            where: { ...period, ...COUNTED_ORDER, sessionId: null },
            select: { orderNumber: true, createdAt: true, total: true, tax: true, paymentMethod: true },
            orderBy: { createdAt: 'asc' },
        })
        for (const o of walkIns) {
            bills.push({
                Table: 'Counter', Area: '', Opened: o.createdAt, Closed: o.createdAt,
                Minutes: 0, Rounds: 1, Servers: '', Customer: '',
                Gross: o.total, Discount: 0, Total: o.total, VAT: o.tax ?? 0,
                Paid_By: o.paymentMethod, Owner_VIP: '',
            })
        }

        // --- Items -------------------------------------------------------
        // Struck lines are excluded. This is the filter the old export did not
        // have, and the reason its items sheet over-counted.
        const items = await prisma.orderItem.findMany({
            where: { ...COUNTED_LINE, order: { ...period, ...COUNTED_ORDER } },
            select: {
                name: true, quantity: true, price: true, total: true, note: true,
                menu: { select: { category: { select: { name: true } } } },
                order: {
                    select: {
                        orderNumber: true, createdAt: true,
                        waiter: { select: { name: true } },
                        session: { select: { table: { select: { name: true } } } },
                    },
                },
            },
            orderBy: { order: { createdAt: 'asc' } },
        })

        const lines = items.map((i) => ({
            Date: i.order.createdAt,
            Bill: i.order.session?.table?.name ?? 'Counter',
            Order: i.order.orderNumber,
            Server: i.order.waiter?.name ?? '',
            Category: i.menu?.category?.name ?? '',
            Item: i.name,
            Qty: i.quantity,
            Price: i.price,
            Total: i.total,
            Note: i.note ?? '',
        }))

        // --- Summary -----------------------------------------------------
        // The figures the page shows, so the workbook can be checked against
        // the screen it came from without adding anything up by hand.
        const countedOrders = await prisma.order.aggregate({
            where: { ...period, ...COUNTED_ORDER },
            _sum: { total: true, tax: true },
            _count: true,
        })
        const discountedSessions = await prisma.tableSession.findMany({
            where: {
                // Either kind of giveaway. Looking only for a discountType
                // would miss a bill whose only saving was a promotion, and net
                // revenue would then disagree with what that bill charged.
                OR: [{ discountType: { not: null } }, { promoId: { not: null } }], orders: { some: { ...period, ...COUNTED_ORDER } } },
            select: {
                discountType: true, discountValue: true, promoDiscount: true,
                orders: { where: COUNTED_ORDER, select: { status: true, total: true } },
            },
        })
        const gross = countedOrders._sum.total ?? 0
        const discounts = periodDiscounts(discountedSessions)

        const summary = [
            { Figure: 'Period start', Value: start },
            { Figure: 'Period end', Value: end },
            { Figure: 'Rounds', Value: countedOrders._count },
            { Figure: 'Gross', Value: gross },
            { Figure: 'Table discounts', Value: discounts },
            { Figure: 'Net (billed)', Value: gross - discounts },
            { Figure: 'VAT', Value: countedOrders._sum.tax ?? 0 },
            { Figure: 'Exported by', Value: user.name ?? user.id },
            { Figure: 'Exported at', Value: new Date() },
        ]

        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Summary')
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(bills), 'Bills')
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(lines), 'Items')

        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

        return new NextResponse(buf, {
            headers: {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': `attachment; filename="export_${startDate.split('T')[0]}_to_${endDate.split('T')[0]}.xlsx"`,
            },
        })
    } catch (e) {
        console.error('[reports export] failed', e)
        return NextResponse.json({ error: 'Export failed' }, { status: 500 })
    }
}
