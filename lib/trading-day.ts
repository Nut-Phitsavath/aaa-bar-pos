/**
 * When "today" is, for a bar.
 *
 * Two assumptions were baked into the reports from the cafe this system grew
 * out of, and both are wrong here.
 *
 * The first is that the clock the server happens to be set to is the clock at
 * the bar. `hourlySales` read `createdAt.getHours()`, which is the SERVER's
 * local hour. That works on a laptop sitting in Vientiane and silently shifts
 * every chart by seven hours the day this deploys to a host running UTC - the
 * 23:00 peak would render at 16:00, with nothing to indicate anything is wrong.
 *
 * The second is that a trading day ends at midnight. It does not. This bar
 * takes 35% of its orders between midnight and 07:00; Friday night's takings
 * run into Saturday morning, and everyone who worked that shift calls the whole
 * thing Friday. Bucketing by calendar date splits one night across two rows and
 * makes both of them wrong.
 *
 * Laos is UTC+7 and has never observed daylight saving, so a fixed offset is
 * exact here rather than an approximation - no Intl timezone database, no DST
 * transitions to straddle. If this system is ever sold into a country that does
 * observe it, this is the file that has to change, and it is the only one.
 */

/** Asia/Vientiane. Fixed, because Laos has no daylight saving. */
export const BAR_UTC_OFFSET_MINUTES = 7 * 60

/**
 * The hour a new trading day begins.
 *
 * 06:00, because this bar's last orders land between 03:00 and 07:00 and it is
 * reliably shut at six. Anything rung up before this belongs to the night
 * before. Raising it past the opening hour, or lowering it into trading hours,
 * would split a night in half again.
 */
export const TRADING_DAY_START_HOUR = 6

/**
 * The same instant, shifted so that reading its UTC parts gives the bar's
 * wall-clock time. Never use this for anything but reading those parts - as a
 * point in time it is seven hours wrong, deliberately.
 */
function atTheBar(at: Date): Date {
    return new Date(at.getTime() + BAR_UTC_OFFSET_MINUTES * 60_000)
}

/** The hour shown on the clock behind the bar, 0-23. */
export function barHour(at: Date): number {
    return atTheBar(at).getUTCHours()
}

/**
 * Which night this belongs to, as YYYY-MM-DD.
 *
 * Everything before the boundary is booked to the previous date, so a round
 * poured at 01:00 on Saturday counts towards Friday - the night it was part of.
 */
export function tradingDay(at: Date): string {
    const local = atTheBar(at)
    if (local.getUTCHours() < TRADING_DAY_START_HOUR) {
        local.setUTCDate(local.getUTCDate() - 1)
    }
    return local.toISOString().slice(0, 10)
}

/**
 * The 24 hours in the order a night actually runs, starting at the boundary.
 *
 * This is what stops the busiest stretch of the evening being drawn as two
 * separate clumps at opposite ends of a chart, which is what a plain 00-23 axis
 * does to anywhere that trades past midnight.
 */
export function tradingHours(): string[] {
    return Array.from({ length: 24 }, (_, i) =>
        String((TRADING_DAY_START_HOUR + i) % 24).padStart(2, '0'),
    )
}
