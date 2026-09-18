import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { isConfirmed } from '@/lib/payments'
import { canSplitQuantities, swapChargeLineIds, type MovingLine } from '@/lib/table-ops'
import { recomputeOrderTotal } from '@/lib/swap-charge'
import { placeLinesOnOrder } from '@/lib/line-moves'
// Splitting changes the line count a deal is measured against.
import { refreshSessionPromo } from '@/lib/session-promo'

export const dynamic = 'force-dynamic'

/**
 * One guest pays for their own drinks (req #2, split by item).
 *
 * The chosen drinks lift onto a second bill at the same table. Both bills stay
 * open and both get settled separately - which is the whole point: the guest
 * leaving early pays now, the rest of the party carries on.
 *
 * Takes QUANTITIES, not just lines. The till merges identical items, so two
 * whiskeys keyed together are one row of two - and 65% of real order lines
 * carry more than one unit. Moving a single whiskey off a row of two used to be
 * impossible, which made "split by item" a promise the screen could not keep.
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

        const body = await request.json()
        const moving: MovingLine[] = Array.isArray(body?.items)
            ? body.items.map((i: any) => ({ itemId: String(i?.itemId), quantity: Number(i?.quantity) }))
            : []

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

        // An exchange upcharge is not a line a guest ordered - it belongs to
        // the package that earned it, and has to land on the same bill.
        const swaps = await prisma.packageSwap.findMany({
            where: { orderItemId: { in: live.map((i) => i.id) }, reversedAt: null },
            select: { orderItemId: true, chargeItemId: true },
        })
        const swapped = new Set(swaps.map((s) => s.orderItemId))

        const splittable = live.map((i) => ({
            id: i.id,
            quantity: i.quantity,
            hasSwap: swapped.has(i.id),
        }))
        const byId = new Map(live.map((i) => [i.id, i]))

        const sessionLike = {
            id: session.id,
            status: session.status,
            paidCount: session.payments.filter(isConfirmed).length,
        }

        const check = canSplitQuantities(sessionLike, splittable, moving, openShift?.id ?? null)
        if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 409 })

        // The upcharges dragged along, each moving its whole line.
        const extra = swapChargeLineIds(moving, swaps)
            .map((lineId) => ({ itemId: lineId, quantity: byId.get(lineId)?.quantity ?? 0 }))
            .filter((m) => m.quantity > 0)
        const all = [...moving, ...extra]

        // Re-checked, because dragging the upcharges along can be what tips the
        // selection into being the whole bill.
        const after = canSplitQuantities(sessionLike, splittable, all, openShift?.id ?? null)
        if (!after.ok) return NextResponse.json({ error: after.reason }, { status: 409 })

        // The waiter and till user of the round the first drink came from, so
        // the new bill is attributed rather than orphaned.
        const sourceOrder = session.orders.find((o) => o.items.some((i) => i.id === all[0].itemId))!

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
                    // The discount comes across with the drinks. A manager
                    // approved it for these guests tonight, and charging the
                    // split half at full price bills the party more in total
                    // than the table was quoted - which is an argument at the
                    // till, not a policy anyone chose.
                    discountType: session.discountType,
                    discountValue: session.discountValue,
                    discountApprovedById: session.discountApprovedById,
                    // The owner's VIP mark is about the party, not the bill.
                    isOwnerVip: session.isOwnerVip,
                    // The customer tab deliberately does NOT follow: a tab is a
                    // credit line, and attaching one to a new bill would put a
                    // regular in debt for drinks nobody said were theirs.
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

            // Rows divide where only some of a line is going. Shared with the
            // transfer route, because it is the same arithmetic and it is money.
            const wholeLines = await placeLinesOnOrder(tx, all, byId, order.id)

            if (wholeLines.length > 0) {
                // Exchanges are logged against a session as well as a line, so
                // they follow their package to the new bill - otherwise the
                // exchange report names a bill the set is no longer on. Only
                // whole lines move, which is why a swapped line may not split.
                await tx.packageSwap.updateMany({
                    where: { orderItemId: { in: wholeLines }, sessionId: id },
                    data: { sessionId: child.id },
                })
            }

            // Every round that lost drinks is worth less, and the new one is
            // worth what it gained. Recomputed from surviving lines rather than
            // adjusted by a delta that could drift.
            for (const o of session.orders) await recomputeOrderTotal(tx, o.id)
            await recomputeOrderTotal(tx, order.id)

            // A promo is counted from the drinks ON a bill, and this just moved
            // some off. Without this the parent keeps paying out a deal its
            // remaining rounds no longer qualify for. The parent only: promoId
            // does not follow to the child, because the deal was quoted to the
            // bill the party sat down on.
            await refreshSessionPromo(tx, id)

            await tx.tableSessionEvent.create({
                data: {
                    sessionId: id,
                    kind: 'SPLIT',
                    userId: user.id,
                    fromTable: session.table.name,
                    toTable: session.table.name,
                    otherSessionId: child.id,
                    lineCount: all.length,
                },
            })

            return child
        })

        return NextResponse.json({
            split: true,
            sessionId: created.id,
            lines: all.length,
            units: all.reduce((sum, m) => sum + Math.min(m.quantity, byId.get(m.itemId)?.quantity ?? 0), 0),
        })
    } catch (error) {
        console.error('[table split] POST failed', error)
        return NextResponse.json({ error: 'Failed to split bill' }, { status: 500 })
    }
}
