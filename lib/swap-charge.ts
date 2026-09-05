/**
 * The bill line a dearer exchange adds, and the sum that keeps a round honest.
 *
 * Shared between the swap route and the reversal route so the line one writes
 * is exactly the line the other strikes.
 */

/**
 * Bilingual and snapshotted, exactly like every other order line: a receipt has
 * to read the same next year whatever language the till is set to now, and
 * parseNames already splits "Lao (English)" for the printed slip.
 */
export const EXCHANGE_CHARGE = 'ສ່ວນຕ່າງການແລກປ່ຽນ (Exchange difference)'

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
