import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { decrementStock } from '@/lib/stock'
import { isVoidReason, canVoid, totalsFrom, allVoided } from '@/lib/voids'

export const dynamic = 'force-dynamic'

/**
 * Void a whole round, or single lines out of one (req #5).
 *
 * Pass `itemIds` to strike specific lines; omit it to strike the round. Both
 * write the same thing - a stamp on each line saying who, when and why - so
 * the void report has one source rather than an order flag and a line flag
 * that can tell different stories about the same night.
 *
 * The requirement's headline case is two staff keying the same table, so the
 * common path is voiding a whole duplicate round; single lines exist because
 * one of five beers coming back is the other half of the same job.
 *
 * No manager approval, by decision: at 1am the friction costs more than it
 * catches. Every void carries a name instead, which is what makes the report
 * worth reading - one server with triple everyone else's voids is visible in
 * the morning even though nobody was stopped at the time.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const { itemIds, reason, note } = await request.json()

        const user = await getSessionUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        // Checked before anything is written: a void with no reason is exactly
        // the audit hole this feature exists to close.
        if (!isVoidReason(reason)) {
            return NextResponse.json({ error: 'VOID_REASON_REQUIRED' }, { status: 400 })
        }

        const order = await prisma.order.findUnique({
            where: { id },
            include: { items: true },
        })
        if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

        const openShift = await prisma.shift.findFirst({ where: { status: 'OPEN' } })
        const check = canVoid(order, openShift?.id ?? null)
        if (!check.ok) {
            return NextResponse.json({ error: check.reason }, { status: 409 })
        }

        // Only lines that are still standing. Re-voiding a struck line would
        // return its stock a second time and invent inventory.
        const targets = order.items.filter(
            (i) => !i.voidedAt && (!Array.isArray(itemIds) || itemIds.includes(i.id))
        )
        if (targets.length === 0) {
            return NextResponse.json({ error: 'NOTHING_TO_VOID' }, { status: 409 })
        }

        const voidedAt = new Date()

        const updated = await prisma.$transaction(async (tx) => {
            await tx.orderItem.updateMany({
                where: { id: { in: targets.map((i) => i.id) } },
                data: {
                    voidedAt,
                    voidedById: user.id,
                    voidReason: reason,
                    voidNote: typeof note === 'string' && note.trim() ? note.trim() : null,
                },
            })

            // Stock goes back for what was struck, and only for what was struck.
            // A negative decrement is the same path a sale takes, so the value
            // lands rounded rather than as accumulated float noise.
            for (const item of targets) {
                if (!item.variationSizeId) continue
                const vs = await tx.variationSize.findUnique({
                    where: { id: item.variationSizeId },
                    include: { variation: { include: { menu: true } } },
                })
                if (!vs?.variation?.menu) continue

                const recipes = await tx.recipe.findMany({
                    where: {
                        OR: [
                            { menuId: vs.variation.menu.id, variationSizeId: null },
                            { variationSizeId: item.variationSizeId },
                        ],
                    },
                })
                for (const recipe of recipes) {
                    await decrementStock(tx, recipe.ingredientId, -(recipe.quantity * item.quantity))
                }
            }

            // What the round is worth now that those lines have stopped counting.
            const after = order.items.map((i) =>
                targets.some((t) => t.id === i.id) ? { ...i, voidedAt } : i
            )
            const totals = totalsFrom(after)

            return tx.order.update({
                where: { id },
                data: {
                    subtotal: totals.subtotal,
                    total: totals.total,
                    // A round with nothing left standing is a cancelled round.
                    // Flipping the status keeps every existing query that filters
                    // on it - the bill, the Z-report, the ticket - correct without
                    // any of them having to learn about line-level voids.
                    ...(allVoided(after)
                        ? { status: 'CANCELLED', cancellationReason: reason }
                        : {}),
                },
                include: { items: true },
            })
        })

        return NextResponse.json({
            order: updated,
            voidedCount: targets.length,
            roundCancelled: updated.status === 'CANCELLED',
        })
    } catch (error) {
        console.error('[orders void] POST failed', error)
        return NextResponse.json({ error: 'Failed to void' }, { status: 500 })
    }
}
