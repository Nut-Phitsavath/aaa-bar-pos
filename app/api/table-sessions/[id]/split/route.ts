import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { isConfirmed } from '@/lib/payments'
import { canSplit } from '@/lib/table-ops'
import { recomputeOrderTotal } from '@/lib/swap-charge'

export const dynamic = 'force-dynamic'

/**
 * One guest pays for their own drinks (req #2, split by item).
 *
 * The chosen lines lift onto a second bill at the same table. Both bills stay
 * open and both get settled separately - which is the whole point: the guest
 * leaving early pays now, the rest of the party carries on.
 *
 * Deliberately NOT "split evenly by four". Settle already takes as many tenders
 * against one bill as it needs, so four people paying a quarter each is four
 * payments, not four bills. Making it four bills would leave three extra
 * references to reconcile every night for no gain.
 *
 * Refused once money has been taken: a tender belongs to the bill it was taken
 * against, and there is no honest answer to which half of a split it follows.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const user = await getSessionUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const { itemIds } = await request.json()
        const moving: string[] = Array.isArray(itemIds) ? itemIds : []

        const openShift = await prisma.shift.findFirst({ where: { status: 'OPEN' } })

        const session = await prisma.tableSession.findUnique({
            where: { id },
            include: {
                table: { select: { id: true, name: true } },
                payments: true,
                orders: {
                    where: { status: { notIn: ['CANCELLED', 'HOLD'] } },
                    include: { items: true },
                },
            },
        })
        if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

        // Struck lines are not on the bill any more, so they are neither
        // movable nor counted when deciding whether everything is leaving.
        const live = session.orders.flatMap((o) => o.items.filter((i) => !i.voidedAt))

        const check = canSplit(
            { id: session.id, status: session.status, paidCount: session.payments.filter(isConfirmed).length },
            live.map((i) => i.id),
            moving,
            openShift?.id ?? null,
        )
        if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 409 })

        // The waiter and till user of the round the first line came from, so the
        // new bill is attributed rather than orphaned.
        const sourceOrder = session.orders.find((o) => o.items.some((i) => i.id === moving[0]))!

        const created = await prisma.$transaction(async (tx) => {
            const child = await tx.tableSession.create({
                data: {
                    tableId: session.tableId,
                    status: 'OPEN',
                    openedById: user.id,
                    // Its own opening time: the bill starts when it is split off,
                    // and a slip claiming it opened when the party sat down would
                    // be describing the table, not this guest.
                    openedAt: new Date(),
                },
            })

            // Numbered like every other order of the day, so the sequence in
            // history stays continuous. The bill's own reference already tells
            // the two halves apart - it is built from the session id.
            const todaysOrders = await tx.order.count({
                where: { createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
            })

            const order = await tx.order.create({
                data: {
                    orderNumber: `No. ${String(todaysOrders + 1).padStart(2, '0')}`,
                    status: 'SENT',
                    total: 0,
                    subtotal: 0,
                    tax: 0,
                    discount: 0,
                    sessionId: child.id,
                    tableOrderNumber: 1,
                    userId: sourceOrder.userId,
                    waiterId: sourceOrder.waiterId,
                    shiftId: openShift?.id ?? null,
                },
            })

            // The lines themselves move; nothing is re-priced and no stock
            // moves, because the drinks were poured either way.
            await tx.orderItem.updateMany({
                where: { id: { in: moving } },
                data: { orderId: order.id },
            })

            // Every round that lost lines is worth less, and the new one is
            // worth what it gained. Recomputed from surviving lines rather than
            // adjusted by a delta that could drift.
            for (const o of session.orders) await recomputeOrderTotal(tx, o.id)
            await recomputeOrderTotal(tx, order.id)

            await tx.tableSessionEvent.create({
                data: {
                    sessionId: id,
                    kind: 'SPLIT',
                    userId: user.id,
                    fromTable: session.table.name,
                    toTable: session.table.name,
                    otherSessionId: child.id,
                    lineCount: moving.length,
                },
            })

            return child
        })

        return NextResponse.json({ split: true, sessionId: created.id, lines: moving.length })
    } catch (error) {
        console.error('[table split] POST failed', error)
        return NextResponse.json({ error: 'Failed to split bill' }, { status: 500 })
    }
}
