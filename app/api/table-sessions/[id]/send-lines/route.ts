import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { isConfirmed } from '@/lib/payments'
import { canSendLines, swapChargeLineIds, type MovingLine } from '@/lib/table-ops'
import { recomputeOrderTotal } from '@/lib/swap-charge'
import { placeLinesOnOrder } from '@/lib/line-moves'
// Moving drinks changes the line count a deal is measured against, on BOTH bills.
import { refreshSessionPromo } from '@/lib/session-promo'

export const dynamic = 'force-dynamic'

/**
 * Chosen drinks leave for another table's bill (req #2, transfer item).
 *
 * A bottle carried from a floor table into a VIP room; a round rung into the
 * wrong table. The drinks move, nothing is re-priced, no stock moves - they
 * were poured either way. What changes is which bill pays for them.
 *
 * This is SPLIT with the second bill already existing, and it borrows the
 * split's rules wholesale - quantities included, so a single bottle can leave a
 * line of three. It refuses what both SPLIT and MERGE refuse: a bill that has
 * taken money stays where it is, and sending every drink is a MERGE, which is
 * the operation that closes the emptied bill rather than leaving an open one
 * worth nothing on the floor.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const user = await getSessionUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const body = await request.json()
        const toSessionId = typeof body?.toSessionId === 'string' ? body.toSessionId : null
        if (!toSessionId) return NextResponse.json({ error: 'SESSION_REQUIRED' }, { status: 400 })

        const moving: MovingLine[] = Array.isArray(body?.items)
            ? body.items.map((i: any) => ({ itemId: String(i?.itemId), quantity: Number(i?.quantity) }))
            : []

        const openShift = await prisma.shift.findFirst({ where: { status: 'OPEN' } })

        const [from, into] = await Promise.all([
            prisma.tableSession.findUnique({
                where: { id },
                include: {
                    table: { select: { name: true } },
                    payments: true,
                    orders: {
                        where: { status: { notIn: ['CANCELLED', 'HOLD'] } },
                        include: { items: true },
                    },
                },
            }),
            prisma.tableSession.findUnique({
                where: { id: toSessionId },
                include: { table: { select: { name: true } }, payments: true },
            }),
        ])
        if (!from || !into) return NextResponse.json({ error: 'Not found' }, { status: 404 })

        // Struck lines are not on the bill any more, so they are neither
        // movable nor counted when deciding whether everything is leaving.
        const live = from.orders.flatMap((o) => o.items.filter((i) => !i.voidedAt))

        const swaps = await prisma.packageSwap.findMany({
            where: { orderItemId: { in: live.map((i) => i.id) }, reversedAt: null },
            select: { orderItemId: true, chargeItemId: true },
        })
        const swapped = new Set(swaps.map((s) => s.orderItemId))

        const sendable = live.map((i) => ({
            id: i.id,
            quantity: i.quantity,
            hasSwap: swapped.has(i.id),
        }))
        const byId = new Map(live.map((i) => [i.id, i]))

        const sides = {
            from: { id: from.id, status: from.status, paidCount: from.payments.filter(isConfirmed).length },
            into: { id: into.id, status: into.status, paidCount: into.payments.filter(isConfirmed).length },
        }

        const check = canSendLines(sides.from, sides.into, sendable, moving, openShift?.id ?? null)
        if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 409 })

        // The upcharges dragged along, each moving its whole line.
        const extra = swapChargeLineIds(moving, swaps)
            .map((lineId) => ({ itemId: lineId, quantity: byId.get(lineId)?.quantity ?? 0 }))
            .filter((m) => m.quantity > 0)
        const all = [...moving, ...extra]

        // Re-checked, because dragging the upcharges along can be what tips the
        // selection into being the whole bill.
        const after = canSendLines(sides.from, sides.into, sendable, all, openShift?.id ?? null)
        if (!after.ok) return NextResponse.json({ error: after.reason }, { status: 409 })

        // The waiter and till user of the round the first drink came from, so
        // the arriving round is attributed rather than orphaned.
        const sourceOrder = from.orders.find((o) => o.items.some((i) => i.id === all[0].itemId))!

        await prisma.$transaction(async (tx) => {
            const todaysOrders = await tx.order.count({
                where: { createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
            })
            // The next round of the bill it is landing on - max+1, never
            // count+1, so a voided round keeps its number and the sequence on a
            // printed bill can never silently shift under an audit.
            const highest = await tx.order.aggregate({
                where: { sessionId: into.id },
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
                    sessionId: into.id,
                    tableOrderNumber: (highest._max.tableOrderNumber ?? 0) + 1,
                    userId: sourceOrder.userId,
                    waiterId: sourceOrder.waiterId,
                    shiftId: openShift?.id ?? null,
                },
            })

            const wholeLines = await placeLinesOnOrder(tx, all, byId, order.id)

            if (wholeLines.length > 0) {
                // Exchanges are logged against a session as well as a line, so
                // they follow their package across - otherwise the exchange
                // report names a bill the set is no longer on.
                await tx.packageSwap.updateMany({
                    where: { orderItemId: { in: wholeLines }, sessionId: id },
                    data: { sessionId: into.id },
                })
            }

            // Every round that lost drinks is worth less, and the arriving one
            // is worth what it carried. Recomputed from surviving lines rather
            // than adjusted by a delta that could drift.
            for (const o of from.orders) await recomputeOrderTotal(tx, o.id)
            await recomputeOrderTotal(tx, order.id)

            // BOTH bills, unlike a split: a deal is counted from the drinks on
            // a bill, and this took some off one and put them on the other. The
            // receiving bill can newly MEET a minimum it did not before.
            await refreshSessionPromo(tx, from.id)
            await refreshSessionPromo(tx, into.id)

            await tx.tableSessionEvent.create({
                data: {
                    sessionId: id,
                    kind: 'TRANSFER',
                    userId: user.id,
                    // Names, because a table can be renamed after tonight.
                    fromTable: from.table.name,
                    toTable: into.table.name,
                    otherSessionId: into.id,
                    lineCount: all.length,
                },
            })
        })

        return NextResponse.json({
            sent: true,
            table: into.table.name,
            lines: all.length,
            units: all.reduce((sum, m) => sum + Math.min(m.quantity, byId.get(m.itemId)?.quantity ?? 0), 0),
        })
    } catch (error) {
        console.error('[table send-lines] POST failed', error)
        return NextResponse.json({ error: 'Failed to send items' }, { status: 500 })
    }
}
