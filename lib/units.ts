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

/**
 * The fields any screen needs to read or write a stock quantity correctly.
 *
 * Stock is stored in base units; people think and type in purchase units. Every
 * screen that takes a quantity from a person has to convert, and every screen
 * that shows one has to convert back. Naming that contract here is what stops
 * a dialog quietly adding 12 millilitres when someone meant 12 bottles.
 */
export type UnitBearing = {
    measureType: MeasureType
    purchaseUnit: string
    purchaseMultiplier: number
    /**
     * Legacy free-text unit. Optional and unused by anything here - it is kept
     * only so records that still carry it satisfy this shape, and deliberately
     * not required, because nothing about a conversion depends on it.
     */
    unit?: string
}

/**
 * `formatDual` for anything already carrying the standard unit fields.
 *
 * Exists because the field is `purchaseMultiplier` on a record and `multiplier`
 * in the formatter's options, and hand-mapping that at every call site is one
 * typo away from printing a bottle count as millilitres.
 */
export function formatStockOf(value: number, item: UnitBearing): string {
    return formatDual(value, {
        measureType: item.measureType,
        purchaseUnit: item.purchaseUnit,
        multiplier: item.purchaseMultiplier,
    })
}

export type ConversionInput = {
    name: string
    measureType: MeasureType
    purchaseUnit: string
    purchaseMultiplier: number
    cost: number
}

export type ConversionEcho = {
    valid: boolean
    reason?: 'MULTIPLIER_MUST_BE_POSITIVE' | 'PURCHASE_UNIT_REQUIRED'
    /** Plain language, for a person to check against what they meant. */
    sentence: string
    /** What one base unit costs, derived and never stored. */
    costPerBase: number | null
}

/**
 * The guardrail on the one field that can silently corrupt every future number.
 *
 * A multiplier is not a value anyone can sanity-check on its own - 700 and 7
 * look equally plausible in a box. Read back as "450/bottle = 0.64 per ml"
 * versus "= 64.29 per ml", the mistake is obvious to anyone who has ever bought
 * a bottle. That is the whole design: make the wrong entry look wrong at the
 * moment it is made, because after the first delivery it is invisible.
 *
 * Pure, so the guardrail is tested rather than merely rendered.
 */
export function describeConversion(input: ConversionInput): ConversionEcho {
    const { name, measureType, purchaseUnit, purchaseMultiplier, cost } = input
    const unit = (purchaseUnit ?? '').trim()
    const baseUnit = BASE_UNIT[measureType]
    const label = name?.trim() || 'This item'

    if (!unit) {
        return { valid: false, reason: 'PURCHASE_UNIT_REQUIRED', sentence: '', costPerBase: null }
    }
    if (!Number.isFinite(purchaseMultiplier) || purchaseMultiplier <= 0) {
        return { valid: false, reason: 'MULTIPLIER_MUST_BE_POSITIVE', sentence: '', costPerBase: null }
    }

    const safeCost = Number.isFinite(cost) && cost > 0 ? cost : 0
    const raw = safeCost / purchaseMultiplier
    // Two places is right for money, but a gram of ice costs 0.003 and
    // rounding that to "0" reads as free - on exactly the bulk items where a
    // wrong multiplier is easiest to type. Keep enough places to stay a number.
    const places = raw > 0 && raw < 0.01 ? 4 : 2
    const factor = 10 ** places
    const costPerBase = Math.round(raw * factor) / factor

    // An EACH item buys and counts in the same thing, so a "1 bottle = 1 each"
    // clause would be noise pretending to be information.
    const conversion = measureType === 'EACH' ? '' : ` (${purchaseMultiplier} ${baseUnit})`

    const counted = measureType === 'EACH'
        ? `Stock is counted in whole ${unit}s.`
        : `Stock is counted in ${baseUnit}.`

    // When a purchase unit IS the base unit, cost-per-purchase and
    // cost-per-base are the same number, and "18/bottle = 18 per bottle" is
    // the sentence saying it twice. The conversion clause is the whole point
    // of the echo, so it only appears where there is a conversion.
    const priced = safeCost === 0
        ? ''
        : measureType === 'EACH' || purchaseMultiplier === 1
            ? ` ${safeCost} per ${unit}.`
            : ` ${safeCost}/${unit} = ${costPerBase} per ${baseUnit}.`

    return {
        valid: true,
        sentence: `You buy ${label} by the ${unit}${conversion}. ${counted}${priced}`,
        costPerBase,
    }
}
