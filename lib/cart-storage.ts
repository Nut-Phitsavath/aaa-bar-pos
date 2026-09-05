/**
 * Where a ticket's unsent lines are kept.
 *
 * The counter and every table are the same page component, so a single
 * localStorage key meant one cart shared by all of them: a drink added at the
 * counter and not paid for reappeared on the next table opened, as an unsent
 * line one tap from Send - which charges it to the wrong customer and moves the
 * stock to match.
 *
 * Unsent lines are a fact about a ticket, so the key is too.
 *
 * They stay client-side rather than being written to the ticket the way
 * SambaPOS does, because one staff member keys at one till here and a half-typed
 * round is nobody else's business. That decision is unchanged; what changes is
 * that "client-side" now means per ticket instead of per browser.
 */

/** The walk-in counter keeps the original key, so nothing in flight is lost. */
export const COUNTER_CART_KEY = 'pos_cart'

export function cartKey(sessionId: string | null | undefined): string {
    return sessionId ? `${COUNTER_CART_KEY}:${sessionId}` : COUNTER_CART_KEY
}

/** True for any cart key, so a clean-up can find them all. */
export function isCartKey(key: string): boolean {
    return key === COUNTER_CART_KEY || key.startsWith(`${COUNTER_CART_KEY}:`)
}
