import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { requireOpenShift } from '@/lib/shift-guard'
import { decrementStock } from '@/lib/stock'
import { recomputeOrderTotal } from '@/lib/swap-charge'

export const dynamic = 'force-dynamic'

/** The recipe rule the order path uses: the menu's base lines plus this size's. */
async function recipeFor(tx: any, variationSizeId: string) {
    const vs = await tx.variationSize.findUnique({
        where: { id: variationSizeId },
        include: { variation: { include: { menu: true } } },
    })
    if (!vs?.variation?.menu) return []
    return tx.recipe.findMany({
        where: {
            OR: [
                { menuId: vs.variation.menu.id, variationSizeId: null },
                { variationSizeId },
            ],
        },
    })
}

/**
 * Undo an exchange.
 *
 * Needed because a swap cannot be un-swapped: what it added never becomes part
 * of the package, so a second exchange can never take it back out. Without this
 * the wrong drink tapped at 1am is permanent, and the only fix is a manager
 * editing stock by hand - which is how a count stops meaning anything.
 *
 * Reversed, never deleted. A swap that happened and was undone is two facts an
 * audit wants; deleting the row would leave the stock movement behind with
 * nothing explaining it. The bill's charge line is struck the same way a void
 * strikes a line, so a round's total is always the sum of what survived.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const user = await getSessionUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const openShift = await prisma.shift.findFirst({ where: { status: 'OPEN' } })
        const shiftCheck = requireOpenShift(openShift)
        if (!shiftCheck.ok) {
            return NextResponse.json({ error: shiftCheck.reason }, { status: 409 })
        }

        const swap = await prisma.packageSwap.findUnique({
            where: { id },
            include: {
                lines: true,
                orderItem: { include: { order: { select: { id: true, status: true, sessionId: true } } } },
            },
        })
        if (!swap) return NextResponse.json({ error: 'Not found' }, { status: 404 })
        if (swap.reversedAt) return NextResponse.json({ error: 'ALREADY_REVERSED' }, { status: 409 })

        if (swap.orderItem.order.sessionId) {
            const session = await prisma.tableSession.findUnique({
                where: { id: swap.orderItem.order.sessionId },
                select: { status: true },
            })
            if (session?.status === 'CLOSED') {
                return NextResponse.json({ error: 'SESSION_ALREADY_CLOSED' }, { status: 409 })
            }
        }

        await prisma.$transaction(async (tx) => {
            // Exactly the swap's stock movement, backwards: what it put back on
            // the shelf comes off again, what it took comes back.
            for (const line of swap.lines) {
                if (!line.variationSizeId) continue
                const sign = line.direction === 'OUT' ? 1 : -1
                for (const r of await recipeFor(tx, line.variationSizeId)) {
                    await decrementStock(tx, r.ingredientId, sign * r.quantity * line.quantity)
                }
            }

            // The charge is struck rather than deleted, so the bill still shows
            // that something was charged and then taken back off.
            if (swap.chargeItemId) {
                await tx.orderItem.updateMany({
                    where: { id: swap.chargeItemId, voidedAt: null },
                    data: {
                        voidedAt: new Date(),
                        voidedById: user.id,
                        voidReason: 'OTHER',
                        voidNote: 'Exchange reversed',
                    },
                })
                await recomputeOrderTotal(tx, swap.orderItem.order.id)
            }

            await tx.packageSwap.update({
                where: { id: swap.id },
                data: { reversedAt: new Date(), reversedById: user.id },
            })
        })

        return NextResponse.json({ reversed: true })
    } catch (error) {
        console.error('[package swap] reverse failed', error)
        return NextResponse.json({ error: 'Failed to reverse' }, { status: 500 })
    }
}
