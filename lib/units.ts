/**
 * The three unit worlds every ingredient lives in.
 *
 * You buy it in one unit, you count it in another, a recipe consumes it in a
 * third. The trade's answer - SambaPOS calls them Base Unit, Transaction Unit
 * and Multiplier - is to resolve all three back to one base unit and store
 * only that.
 *
 * Before this existed the conversion had nowhere to live, so it went into
 * every recipe row as a repeating decimal: a 30ml pour recorded as
 * 0.04285714285714286 of a bottle. That is what `STOCK_DP` was absorbing.
 *
 * Pure arithmetic, no Prisma: the migration, the API and the screens all have
 * to agree about what a multiplier means, and the cheapest way to guarantee
 * that is one tested module none of them can disagree with.
 */

export type MeasureType = 'WEIGHT' | 'VOLUME' | 'EACH'

/** Derived from the measure type, never typed by a person. */
export const BASE_UNIT: Record<MeasureType, string> = {
    WEIGHT: 'g',
    VOLUME: 'ml',
    EACH: 'each',
}

/**
 * How many decimals a stored quantity keeps.
 *
 * The counter-intuitive one is EACH. Whole-unit items look like the case that
 * needs no decimals, but they are the only case that still has fractional
 * recipe quantities after migration - a quarter lime, 0.15 of a bunch of mint.
 * Grams and millilitres are fine-grained enough to always land on integers.
 */
export const DECIMALS: Record<MeasureType, number> = {
    WEIGHT: 0,
    VOLUME: 0,
    EACH: 2,
}

/**
 * The free-text units in use today, and how to read each one.
 *
 * `bottle` is deliberately null: it means EACH for a Heineken and VOLUME for a
 * bottle of Hongthong you pour 30ml out of. Same string, incompatible maths -
 * which is exactly the ambiguity `measureType` exists to remove. The migration
 * resolves it per ingredient.
 */
export const LEGACY_UNITS: Record<string, { measureType: MeasureType; multiplier: number | null }> = {
    kg: { measureType: 'WEIGHT', multiplier: 1000 },
    litre: { measureType: 'VOLUME', multiplier: 1000 },
    can: { measureType: 'EACH', multiplier: 1 },
    piece: { measureType: 'EACH', multiplier: 1 },
    bunch: { measureType: 'EACH', multiplier: 1 },
    bottle: { measureType: 'EACH', multiplier: null },
}

/** A quantity expressed in purchase units, as a count of base units. */
export function toBase(quantity: number, multiplier: number): number {
    if (!Number.isFinite(quantity) || !Number.isFinite(multiplier)) return 0
    // Rounded to 6 places before the caller rounds again for its measure type:
    // 0.04285714285714286 * 700 is 29.999999999999996 in binary, and a pour
    // that reads as 29 rather than 30 would drift the shelf a millilitre at a
    // time in exactly the way this module exists to stop.
    return Math.round(quantity * multiplier * 1e6) / 1e6
}

/** The inverse, for showing a base quantity in the unit a person buys. */
export function fromBase(base: number, multiplier: number): number {
    if (!Number.isFinite(base) || !Number.isFinite(multiplier) || multiplier === 0) return 0
    return base / multiplier
}

/** Round a value the way its measure type stores it. */
export function roundFor(measureType: MeasureType, value: number): number {
    if (!Number.isFinite(value)) return 0
    const dp = DECIMALS[measureType]
    const factor = 10 ** dp
    return Math.round(value * factor) / factor
}

/**
 * A stock figure as something a person holding a clipboard can act on.
 *
 * "3 bottles + 250 ml", not "3.357". The audit sheet is a piece of paper
 * someone counts against at 2am, and a repeating decimal on it is a number
 * nobody can check.
 */
export function formatDual(
    base: number,
    opts: { measureType: MeasureType; purchaseUnit: string; multiplier: number },
): string {
    const { measureType, purchaseUnit, multiplier } = opts
    const baseUnit = BASE_UNIT[measureType]
    const value = roundFor(measureType, Number(base) || 0)

    const plural = (n: number, unit: string) => `${n} ${unit}${Math.abs(n) === 1 ? '' : 's'}`

    // Whole-unit stock, or a purchase unit that IS the base unit: one figure.
    if (measureType === 'EACH' || multiplier <= 1) {
        return measureType === 'EACH' ? plural(value, purchaseUnit) : `${value} ${baseUnit}`
    }

    // Sign handled explicitly: Math.floor(-2350 / 700) is -4, which would
    // print "-4 bottles + 450 ml" for what is really minus three and a bit.
    const sign = value < 0 ? -1 : 1
    const abs = Math.abs(value)
    const whole = Math.floor(abs / multiplier)
    const rest = roundFor(measureType, abs - whole * multiplier)

    if (whole === 0) return `${sign * rest} ${baseUnit}`
    if (rest === 0) return plural(sign * whole, purchaseUnit)
    return `${plural(sign * whole, purchaseUnit)} + ${rest} ${baseUnit}`
}
