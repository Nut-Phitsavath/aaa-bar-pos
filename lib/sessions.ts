/**
 * Open table sessions: bill math and lifecycle rules.
 *
 * Pure functions only — no Prisma import. The floor plan, the POS banner, the
 * bill screen and the close endpoint all price a session through here, so the
 * card, the screen and the printed bill cannot disagree.
 */

/** A session is "open" until it is settled. BILL_REQUESTED still occupies the table. */
export const SESSION_OPEN_STATUSES = ['OPEN', 'BILL_REQUESTED'] as const

/** Order statuses that count towards a table's bill. */
export const BILLABLE_ORDER_STATUSES = ['SENT', 'COMPLETED'] as const

export type SessionOrderLike = { status: string; total: number }
export type CloseCheck = { ok: true } | { ok: false; reason: string }

export function sessionTotal(orders: SessionOrderLike[]): number {
    return orders
        .filter((o) => (BILLABLE_ORDER_STATUSES as readonly string[]).includes(o.status))
        .reduce((sum, o) => sum + (o.total || 0), 0)
}

/**
 * "2:05" — hours and padded minutes since the table opened.
 *
 * `now` is passed in rather than read here so the caller controls the ticking
 * interval and the function stays testable.
 */
/**
 * How long a table has been open, written to be read at a glance.
 *
 * Not h:mm. That printed a table opened a minute ago as "0:01", which reads as
 * one second to anybody who has looked at a stopwatch - and a table spends its
 * whole first hour in that range, so the format was wrong exactly when staff
 * most need to trust it. Under an hour this says "34m" and there is nothing to
 * misread; past an hour "2h 05m", with the minutes padded so the number stops
 * jumping width as the night goes on.
 *
 * Seconds are deliberately absent. A bar table is measured in rounds, not
 * ticks, and a figure that changes every second on a screen nobody is watching
 * is just movement.
 *
 * Clamped at zero: two devices on a bar's wifi do not agree to the second, and
 * a table reading "-3m" is a bug report where "0m" is a table just opened.
 */
export function formatDuration(openedAt: Date | string, now: Date): string {
    const opened = typeof openedAt === 'string' ? new Date(openedAt) : openedAt
    const minutes = Math.max(0, Math.floor((now.getTime() - opened.getTime()) / 60000))
    if (minutes < 60) return `${minutes}m`
    return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

export function canCloseSession(session: { status: string }, orders: SessionOrderLike[]): CloseCheck {
    if (session.status === 'CLOSED') {
        return { ok: false, reason: 'SESSION_ALREADY_CLOSED' }
    }
    if (orders.some((o) => o.status === 'HOLD')) {
        return { ok: false, reason: 'SESSION_HAS_HELD_ORDER' }
    }
    return { ok: true }
}
