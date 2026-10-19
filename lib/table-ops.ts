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
 * The letters a split hands out, saved on the bills (0 = a).
 *
 * Saved rather than worked out from whichever bills are still open, because
 * that moved: once T1-a paid, T1-b became plain "T1", and a reprint of either
 * said "T1" - two slips for one party, neither saying which half it was.
 *
 * `taken` is every letter already given out on this table tonight, including
 * bills that have since paid and gone, so a letter is never handed out twice
 * in one night. The original keeps its letter, or takes the next free one if
 * it never had one (bills split before letters were saved, or the first split).
 */
export function splitIndexes(parent: number | null, taken: number[]): { parent: number; child: number } {
    const top = taken.length ? Math.max(...taken) : -1
    const p = parent ?? top + 1
    return { parent: p, child: Math.max(p, top) + 1 }
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

/** A bill on a table, for naming purposes only. */
export type BillIdentity = {
    id: string
    openedAt: Date | string
    /** When the row was written. Distinguishes bills that share an openedAt. */
    createdAt?: Date | string
    /** The letter saved when the bill was split (0 = a); null if never split. */
    splitIndex?: number | null
}

/**
 * Order the bills on a table the way both screens must letter them.
 *
 * By opening time first, because that is the order the party sat down in and
 * the order the floor plan already lists them.
 *
 * Then by createdAt, which is what makes "-a" mean the original party rather
 * than a coin toss. Two bills CAN share an openedAt - a split stamps
 * `new Date()` on the child, and a table split in the same millisecond it
 * opened would tie - and falling straight through to id then letters them by
 * UUID order, so the guests who had been there all night could become "T5-b"
 * while the half that just split off took "T5-a". The newer row is always the
 * one that split off.
 *
 * Id last, purely so the sort is total. A comparison that can return 0 for two
 * different bills would letter the same bill "a" on one request and "b" on the
 * next, which is worse than no letter at all.
 */
export function orderBills<T extends BillIdentity>(bills: T[]): T[] {
    return [...bills].sort((a, b) => {
        const at = new Date(a.openedAt).getTime()
        const bt = new Date(b.openedAt).getTime()
        if (at !== bt) return at - bt

        const ac = a.createdAt ? new Date(a.createdAt).getTime() : null
        const bc = b.createdAt ? new Date(b.createdAt).getTime() : null
        if (ac !== null && bc !== null && ac !== bc) return ac - bc

        return a.id.localeCompare(b.id)
    })
}

/**
 * What to call this bill on screen: "T5", or "T5-a" when the table holds more
 * than one.
 *
 * Used by the floor plan's bill picker AND by the till's banner, from this one
 * function on purpose. Both screens letter the same bills, and a till reading
 * "T5-b" while the floor plan calls it "T5-a" would be a waiter charging a
 * party they can see is not the one they picked.
 *
 * An unsplit table keeps its plain name. "T5-a" on a table with one bill is a
 * suffix that answers a question nobody asked.
 *
 * A bill not among the siblings falls back to the table's own name rather than
 * inventing a letter - that happens while a screen is mid-refresh, and a wrong
 * letter is worse than a missing one.
 */
export function billLabel(
    tableName: string,
    siblings: BillIdentity[],
    sessionId: string,
): string {
    // A saved letter is the bill's name for good - see splitIndexes. Working it
    // out from the open bills is only for bills split before letters were saved.
    const saved = siblings.find((s) => s.id === sessionId)?.splitIndex
    if (saved != null) return `${tableName}-${splitSuffix(saved)}`
    if (siblings.length <= 1) return tableName
    const index = orderBills(siblings).findIndex((s) => s.id === sessionId)
    if (index < 0) return tableName
    return `${tableName}-${splitSuffix(index)}`
}

/**
 * Chosen drinks leave for another table's bill (req #2, transfer item).
 *
 * A bottle carried from a floor table into a VIP room; a round rung into the
 * wrong table. This is a SPLIT whose second bill already exists, so it borrows
 * the split's rules wholesale - including the quantities, so a single bottle
 * can leave a line of three.
 *
 * Two rules it adds, both about the destination:
 *
 *   - The receiving bill has to be open and unpaid, for the same reason the
 *     sending one does: a tender belongs to the bill it was taken against, and
 *     drinks arriving underneath it explain a total that no longer exists.
 *
 *   - Sending EVERY drink is a merge, and merge is the operation that closes
 *     the emptied bill properly. Doing it here would leave a session worth
 *     nothing sitting open on the floor for somebody to find later.
 */
export function canSendLines(
    from: SessionLike,
    into: SessionLike,
    lines: SplittableLine[],
    moving: MovingLine[],
    currentShiftId: string | null,
): Check {
    if (from.id === into.id) return { ok: false, reason: 'SAME_BILL' }
    if (!isOpen(into.status)) return { ok: false, reason: 'DESTINATION_NOT_OPEN' }
    if (into.paidCount > 0) return { ok: false, reason: 'DESTINATION_ALREADY_PAID' }

    const check = canSplitQuantities(from, lines, moving, currentShiftId)
    // Said in the language of the operation the staff member chose: "leave one
    // behind" is advice for a split, and the answer here is to use Merge.
    if (!check.ok && check.reason === 'CANNOT_SPLIT_EVERYTHING') {
        return { ok: false, reason: 'CANNOT_SEND_EVERYTHING' }
    }
    return check
}

/**
 * Whether a table's bill can be printed yet.
 *
 * The printed bill is what the customer pays from, and Print Bill mints its QR
 * and marks the table as waiting to pay. It can only list rounds that were
 * sent, so with drinks still in the cart it would hand over a bill and a QR for
 * less than the screen says - and with nothing sent at all, a ฿0 bill that
 * flips the table to "waiting to pay". Send first, then print. Held and
 * cancelled rounds are not on the printed bill, so they do not count as sent.
 *
 * The till passes its cart; the route has no cart and passes 0, so it refuses
 * only the empty bill.
 */
export function canPrintBill(bill: { rounds: { status: string }[]; unsentLines: number }): Check {
    if (bill.unsentLines > 0) return { ok: false, reason: 'UNSENT_ITEMS' }
    if (!bill.rounds.some((r) => r.status !== 'HOLD' && r.status !== 'CANCELLED')) {
        return { ok: false, reason: 'NOTHING_SENT' }
    }
    return { ok: true }
}
