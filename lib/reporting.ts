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

import { sessionTotal, type SessionOrderLike, sessionBillTotal } from './sessions.ts'
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
    /** Required, not optional - see the note on PricedSession. */
    promoDiscount: number | null
    orders: SessionOrderLike[]
}

/**
 * What the bar gave away at the table over a period.
 *
 * Both kinds of giveaway: the manual per-table discount a manager authorises
 * (req #15) and whatever a promotion took off. They are summed rather than
 * reported apart because this figure has one job - to be the difference
 * between what was rung up and what was billed - and a "discounts" total that
 * quietly omitted promotions would put net revenue back out of step with the
 * bills, which is the whole fault this function exists to have fixed.
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
        return sum + (gross - sessionBillTotal(s))
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

export type AreaSession = DiscountedSession & {
    openedAt: Date
    closedAt: Date | null
    table: { id: string; name: string; area: string; seats: number } | null
}

type Tally = { revenue: number; bills: number; minutes: number }

const figures = (t: Tally) => ({
    revenue: Math.round(t.revenue),
    bills: t.bills,
    avgBill: t.bills > 0 ? Math.round(t.revenue / t.bills) : 0,
    avgMinutes: t.bills > 0 ? Math.round(t.minutes / t.bills) : 0,
    revenuePerHour: t.minutes > 0 ? Math.round(t.revenue / (t.minutes / 60)) : 0,
})

/**
 * Where in the room the money came from: each area, and the tables inside it.
 *
 * Priced off the closed bill (sessionBillTotal), so a discounted VIP table is
 * compared on what it actually paid; callers pass sessions closed in the
 * period, since only a settled bill has a length.
 *
 * Per hour is the area's column to read - takings alone reward a table for
 * sitting there all night. Per seat-hour is the table's: it divides by the
 * seats as well, so a two-top and an eight-seat VIP room can be compared on
 * the same footing (Table.seats).
 */
export function areaStats(sessions: AreaSession[]) {
    const areas = new Map<string, Tally & { tables: Map<string, Tally & { name: string; seats: number }> }>()
    for (const s of sessions) {
        const areaName = s.table?.area || 'Unknown'
        if (!areas.has(areaName)) areas.set(areaName, { revenue: 0, bills: 0, minutes: 0, tables: new Map() })
        const area = areas.get(areaName)!
        const key = s.table?.id ?? '-'
        if (!area.tables.has(key)) area.tables.set(key, { name: s.table?.name ?? '-', seats: s.table?.seats ?? 0, revenue: 0, bills: 0, minutes: 0 })
        const table = area.tables.get(key)!
        const revenue = sessionBillTotal(s)
        // Clamped at zero: two tills on a bar's wifi do not agree to the
        // second, and a negative length would drag an average sideways.
        const minutes = Math.max(0, ((s.closedAt?.getTime() ?? 0) - s.openedAt.getTime()) / 60000)
        for (const t of [area, table]) { t.revenue += revenue; t.bills += 1; t.minutes += minutes }
    }
    return [...areas.entries()].map(([area, a]) => ({
        area,
        ...figures(a),
        tables: [...a.tables.entries()].map(([id, t]) => ({
            id,
            name: t.name,
            seats: t.seats,
            ...figures(t),
            revenuePerSeatHour: t.minutes > 0 && t.seats > 0 ? Math.round(t.revenue / (t.minutes / 60) / t.seats) : 0,
        })).sort((x, y) => y.revenue - x.revenue),
    })).sort((x, y) => y.revenue - x.revenue)
}
