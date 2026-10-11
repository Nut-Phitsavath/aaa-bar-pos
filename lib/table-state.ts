/**
 * What a table is doing right now, as one answer.
 *
 * The floor plan used to work this out inline from a handful of loose booleans
 * - `session`, `needsBill`, `splitCount` - which meant the card, the counts in
 * the header and the legend each decided for themselves what "occupied" meant.
 * They agreed by luck. This is the one place that decides.
 *
 * Five states, mutually exclusive, and three modifiers that can ride on any of
 * them. The split is deliberate: "how many parties" and "have they started
 * paying" are not states a table is in, they are facts about the bill on it,
 * and folding them into the state list would produce a dozen combinations
 * nobody can colour.
 */

export const TABLE_STATES = ['FREE', 'RESERVED', 'OCCUPIED', 'BILL_REQUESTED', 'DIRTY'] as const
export type TableState = (typeof TABLE_STATES)[number]

/**
 * How long a table may wait to pay before it is somebody's problem.
 *
 * Ten minutes, not five: a staff member has to notice, print the bill, walk it
 * over and take the money, and a threshold that fires while they are already
 * doing it teaches people to ignore the colour. Ten is long enough that it
 * means nobody went.
 */
export const BILL_OVERDUE_MINUTES = 10

/**
 * How long a booking stays on the floor plan once its time has passed.
 *
 * Ninety minutes. A party is often late and the room is still theirs; a
 * booking nobody cancelled is not a reason to mark a table reserved until the
 * end of time, which is how a reservation flag becomes wallpaper.
 */
export const RESERVATION_GRACE_MINUTES = 90

export type FloorSession = {
    status: string
    billRequestedAt?: Date | string | null
    /** Confirmed tenders taken against this bill so far. */
    paid?: number
    /** What the bill comes to after discounts. */
    total?: number
}

export type FloorTable = {
    needsClearing?: boolean
    reservedFor?: string | null
    reservedAt?: Date | string | null
    sessions: FloorSession[]
}

export type FloorState = {
    state: TableState
    /** Open bills on the table. More than one means it has been split. */
    bills: number
    /** Money has been taken and something is still owed. */
    partPaid: boolean
    /** Minutes since the bill was asked for, or null if it has not been. */
    waitingMinutes: number | null
    /** Waiting past the threshold - nobody went. */
    overdue: boolean
    /** Shown alongside any state, because a dirty table can also be booked. */
    reservation: { for: string; at: Date } | null
}

const minutesSince = (from: Date, now: Date) =>
    Math.max(0, Math.floor((now.getTime() - from.getTime()) / 60000))

const asDate = (value: Date | string | null | undefined): Date | null => {
    if (!value) return null
    const d = typeof value === 'string' ? new Date(value) : value
    return Number.isNaN(d.getTime()) ? null : d
}

export function resolveTableState(table: FloorTable, now: Date): FloorState {
    const open = table.sessions ?? []

    // A booking is reported whatever else is true - a table can be dirty AND
    // booked for eleven, and the person clearing it needs to know.
    const at = asDate(table.reservedAt)
    const reservation = table.reservedFor && at
        && minutesSince(at, now) <= RESERVATION_GRACE_MINUTES
        ? { for: table.reservedFor, at }
        : null

    // Any confirmed money against a bill that still owes something. Counted
    // across all bills on the table: on a split table one half paying is worth
    // saying, because the other half is what is left to collect.
    const partPaid = open.some((s) =>
        (s.paid ?? 0) > 0 && (s.paid ?? 0) < (s.total ?? 0))

    // The longest wait on the table. Two bills both asking, the older one is
    // the one somebody has been ignoring.
    const waits = open
        .map((s) => asDate(s.billRequestedAt))
        .filter((d): d is Date => d !== null)
        .map((d) => minutesSince(d, now))
    const waitingMinutes = waits.length > 0 ? Math.max(...waits) : null

    const base = {
        bills: open.length,
        partPaid,
        waitingMinutes,
        overdue: waitingMinutes !== null && waitingMinutes >= BILL_OVERDUE_MINUTES,
        reservation,
    }

    // Anyone sitting there outranks everything else: the state list is read to
    // answer "who needs me", and a party in the room is the answer.
    if (open.length > 0) {
        const asking = open.some((s) => s.status === 'BILL_REQUESTED')
        return { ...base, state: asking ? 'BILL_REQUESTED' : 'OCCUPIED' }
    }

    // Before the booking, because dirty is the blocking condition: the table
    // cannot take the party that is coming until somebody clears it.
    if (table.needsClearing) return { ...base, state: 'DIRTY' }
    if (reservation) return { ...base, state: 'RESERVED' }
    return { ...base, state: 'FREE' }
}

/** Is this table available to seat somebody right now? */
export function isSeatable(state: TableState): boolean {
    return state === 'FREE'
}
