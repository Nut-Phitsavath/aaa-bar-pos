/**
 * Moving stock, and recording why it moved.
 *
 * Two things happen on every movement and they belong in one place. The
 * balance changes, and a row is written saying who moved it and what for.
 * Splitting them is how the ledger ended up with deposits and withdrawals in
 * it but not sales - 553 orders that changed the shelf and left nothing to
 * read afterwards.
 *
 * Rounding happens in SQL rather than by reading, rounding and writing back,
 * so two tills serving the same bottle at once still add up.
 */

/**
 * Enough to hold a millilitre out of a bottle; short enough to stay legible.
 *
 * Kept at 3 while quantities are still fractions of a purchase unit. Once
 * stock is in base units this becomes a per-measure-type figure.
 */
export const STOCK_DP = 3

/**
 * Why stock moved.
 *
 * SALE and SALE_VOID come from the till. EXCHANGE covers a package swap in
 * either direction, EXCHANGE_REVERSE its undo. RETURN_UNOPENED_STOCK is the
 * per-ingredient half of a cleanup count - deliberately NOT `RETURN_UNOPENED`,
 * which the returns route writes once per returned line and reads back to cap
 * the next count. One row per ingredient under that type would make a
 * two-ingredient drink look twice returned and silently halve the cap.
 */
export type StockMovementType =
    | 'SALE'
    | 'SALE_VOID'
    | 'EXCHANGE'
    | 'EXCHANGE_REVERSE'
    | 'RETURN_UNOPENED_STOCK'

export type StockMovement = {
    type: StockMovementType
    /** Who did it. Null only where no user is attached to the path. */
    userId?: string | null
    /** Which bill, table or order this came from - what an audit reads first. */
    notes?: string | null
    /** A menuId or orderId, so a report can group without parsing notes. */
    reason?: string | null
}

/**
 * Whatever can run these two statements - a Prisma client or an interactive
 * transaction. `create` is typed loosely on purpose: Prisma's own signature is
 * generic over the argument, and narrowing it here to a concrete data shape
 * makes a real `tx` fail to satisfy it. Matches how `lib/swap-charge.ts`
 * already types its executor.
 */
type Executor = {
    $executeRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<number>
    stockTransaction: { create: (args: any) => Promise<any> }
}

/**
 * Take `quantity` off an ingredient's shop stock and record why. A negative
 * quantity puts it back, which is what a voided round does.
 *
 * `movement` is required rather than optional on purpose: an optional audit
 * trail is one that stops being written the first time somebody is in a hurry.
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
    quantity: number,
    movement: StockMovement
): Promise<void> {
    if (!Number.isFinite(quantity) || quantity === 0) return

    await tx.$executeRaw`
        UPDATE "Ingredient"
        SET "subStock" = ROUND("subStock" - ${quantity}, ${STOCK_DP})
        WHERE "id" = ${ingredientId}
    `

    // Direction lives in fromStore/toStore and the quantity stays positive,
    // which is the convention the deposit and withdraw paths already use - so
    // one report can read every row without special-casing where it came from.
    await tx.stockTransaction.create({
        data: {
            ingredientId,
            type: movement.type,
            quantity: Math.abs(quantity),
            fromStore: quantity > 0 ? 'SUB' : null,
            toStore: quantity < 0 ? 'SUB' : null,
            userId: movement.userId ?? null,
            notes: movement.notes ?? null,
            reason: movement.reason ?? null,
        },
    })
}

/**
 * How to show a stock figure. Trailing zeros are noise on a count sheet -
 * "300 bottles" not "300.000" - but a part-bottle still has to be readable.
 */
export function formatStock(value: number | null | undefined): string {
    const n = Number(value) || 0
    return Number(n.toFixed(STOCK_DP)).toLocaleString("en-US", { maximumFractionDigits: STOCK_DP })
}
