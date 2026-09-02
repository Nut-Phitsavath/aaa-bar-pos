/**
 * Money.
 *
 * THB is the till's currency: every price, order total and report figure is a
 * number of baht. LAK and USD are *display conversions* computed from a rate,
 * never stored as prices.
 *
 * The rate is a per-transaction fact, not a global one. A closed bill carries
 * the rate it was settled at (TableSession.fxRateLAK / fxRateUSD), so changing
 * the rate in settings tomorrow cannot rewrite what a customer was charged
 * last night. That is requirement #18, and it only works because the functions
 * below are pure: rate in, figure out, no reading of settings from in here.
 *
 * Never pass a Lao locale to Intl. Chrome ships no 'lo' locale data and
 * silently falls back to English while Node renders Lao, which throws away the
 * server HTML and rebuilds on the client. See lib/date.ts for the full story.
 * Everything here formats through 'en-US' grouping with explicit symbols.
 */

/** 1 THB = this many LAK. Market was ~680 when written; owner sets the real one. */
export const DEFAULT_RATE_LAK = 680

/** 1 USD = this many THB. Reads the way a rate board does. */
export const DEFAULT_RATE_USD = 32

const group = (n: number, decimals = 0) =>
    new Intl.NumberFormat('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    }).format(n)

/** Guards every formatter: a bad number prints as zero, never "NaN" on a bill. */
const safe = (amount: number): number =>
    typeof amount === 'number' && Number.isFinite(amount) ? amount : 0

export function formatTHB(amount: number): string {
    return `฿${group(Math.round(safe(amount)))}`
}

export function formatLAK(amount: number): string {
    return `${group(Math.round(safe(amount)))} ₭`
}

export function formatUSD(amount: number): string {
    return `$${group(safe(amount), 2)}`
}

/** Convert a baht figure to kip at the given rate. Whole kip: there is no smaller note. */
export function thbToLak(thb: number, rateLak: number): number {
    const rate = safe(rateLak)
    if (rate <= 0) return 0
    return Math.round(safe(thb) * rate)
}

/** Convert a baht figure to dollars. `rateUsd` is baht-per-dollar, e.g. 32. */
export function thbToUsd(thb: number, rateUsd: number): number {
    const rate = safe(rateUsd)
    if (rate <= 0) return 0
    return Math.round((safe(thb) / rate) * 100) / 100
}

/** Notes and coins actually in a Thai drawer, largest first when making change. */
export const THB_DENOMINATIONS = [1, 2, 5, 10, 20, 50, 100, 500, 1000]

export function calculateChange(total: number, cashReceived: number) {
    const totalChange = safe(cashReceived) - safe(total)
    const denominations: { denom: number; count: number }[] = []

    // Short payment is reported as a negative figure for the "missing amount"
    // display; breaking a shortfall into notes would be nonsense.
    let remaining = totalChange
    if (remaining > 0) {
        for (const denom of [...THB_DENOMINATIONS].sort((a, b) => b - a)) {
            const count = Math.floor(remaining / denom)
            if (count > 0) {
                denominations.push({ denom, count })
                remaining -= denom * count
            }
        }
    }

    return { totalChange, denominations }
}

export function calculateTax(amount: number, rate: number = 10): number {
    return Math.round(safe(amount) * (rate / 100))
}

export function calculateInclusiveTax(total: number, rate: number = 10): number {
    if (rate <= 0) return 0
    const net = safe(total) / (1 + rate / 100)
    return Math.round(safe(total) - net)
}
