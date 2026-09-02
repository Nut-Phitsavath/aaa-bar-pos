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
}

export type PromotionValidation =
    | { ok: true; value: number; start: Date; end: Date; minItems: number | null; staffPickable: boolean }
    | { ok: false; error: string }

export function validatePromotionInput(body: PromotionInput): PromotionValidation {
    const { name, code, discountType, discountValue, startDate, endDate, minItems, staffPickable } = body

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

    return { ok: true, value, start, end, minItems: minCount, staffPickable: staffPickable !== false }
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
