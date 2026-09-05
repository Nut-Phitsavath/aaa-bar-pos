/**
 * Voiding rounds and lines (req #5, and the source the void report reads).
 *
 * A void is recorded on the LINE, not the round. The requirement asks for a
 * report of "all cancelled/voided items", and a whole-round void is simply
 * every line struck at once - so there is one thing to write and one thing to
 * read, rather than an order-level flag and a line-level flag that can disagree
 * about what actually happened.
 *
 * Struck lines are kept, never deleted. A deleted row is indistinguishable from
 * a round nobody ever keyed, which is exactly what an audit exists to tell
 * apart.
 *
 * Pure functions only, no Prisma: the till and the route decide through the
 * same arithmetic, so what the waiter sees the bill drop by and what the bill
 * actually drops by cannot diverge.
 */

/**
 * The fixed reasons (req #5: "mandatory void reason selection").
 *
 * A selection rather than free text because the report has to be groupable - a
 * manager needs to see that duplicates are 40% of voids, which no amount of
 * typed prose at 1am will ever support. The note beside it carries the detail.
 *
 * DUPLICATE leads because it is the case the requirement names: two staff
 * keying the same table.
 */
export const VOID_REASONS = [
    'DUPLICATE',
    'WRONG_ITEM',
    'CUSTOMER_CHANGED',
    'SPILLED',
    'WRONG_TABLE',
    'OTHER',
] as const

export type VoidReason = (typeof VOID_REASONS)[number]

export function isVoidReason(value: unknown): value is VoidReason {
    return typeof value === 'string' && (VOID_REASONS as readonly string[]).includes(value)
}

export type LineLike = {
    id: string
    price: number
    quantity: number
    total?: number
    voidedAt?: Date | string | null
}

export type VoidCheck = { ok: true } | { ok: false; reason: string }

export function liveItems<T extends LineLike>(items: T[]): T[] {
    return items.filter((i) => !i.voidedAt)
}

export function voidedItems<T extends LineLike>(items: T[]): T[] {
    return items.filter((i) => Boolean(i.voidedAt))
}

/** True only when a round has lines and none of them survive. */
export function allVoided(items: LineLike[]): boolean {
    return items.length > 0 && liveItems(items).length === 0
}

/**
 * What a round is worth once the struck lines stop counting.
 *
 * Priced from the line's own snapshotted price, so re-pricing the menu tomorrow
 * cannot change what a round was worth tonight. Tax is inclusive in this till
 * (see lib/currency), so it is not added on top here; the field is carried for
 * the shape the Order row expects.
 */
export function totalsFrom(items: LineLike[]): { subtotal: number; tax: number; total: number } {
    const subtotal = liveItems(items).reduce(
        (sum, i) => sum + (i.total ?? (i.price || 0) * (i.quantity || 0)),
        0
    )
    return { subtotal, tax: 0, total: subtotal }
}

/**
 * May this round be voided at all?
 *
 * Two refusals, both mirroring rules the counter already enforces:
 *
 * A COMPLETED round has reached the drawer. Striking a line out of it would
 * change takings a Z-report may already have counted - that is a refund, with
 * money going back across the counter, not a void.
 *
 * A round from a closed shift is equally settled. The counter's cancel path
 * already refuses this, and a void that could reach backwards would let last
 * night's reconciliation move after it was signed off.
 */
export function canVoid(
    order: { status: string; shiftId?: string | null },
    currentShiftId: string | null
): VoidCheck {
    if (order.status === 'CANCELLED') {
        return { ok: false, reason: 'ALREADY_CANCELLED' }
    }
    if (order.status === 'COMPLETED') {
        return { ok: false, reason: 'ORDER_ALREADY_PAID' }
    }
    // A round keyed before anyone opened a shift belongs to whoever is on now.
    if (order.shiftId && order.shiftId !== currentShiftId) {
        return { ok: false, reason: 'ORDER_FROM_ANOTHER_SHIFT' }
    }
    return { ok: true }
}
