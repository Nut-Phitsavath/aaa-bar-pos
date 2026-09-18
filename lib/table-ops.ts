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

/** One line, and how many of its units are leaving. */
export type MovingLine = { itemId: string; quantity: number }

export type SplittableLine = {
    id: string
    quantity: number
    /** True when a package exchange is logged against this line. */
    hasSwap?: boolean
}

/**
 * The same split, by the unit rather than by the line.
 *
 * A line carries a quantity: two whiskeys keyed together are ONE row of two,
 * because the till merges identical items. So "the guest leaving early pays for
 * their whiskey" was impossible - the only choice was both whiskeys or neither,
 * and 65% of real lines carry more than one unit.
 *
 * Three rules change once quantities are in play:
 *
 *   - "Everything is leaving" is now counted in UNITS, not rows. Taking 1 of 2
 *     from every line on the bill leaves a real bill behind and is allowed;
 *     taking all of every line is still a merge wearing a split's clothes.
 *
 *   - A quantity has to be a whole number of drinks, at least one, and no more
 *     than the line holds. Half a beer is not a thing the bar can pour back.
 *
 *   - A line with an exchange logged against it moves WHOLE or not at all. The
 *     swap points at one order line, so splitting that row leaves no honest
 *     answer to which half the exchange happened on - and the upcharge that
 *     rides with it would have to follow both halves at once.
 */
export function canSplitQuantities(
    session: SessionLike,
    lines: SplittableLine[],
    moving: MovingLine[],
    currentShiftId: string | null,
): Check {
    if (!isOpen(session.status)) return { ok: false, reason: 'SESSION_NOT_OPEN' }
    if (session.paidCount > 0) return { ok: false, reason: 'ALREADY_PAID' }
    if (!currentShiftId) return { ok: false, reason: 'NO_OPEN_SHIFT' }
    if (moving.length === 0) return { ok: false, reason: 'NOTHING_SELECTED' }

    const byId = new Map(lines.map((l) => [l.id, l]))
    const seen = new Set<string>()
    let unitsMoving = 0

    for (const pick of moving) {
        const line = byId.get(pick.itemId)
        if (!line) return { ok: false, reason: 'LINE_NOT_ON_BILL' }
        if (seen.has(pick.itemId)) return { ok: false, reason: 'DUPLICATE_LINE' }
        seen.add(pick.itemId)

        if (!Number.isInteger(pick.quantity)) return { ok: false, reason: 'QUANTITY_MUST_BE_WHOLE' }
        if (pick.quantity < 1) return { ok: false, reason: 'QUANTITY_MUST_BE_POSITIVE' }
        if (pick.quantity > line.quantity) return { ok: false, reason: 'MORE_THAN_ORDERED' }

        if (line.hasSwap && pick.quantity !== line.quantity) {
            return { ok: false, reason: 'SWAPPED_LINE_MOVES_WHOLE' }
        }

        unitsMoving += pick.quantity
    }

    const unitsOnBill = lines.reduce((sum, l) => sum + l.quantity, 0)
    if (unitsMoving >= unitsOnBill) return { ok: false, reason: 'CANNOT_SPLIT_EVERYTHING' }

    return { ok: true }
}

/**
 * The exchange upcharge lines that have to travel with this selection.
 *
 * Same rule as withSwapCharges, expressed for quantities: a package leaving
 * whole takes its upcharge line whole with it. A partial move of a swapped
 * package is refused above, so there is no partial case to answer here.
 *
 * Returns ids, not quantities. The caller already knows how many units each
 * line holds, and "the whole line" said as a number would be a sentinel
 * somebody has to decode.
 */
export function swapChargeLineIds(
    moving: MovingLine[],
    swaps: { orderItemId: string; chargeItemId: string | null }[],
): string[] {
    const picked = new Set(moving.map((m) => m.itemId))
    const extra: string[] = []
    for (const swap of swaps) {
        if (!swap.chargeItemId) continue
        if (!picked.has(swap.orderItemId)) continue
        if (picked.has(swap.chargeItemId)) continue
        extra.push(swap.chargeItemId)
    }
    return extra
}
