/**
 * Moving stock without accumulating float noise.
 *
 * A 30ml single out of a 700ml bottle is 0.042857142857... of it, and that
 * fraction is not representable in binary. Subtracting it a few hundred times
 * with a plain `decrement` leaves the shelf holding -29.91428571428571 bottles,
 * which is not a number anyone can act on: a count sheet says "about thirty",
 * an order says "twelve", and neither says fourteen significant figures.
 *
 * Rounding happens in SQL rather than by reading, rounding and writing back,
 * so two tills serving the same bottle at once still add up.
 */

/** Enough to hold a millilitre out of a bottle; short enough to stay legible. */
export const STOCK_DP = 3

type Executor = { $executeRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<number> }

/**
 * Take `quantity` off an ingredient's shop stock. A negative quantity puts it
 * back, which is what a voided round does.
 *
 * Deliberately allows the result to go negative. Stock below zero means more
 * was sold than was ever booked in - a delivery nobody entered, or a recipe
 * that is wrong - and hiding that behind a clamp at zero turns a discrepancy
 * the manager needs to see into a silent one. The bar is never blocked from
 * serving; the variance is simply visible afterwards.
 */
export async function decrementStock(
    tx: Executor,
    ingredientId: string,
    quantity: number
): Promise<void> {
    if (!Number.isFinite(quantity) || quantity === 0) return

    await tx.$executeRaw`
        UPDATE "Ingredient"
        SET "subStock" = ROUND("subStock" - ${quantity}, ${STOCK_DP})
        WHERE "id" = ${ingredientId}
    `
}

/**
 * How to show a stock figure. Trailing zeros are noise on a count sheet -
 * "300 bottles" not "300.000" - but a part-bottle still has to be readable.
 */
export function formatStock(value: number | null | undefined): string {
    const n = Number(value) || 0
    return Number(n.toFixed(STOCK_DP)).toLocaleString("en-US", { maximumFractionDigits: STOCK_DP })
}
