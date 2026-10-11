import { billTotalOf } from './payments.ts'

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

/** Everything needed to price a bill. Exactly what a session row carries. */
export type PricedSession = {
    orders: SessionOrderLike[]
    discountType?: string | null
    discountValue?: number | null
    /**
     * What a promotion took off, snapshotted when it was applied.
     *
     * REQUIRED, not optional, and nullable rather than absent. Optional would
     * let any of the eighteen queries that price a bill forget to select it and
     * silently price the promo at zero - the customer quoted one figure at the
     * table and charged another at the till. Required means the compiler finds
     * every one of them instead of a customer finding one.
     */
    promoDiscount: number | null
}

/**
 * What this table owes. THE one place a bill is priced.
 *
 * Eighteen call sites used to spell out `billTotalOf(sessionTotal(orders),
 * s.discountType, s.discountValue)` by hand - the floor plan, the bill screen,
 * the printed ticket, close, comp, pay-later, payments, tabs, the Z-report,
 * the export, the shift summary. Every one of them had to be found and edited
 * to add a promotion to a bill, and the first one missed would have quoted a
 * customer one figure and charged them another.
 *
 * Order of operations, and it matters: the promotion comes off first, then the
 * manual per-table discount applies to what is left. A promo is part of what
 * the drinks cost - it is priced off the menu - while a manager's discount is
 * a write-off against the bill in front of them. Taking the manual discount off
 * the gross and then the promo as well would discount the same baht twice.
 *
 * The round-up lives at the end, once, in billTotalOf (req #15).
 */
export function sessionBillTotal(session: PricedSession): number {
    const gross = sessionTotal(session.orders)
    const afterPromo = Math.max(0, gross - (session.promoDiscount || 0))
    return billTotalOf(afterPromo, session.discountType, session.discountValue)
}

/** What came off the gross in total: the promotion plus the manual discount. */
export function sessionSavings(session: PricedSession): number {
    return sessionTotal(session.orders) - sessionBillTotal(session)
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

/**
 * May this bill's promo still be re-priced?
 *
 * Pure, so the rule can be tested without a database and stated in one place.
 *
 * Two bills must never be re-priced:
 *
 *   - a CLOSED one, for the obvious reason;
 *   - one that has been REOPENED. This is the trap. Reopening sets the status
 *     back to OPEN, which made the bill look live again - so adding a round to
 *     a bill settled last night would re-price its deal at today's clock. If
 *     the deal had since expired or been switched off, the discount silently
 *     dropped to zero on a bill the customer had already been charged for, and
 *     nothing on any screen would say why the figure moved.
 *
 * A bill that has been settled once has had its deal priced. Reopening exists
 * for corrections - a forgotten round, a wrong tender - not for re-negotiating
 * a promotion that was already honoured.
 */
export function canRepricePromo(session: {
    status: string
    reopenedAt?: Date | string | null
}): boolean {
    if (session.status === 'CLOSED') return false
    if (session.reopenedAt) return false
    return true
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

/**
 * The clock time a table opened: "19:00".
 *
 * Elapsed time answers "how long have they been here", which is what staff scan
 * the floor for. It cannot answer "when did we sit down", which is what a guest
 * disputing a bill asks - and "2h 40m ago" makes them do the arithmetic.
 *
 * 24-hour and zero-padded, matching the printed slip, so the screen and the
 * paper never disagree about the same table. A bar that closes at 3am reads
 * "01:30", not "1:30 AM", which is one glyph to misread at the end of a shift.
 *
 * Seconds are absent for the same reason they are absent from the duration: a
 * table is measured in rounds, not ticks.
 */
export function openedClock(openedAt: Date | string): string {
    const opened = typeof openedAt === 'string' ? new Date(openedAt) : openedAt
    if (Number.isNaN(opened.getTime())) return ''
    return `${String(opened.getHours()).padStart(2, '0')}:${String(opened.getMinutes()).padStart(2, '0')}`
}
