/**
 * What a drink costs to pour, and whether that is a sane number.
 *
 * Lifted out of prisma/checkPourCost.js, which has been doing this correctly
 * from a terminal where nobody at the bar could see it. The bands came with it
 * and are deliberately NOT the trade's textbook figures - see BANDS below.
 *
 * Pure arithmetic, no Prisma, so the recipe screen and the CLI check give the
 * same answer rather than drifting apart.
 */

/**
 * [floor, ceiling] as a percentage of the selling price.
 *
 * Calibrated for this bar, not copied from a guide. Imported spirit is
 * duty-heavy and priced against the street; local beer is cheap on the shelf
 * in Laos and priced against the bar next door; a mixer is priced low on
 * purpose because the margin is in what it mixes. Widening or narrowing these
 * is a pricing decision, not a tidy-up.
 */
export const BANDS: Record<string, [number, number]> = {
    Beer: [20, 40],
    Sets: [25, 45],      // bottle service trades volume for margin
    Spirits: [15, 30],
    Cocktails: [20, 35], // imported spirit, duty-heavy, priced against the street
    Mixers: [12, 50],    // priced low on purpose; the margin is in what it mixes
    Snacks: [20, 40],
}

/**
 * No opinion. A category nobody has banded should not be flagged as though
 * somebody had decided what it ought to earn.
 */
const DEFAULT_BAND: [number, number] = [0, 100]

export function bandFor(category: string | null | undefined): [number, number] {
    if (!category) return DEFAULT_BAND
    return BANDS[category] ?? DEFAULT_BAND
}

export type CostLine = {
    /** In base units, as Recipe.quantity stores it after the units migration. */
    quantity: number
    /** Ingredient.cost, which is per PURCHASE unit - what the invoice says. */
    costPerPurchaseUnit: number
    /** Base units per purchase unit, e.g. 700 for a 700ml bottle. */
    purchaseMultiplier: number
}

/**
 * What the ingredients in one serving are worth, to the satang.
 *
 * The divisor is the part that changed with base units. This used to read
 * `quantity * cost` because quantity was a fraction of a purchase unit; now
 * quantity is 30 (ml) rather than 0.0428 (bottles), so the cost has to come
 * down to per-base-unit or a single whisky would price at 700 times its worth.
 */
export function recipeCost(lines: CostLine[]): number {
    const total = lines.reduce((sum, l) => {
        if (!Number.isFinite(l.quantity) || !Number.isFinite(l.costPerPurchaseUnit)) return sum
        // A zero multiplier is bad data. Skipping the line keeps one broken
        // ingredient from turning the whole footer into NaN.
        if (!Number.isFinite(l.purchaseMultiplier) || l.purchaseMultiplier === 0) return sum
        return sum + l.quantity * (l.costPerPurchaseUnit / l.purchaseMultiplier)
    }, 0)
    return Math.round(total * 100) / 100
}

/** Cost as a percentage of price. A free item is 0, not infinity. */
export function pourCost(cost: number, price: number): number {
    if (!Number.isFinite(price) || price <= 0) return 0
    return Math.round((cost / price) * 1000) / 10
}

export type Verdict = 'BELOW_COST' | 'HIGH' | 'OK' | 'LOW'

/**
 * Selling below cost is its own verdict rather than "very high", because a
 * manager reading a list needs the item that loses money to stand out from the
 * one that is merely priced thin.
 */
export function verdictFor(category: string | null | undefined, pourCostPct: number): Verdict {
    if (pourCostPct >= 100) return 'BELOW_COST'
    const [floor, ceiling] = bandFor(category)
    if (pourCostPct > ceiling) return 'HIGH'
    if (pourCostPct < floor) return 'LOW'
    return 'OK'
}
