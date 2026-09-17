// Shared validation for promotion create/update so a nonsensical promo
// (200%, negative, or end-before-start) can't be saved. The orders route also
// clamps a promo's effect at checkout, but this stops bad data at the source.

export type PromotionInput = {
    name?: string
    code?: string
    discountType?: string
    discountValue?: unknown
    startDate?: unknown
    endDate?: unknown
    minItems?: unknown
    staffPickable?: unknown
    categoryId?: unknown
}

export type PromotionValidation =
    | {
        ok: true
        value: number
        start: Date
        end: Date
        minItems: number | null
        staffPickable: boolean
        categoryId: string | null
    }
    | { ok: false; error: string }

export function validatePromotionInput(body: PromotionInput): PromotionValidation {
    const { name, code, discountType, discountValue, startDate, endDate, minItems, staffPickable, categoryId } = body

    if (!name || !code || !discountType) {
        return { ok: false, error: 'Name, code, and discount type are required' }
    }
    if (discountType !== 'percentage' && discountType !== 'fixed') {
        return { ok: false, error: "discountType must be 'percentage' or 'fixed'" }
    }

    const value = parseFloat(String(discountValue))
    if (isNaN(value) || value < 0) {
        return { ok: false, error: 'discountValue must be a non-negative number' }
    }
    if (discountType === 'percentage' && value > 100) {
        return { ok: false, error: 'Percentage discount cannot exceed 100' }
    }

    const start = new Date(startDate as any)
    const end = new Date(endDate as any)
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return { ok: false, error: 'Valid start and end dates are required' }
    }
    if (end <= start) {
        return { ok: false, error: 'End date must be after start date' }
    }

    // Blank means "no minimum". Anything else must be a whole positive count of
    // drinks, because it is compared against a cart quantity.
    let minCount: number | null = null
    if (minItems !== undefined && minItems !== null && String(minItems).trim() !== '') {
        minCount = Number(minItems)
        if (!Number.isInteger(minCount) || minCount < 1) {
            return { ok: false, error: 'Minimum items must be a whole number of 1 or more' }
        }
    }

    // Which shelf the deal is about. Blank means the whole bill, and the
    // empty string a <select> sends for "no choice" has to mean that too -
    // otherwise saving an unscoped promo writes "" as a category id and the
    // deal silently matches nothing.
    const scope =
        typeof categoryId === 'string' && categoryId.trim() !== '' ? categoryId.trim() : null

    return {
        ok: true,
        value,
        start,
        end,
        minItems: minCount,
        staffPickable: staffPickable !== false,
        categoryId: scope,
    }
}


// ---------------------------------------------------------------------------
// One promo calculation, used by the cart total, the promo picker and the
// orders API. Keeping it in one place is the point: when the till shows a
// discount the server won't honour, the drawer comes up short.
// ---------------------------------------------------------------------------

export type PromoLike = {
    isActive: boolean
    discountType: string
    discountValue: number
    startDate: string | Date
    endDate: string | Date
    minItems?: number | null
    /** Which shelf the deal is about. Null = the whole bill. */
    categoryId?: string | null
}

/** A line as the scope check sees it: what it is, how many, what it came to. */
export type ScopedLine = {
    categoryId?: string | null
    quantity: number
    total: number
}

/**
 * The part of a bill a promotion is actually about.
 *
 * "15 Free 5" is a beer crate. Counting every line towards it meant a table
 * that ordered fifteen snacks unlocked a beer deal, and then took the discount
 * off the snacks too - the bug the schema comment described for months as "the
 * open fix".
 *
 * An unscoped promo (categoryId null) still sees the whole bill, which is what
 * a blanket "10% off tonight" wants.
 */
export function scopeOf(lines: ScopedLine[], categoryId?: string | null) {
    const inScope = categoryId ? lines.filter((l) => l.categoryId === categoryId) : lines
    return {
        count: inScope.reduce((n, l) => n + (l.quantity || 0), 0),
        subtotal: inScope.reduce((n, l) => n + (l.total || 0), 0),
    }
}

/**
 * What a promotion takes off a bill, scoped to its own category.
 *
 * The single entry point for pricing a promo against a set of lines: it works
 * out the scope and then applies the same clamped arithmetic the counter path
 * has always used, so a deal cannot mean one thing at the till and another on
 * a table.
 */
export function promoDiscountForLines(
    promo: (PromoLike & { categoryId?: string | null }) | null | undefined,
    lines: ScopedLine[],
    now: Date = new Date()
): number {
    if (!promo) return 0
    const { count, subtotal } = scopeOf(lines, promo.categoryId)
    return promoDiscountFor(promo, subtotal, count, now)
}

// Why this promo can't be used right now. null = it can.
export type PromoBlocker = 'inactive' | 'not_started' | 'expired' | 'min_items'

export function promoBlocker(
    promo: PromoLike | null | undefined,
    itemCount: number,
    now: Date = new Date()
): PromoBlocker | null {
    if (!promo || !promo.isActive) return 'inactive'
    if (now < new Date(promo.startDate)) return 'not_started'
    if (now > new Date(promo.endDate)) return 'expired'
    if (promo.minItems && itemCount < promo.minItems) return 'min_items'
    return null
}

// The discount in kip. Always clamped to [0, subtotal] - a fixed promo worth
// more than the cart takes the order to zero, never below it.
export function promoDiscountFor(
    promo: PromoLike | null | undefined,
    subtotal: number,
    itemCount: number,
    now: Date = new Date()
): number {
    if (!promo || promoBlocker(promo, itemCount, now)) return 0
    const raw = promo.discountType === 'percentage'
        ? subtotal * (promo.discountValue / 100)
        : promo.discountValue
    return Math.min(Math.max(0, Math.round(raw)), Math.max(0, subtotal))
}
