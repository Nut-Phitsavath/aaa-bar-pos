/**
 * What counts as a sale, in one place.
 *
 * Six routes used to answer this independently - reports/analytics,
 * reports/export, reports/z, dashboard/stats, shifts/status and
 * table-sessions/[id]/pay-later - and they drifted, which is not a risk but a
 * thing that already happened: the reports page and the Z-report disagreed on
 * the same night's takings because one netted off the per-table discount and
 * the other did not, and the Excel export counted drinks that had been voided.
 *
 * Pure functions and plain filter objects, no Prisma import, so the definition
 * can be tested without a database and a route cannot quietly fork it.
 */

import { sessionTotal, type SessionOrderLike } from './sessions.ts'
import { billTotalOf } from './payments.ts'

/**
 * An order that counts towards revenue.
 *
 * COMPLETED only: a round still sitting SENT on an open table has not been
 * paid for, and `lib/settle.ts` completes them all when the bill closes.
 * `isReportable` is the cafe's complimentary flag - the bar does not write it,
 * but an order carrying it must still stay out.
 */
export const COUNTED_ORDER = { status: 'COMPLETED', isReportable: true } as const

/**
 * A line that counts towards revenue.
 *
 * A struck line is not a sale. The order's own total is recomputed on void so
 * bill-level figures were always right; every per-item figure that forgot this
 * counted drinks that had been taken back off, and charged the bar for pouring
 * them.
 */
export const COUNTED_LINE = { voidedAt: null } as const

export type DiscountedSession = {
    discountType: string | null
    discountValue: number | null
    orders: SessionOrderLike[]
}

/**
 * What the bar gave away at the table over a period (requirement #15).
 *
 * `Order.discount` is the cafe's per-order discount and this bar has never
 * written it - measured across the whole database it is 0 on every order, while
 * table bills carry PERCENT discounts most nights. Summing that column reported
 * zero discounts on a bar that discounts constantly, and left every revenue and
 * profit figure gross of money that was never taken.
 *
 * Priced through `billTotalOf`, the same helper the bill screen and the
 * Z-report use, so what the customer was charged and what the report says
 * cannot drift apart. The difference includes the round-up, because the
 * round-up is part of what they paid.
 *
 * Callers must pass sessions whose `orders` are already filtered to
 * COUNTED_ORDER. Pricing the discount over a wider set than the revenue it is
 * subtracted from takes money off a base that was never added - four rounds
 * left SENT on closed bills in the dev database moved the total by ฿297 that
 * way.
 */
export function periodDiscounts(sessions: DiscountedSession[]): number {
    return sessions.reduce((sum, s) => {
        const gross = sessionTotal(s.orders)
        return sum + (gross - billTotalOf(gross, s.discountType, s.discountValue))
    }, 0)
}

/**
 * Net revenue for a period: what was billed, after the table discount.
 *
 * The same figure the Z-report calls `net`. Comped bills stay inside it and are
 * reported on their own line, exactly as the Z-report treats them - an owner
 * comp is a sale the house paid for, not a sale that never happened.
 */
export function netRevenue(grossRevenue: number, discounts: number): number {
    return grossRevenue - discounts
}
