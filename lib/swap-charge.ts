/**
 * The bill line a dearer exchange adds, and the sum that keeps a round honest.
 *
 * Shared between the swap route and the reversal route so the line one writes
 * is exactly the line the other strikes.
 */

import type { StockMovement } from './stock.ts'

/**
 * Bilingual and snapshotted, exactly like every other order line: a receipt has
 * to read the same next year whatever language the till is set to now, and
 * parseNames already splits "Lao (English)" for the printed slip.
 */
export const EXCHANGE_CHARGE = 'ສ່ວນຕ່າງການແລກປ່ຽນ (Exchange difference)'

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
 * Undo one exchange: its stock movement backwards, its charge struck, the row
 * marked reversed.
 *
 * Shared by the undo button and by voiding, because a struck package line has
 * to take its exchanges down with it. Voiding used to reverse only the recipe,
 * which on an exchanged set put back Heinekens that a swap had already
 * returned and left the Beer Lao that replaced them off the shelf - the count
 * ended the night wrong in two directions at once.
 */
export async function reverseSwap(
    tx: any,
    swap: { id: string; chargeItemId: string | null; lines: any[] },
    userId: string,
    decrementStock: (
        tx: any,
        ingredientId: string,
        quantity: number,
        movement: StockMovement,
    ) => Promise<void>,
): Promise<void> {
    for (const line of swap.lines) {
        if (!line.variationSizeId) continue
        const sign = line.direction === 'OUT' ? 1 : -1
        for (const r of await recipeFor(tx, line.variationSizeId)) {
            await decrementStock(tx, r.ingredientId, sign * r.quantity * line.quantity, {
                type: 'EXCHANGE_REVERSE',
                userId,
                notes: `swap ${swap.id}`,
                reason: line.menuId ?? null,
            })
        }
    }

    if (swap.chargeItemId) {
        await tx.orderItem.updateMany({
            where: { id: swap.chargeItemId, voidedAt: null },
            data: {
                voidedAt: new Date(),
                voidedById: userId,
                voidReason: 'OTHER',
                voidNote: 'Exchange reversed',
            },
        })
    }

    await tx.packageSwap.update({
        where: { id: swap.id },
        data: { reversedAt: new Date(), reversedById: userId },
    })
}

/**
 * A round is worth what its surviving lines are worth.
 *
 * The same rule the void path uses: struck lines are kept but stop counting, so
 * the total is recomputed from what is live rather than adjusted by a delta
 * that could drift away from the lines it claims to describe.
 */
export async function recomputeOrderTotal(tx: any, orderId: string): Promise<number> {
    const live = await tx.orderItem.findMany({
        where: { orderId, voidedAt: null },
        select: { total: true },
    })
    const total = live.reduce((sum: number, l: { total: number }) => sum + l.total, 0)
    await tx.order.update({ where: { id: orderId }, data: { total, subtotal: total } })
    return total
}
