import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { sessionBillTotal } from '@/lib/sessions'
import { minSpendShortfall, hasMinSpendCharge, MIN_SPEND_LINE } from '@/lib/min-spend'
import { recomputeOrderTotal } from '@/lib/swap-charge'

export const dynamic = 'force-dynamic'

/**
 * Raise the VIP room's minimum-spend surcharge on this bill.
 *
 * The party booked the room on an undertaking to spend so much; they drank less
 * than that, and the difference is what the room cost. Charged at checkout,
 * when the figure is finally known - raising it earlier would mean revising it
 * on every round.
 *
 * The charge lands as an ordinary order line with no menuId, in its own round.
 * That way VAT, the Z-report, the printed bill and the balance all count it
 * without one of them learning what a minimum spend is - and it can be voided
 * like any other line, by a manager who decides the room is not owed it.
 *
 * Recomputed from the bill rather than trusted from the request: the screen
 * that asked may have been looking at a total another device has since moved.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const user = await getSessionUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const openShift = await prisma.shift.findFirst({ where: { status: 'OPEN' } })

        const session = await prisma.tableSession.findUnique({
            where: { id },
            include: {
                table: { select: { name: true, minSpend: true } },
                orders: {
                    where: { status: { notIn: ['CANCELLED', 'HOLD'] } },
                    select: { id: true, status: true, total: true, items: { select: { name: true, voidedAt: true } } },
                },
            },
        })
        if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

        // A settled bill is what the customer was charged. Adding to it after
        // the fact rewrites a night that is already counted.
        if (session.status === 'CLOSED') {
            return NextResponse.json({ error: 'SESSION_ALREADY_CLOSED' }, { status: 409 })
        }
        if (!session.table.minSpend) {
            return NextResponse.json({ error: 'NO_MINIMUM_SPEND' }, { status: 409 })
        }

        const lines = session.orders.flatMap((o) => o.items)
        if (hasMinSpendCharge(lines)) {
            return NextResponse.json({ error: 'ALREADY_CHARGED' }, { status: 409 })
        }

        // Against the post-discount total, so a manager's write-off is not
        // quietly taken back under another name.
        const total = sessionBillTotal(session)
        const shortfall = minSpendShortfall(total, session.table.minSpend)
        if (shortfall <= 0) {
            return NextResponse.json({ error: 'MINIMUM_ALREADY_MET', total }, { status: 409 })
        }

        await prisma.$transaction(async (tx) => {
            const todaysOrders = await tx.order.count({
                where: { createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
            })
            const highest = await tx.order.aggregate({
                where: { sessionId: id },
                _max: { tableOrderNumber: true },
            })

            const order = await tx.order.create({
                data: {
                    orderNumber: `No. ${String(todaysOrders + 1).padStart(2, '0')}`,
                    status: 'SENT',
                    total: 0,
                    subtotal: 0,
                    tax: 0,
                    discount: 0,
                    sessionId: id,
                    tableOrderNumber: (highest._max.tableOrderNumber ?? 0) + 1,
                    userId: user.id,
                    shiftId: openShift?.id ?? null,
                    items: {
                        create: {
                            // No menuId: this is a charge, not a drink. Inventing
                            // a menu row for it would put "VIP Room Minimum" in
                            // the sales mix and the pour-cost report, where it
                            // would look like a product nobody can pour.
                            name: MIN_SPEND_LINE,
                            price: shortfall,
                            quantity: 1,
                            total: shortfall,
                        },
                    },
                },
            })

            await recomputeOrderTotal(tx, order.id)
        })

        return NextResponse.json({
            charged: true,
            shortfall,
            table: session.table.name,
            minSpend: session.table.minSpend,
        })
    } catch (error) {
        console.error('[min-spend] POST failed', error)
        return NextResponse.json({ error: 'Failed to charge minimum spend' }, { status: 500 })
    }
}
