/**
 * The shift is the container every sale belongs to.
 *
 * Without one, an order completes with `shiftId: null` and a table's cash
 * payment is recorded but added to no drawer count - so the money is taken and
 * the night is simply never counted. Nothing is stolen; it is worse than that,
 * because nobody can tell afterwards whether anything was.
 *
 * The counter used to guard this with a single `if` on a button, which the
 * table flow walked straight past because it never presses that button. So the
 * rule lives here and is enforced in the routes, where every surface has to
 * pass through it.
 *
 * Modelled on SambaPOS work periods: no tickets without one, and it cannot be
 * ended while a ticket is still open - settle it, or move it to a customer's
 * account to be paid another day.
 */

export const NO_OPEN_SHIFT = 'NO_OPEN_SHIFT'
export const TABLES_STILL_OPEN = 'TABLES_STILL_OPEN'

export type ShiftLike = { id: string; status: string } | null | undefined

export type OpenTable = { id: string; table: string; balance: number }

export type ShiftCheck =
    | { ok: true }
    | { ok: false; reason: typeof NO_OPEN_SHIFT }

export type CloseCheck =
    | { ok: true }
    | { ok: false; reason: typeof TABLES_STILL_OPEN; tables: OpenTable[]; outstanding: number }

/**
 * May the bar trade at all right now?
 *
 * Checks the status rather than trusting that whoever fetched the row filtered
 * on it - a closed shift found by id is not an open shift.
 */
export function requireOpenShift(shift: ShiftLike): ShiftCheck {
    if (shift && shift.status === 'OPEN') return { ok: true }
    return { ok: false, reason: NO_OPEN_SHIFT }
}

/**
 * May this shift be closed out?
 *
 * A table that is still open is a customer still sitting there, whether or not
 * they have ordered yet, so an empty one blocks the close exactly as a full one
 * does. The names and balances come back with the refusal because being told
 * "no" without being told what is holding it is the thing that traps staff at
 * 3am hunting for a table nobody can see.
 *
 * Ordered by what is owed so the manager settles the expensive ones first.
 */
export function canCloseShift(openTables: OpenTable[]): CloseCheck {
    if (openTables.length === 0) return { ok: true }

    return {
        ok: false,
        reason: TABLES_STILL_OPEN,
        tables: [...openTables].sort((a, b) => b.balance - a.balance),
        outstanding: openTables.reduce((sum, t) => sum + (t.balance || 0), 0),
    }
}
