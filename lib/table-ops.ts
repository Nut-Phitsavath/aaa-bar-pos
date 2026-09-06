/**
 * Moving, merging and splitting tables (req #2).
 *
 * Three operations that look similar and are not. A MOVE changes which table a
 * bill points at and touches nothing else. A MERGE pours one bill's rounds into
 * another and closes the empty one. A SPLIT lifts chosen lines onto a second
 * bill at the same table, for the guest leaving early.
 *
 * None of them needs a manager PIN - the owner's call, and consistent with
 * exchanges: they happen constantly on a busy floor and a PIN would be worked
 * around. What keeps them honest is that none of them can change what anybody
 * owes. Money already taken is the line: a bill with a confirmed payment on it
 * cannot be merged or split, because a tender belongs to a bill and there is no
 * honest answer to which half it follows.
 *
 * Pure functions, no Prisma: the till greys out what it cannot do and the route
 * refuses the same things, from the same rules.
 */

export const SESSION_OPEN_STATUSES = ['OPEN', 'BILL_REQUESTED'] as const

export type Check = { ok: true } | { ok: false; reason: string }

type SessionLike = {
    id: string
    status: string
    /** Confirmed tenders only - the caller filters unconfirmed QR legs out. */
    paidCount: number
    shiftId?: string | null
}

const isOpen = (status: string) => (SESSION_OPEN_STATUSES as readonly string[]).includes(status)

/**
 * A party changing seats.
 *
 * The lightest of the three: the bill is unchanged, it just points somewhere
 * else. Allowed even after part payment, because nothing about the money moves.
 */
export function canMove(
    session: { status: string },
    target: { id: string; isActive: boolean; occupied: boolean },
    currentTableId: string,
): Check {
    if (!isOpen(session.status)) return { ok: false, reason: 'SESSION_NOT_OPEN' }
    if (target.id === currentTableId) return { ok: false, reason: 'SAME_TABLE' }
    if (!target.isActive) return { ok: false, reason: 'TABLE_INACTIVE' }
    if (target.occupied) return { ok: false, reason: 'TABLE_OCCUPIED' }
    return { ok: true }
}

/**
 * Two tables becoming one party.
 *
 * `from` is emptied and closed; `into` keeps its own identity, its opening time
 * and its reference. Refused once either side has taken money: a tender belongs
 * to the bill it was taken against, and moving rounds out from under it would
 * leave a payment explaining a total that no longer exists.
 */
export function canMerge(from: SessionLike, into: SessionLike, currentShiftId: string | null): Check {
    if (from.id === into.id) return { ok: false, reason: 'SAME_BILL' }
    if (!isOpen(from.status) || !isOpen(into.status)) return { ok: false, reason: 'SESSION_NOT_OPEN' }
    if (from.paidCount > 0 || into.paidCount > 0) return { ok: false, reason: 'ALREADY_PAID' }
    if (!currentShiftId) return { ok: false, reason: 'NO_OPEN_SHIFT' }
    return { ok: true }
}

/**
 * One guest paying for their own drinks.
 *
 * Lines move to a second bill on the same table. At least one line has to stay
 * behind: a "split" that takes everything is a bill with a new reference and no
 * reason to exist, and it would leave an empty session cluttering the floor.
 */
export function canSplit(
    session: SessionLike,
    liveLineIds: string[],
    movingIds: string[],
    currentShiftId: string | null,
): Check {
    if (!isOpen(session.status)) return { ok: false, reason: 'SESSION_NOT_OPEN' }
    if (session.paidCount > 0) return { ok: false, reason: 'ALREADY_PAID' }
    if (!currentShiftId) return { ok: false, reason: 'NO_OPEN_SHIFT' }
    if (movingIds.length === 0) return { ok: false, reason: 'NOTHING_SELECTED' }

    const live = new Set(liveLineIds)
    const seen = new Set<string>()
    for (const id of movingIds) {
        if (!live.has(id)) return { ok: false, reason: 'LINE_NOT_ON_BILL' }
        if (seen.has(id)) return { ok: false, reason: 'DUPLICATE_LINE' }
        seen.add(id)
    }
    if (movingIds.length >= liveLineIds.length) return { ok: false, reason: 'CANNOT_SPLIT_EVERYTHING' }
    return { ok: true }
}

/**
 * The second bill's name: T5 becomes T5-a, then T5-b.
 *
 * Suffixed rather than numbered so the original bill keeps reading as the table
 * it is, and staff calling across the floor can say "T5-b" and be understood.
 */
export function splitSuffix(existingSplits: number): string {
    // 0 -> a, 1 -> b. Past 26 it keeps counting rather than wrapping silently.
    return existingSplits < 26
        ? String.fromCharCode(97 + existingSplits)
        : String(existingSplits + 1)
}

/**
 * An exchange upcharge travels with the package line it came from.
 *
 * "ສ່ວນຕ່າງການແລກປ່ຽນ" is not a line a guest ordered - it is the price
 * difference on somebody's set, written as its own line so the receipt shows
 * what was charged and why. Left behind by a split it becomes one guest paying
 * the difference on another guest's package, which is money on the wrong bill
 * and no way to read back who owed it.
 *
 * So the charge follows its package, and never moves alone however it was
 * ticked. Returned as ids rather than applied, so the ordinary split guards
 * still run over the final set.
 */
export function withSwapCharges(
    movingIds: string[],
    swaps: { orderItemId: string; chargeItemId: string | null }[],
): string[] {
    const picked = new Set(movingIds)
    for (const swap of swaps) {
        if (!swap.chargeItemId) continue
        if (picked.has(swap.orderItemId)) picked.add(swap.chargeItemId)
        else picked.delete(swap.chargeItemId)
    }
    return [...picked]
}
