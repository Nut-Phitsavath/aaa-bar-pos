/**
 * The bar counter: one spot on the floor where everyone standing at the bar
 * gets a bill of their own.
 *
 * It is an ordinary Table in the area COUNTER, so a counter bill is an ordinary
 * table bill - same ticket, same settle screen, same split, comp and pay-later -
 * and staff learn one flow. What differs is that the counter holds many bills
 * at once, the floor shows it as its own strip rather than a card, it prints no
 * docket (the bartender who rings the drink pours it), and the reports still
 * call its takings walk-in.
 */
export const COUNTER_AREA = 'COUNTER'

/** The name the spot gets when the first walk-in creates it; the owner can rename it. */
export const COUNTER_DEFAULT_NAME = 'Counter'

export function isCounter(area: string | null | undefined): boolean {
    return area === COUNTER_AREA
}

/**
 * Table service against the walk-in counter, for the reports.
 *
 * A walk-in used to be an order with no bill at all. Now it is a bill on the
 * counter, so "no session" alone would put every counter sale under Tables.
 * Both count as walk-in: the old kind for history, the new kind from now on.
 */
export function isWalkIn(order: { sessionId: string | null; session?: { table?: { area?: string | null } | null } | null }): boolean {
    return !order.sessionId || isCounter(order.session?.table?.area)
}
