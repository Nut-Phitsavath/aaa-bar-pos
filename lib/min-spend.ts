/**
 * VIP room minimum spend (req: discotheque room rule).
 *
 * A VIP room is sold on a floor, not a cover charge: the party books the room
 * and undertakes to spend at least so much across the night. Drink less than
 * that and the difference is still owed - it is what the room cost.
 *
 * The shortfall is raised as an ordinary line on the bill rather than a field
 * of its own, so VAT, the Z-report and the printed slip all count it without a
 * single one of them learning what a minimum spend is.
 *
 * Pure, so the till can grey the button out and the route can refuse from the
 * same rule.
 */

/** The name the surcharge prints under. Also how it is recognised again. */
export const MIN_SPEND_LINE = 'VIP Room Minimum'

/**
 * What is still owed on the room, in whole baht.
 *
 * Zero when the party drank past the minimum, when the table has no floor, and
 * when the shortfall rounds away to nothing - a 40-satang surcharge is a line
 * on a bill that costs more to explain than it collects.
 *
 * `total` is the bill AFTER discounts and promotions. A manager who wrote 500
 * off did it knowing the room had a floor, and charging the shortfall against
 * the gross would quietly take that write-off back at the till - the customer
 * would be handed the discount and then billed for it again under another name.
 */
export function minSpendShortfall(total: number, minSpend: number | null | undefined): number {
    if (minSpend == null || !(minSpend > 0)) return 0
    if (!Number.isFinite(total)) return 0
    return Math.max(0, Math.round(minSpend - total))
}

/**
 * Has the surcharge already been raised on this bill?
 *
 * Checked by line name, because the line carries no menu item to check against
 * - it is a charge, not a drink, and inventing a menu row for it would put
 * "VIP Room Minimum" in the sales mix and the pour-cost report.
 *
 * A struck line does not count. A manager who voided the surcharge decided the
 * room was not owed it tonight, and the till must not quietly raise it again on
 * the next tap of Checkout.
 */
export function hasMinSpendCharge(
    lines: { name: string; voidedAt?: Date | string | null }[],
): boolean {
    return lines.some((l) => l.name === MIN_SPEND_LINE && !l.voidedAt)
}

/**
 * Read a minimum spend off a form field.
 *
 * Blank, zero and anything that is not a positive number all mean "no floor",
 * which is null. Storing 0 instead would make every ordinary table look like a
 * room that had already met its minimum, and `minSpend > 0` checks would still
 * pass on it.
 */
export function parseMinSpend(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null
    const n = Number(value)
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null
}
