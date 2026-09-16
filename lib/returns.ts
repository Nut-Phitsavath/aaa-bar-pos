/**
 * Unopened drinks going back on the shelf (req #10).
 *
 * At cleanup the staff member counts what the table never opened - two of the
 * five beers in a bucket, the mixers nobody touched - and puts them back in the
 * fridge. The bar keeps the money: the package was sold and paid for. What
 * changes is only the count, so that the audit sheet matches the shelf.
 *
 * That is the whole difference between this and a void. A void says the sale
 * should not have happened; this says it did, and some of it came back.
 *
 * Restricted to what the table actually ordered, which the requirement asks for
 * outright - without it the screen becomes a way to add stock from nothing.
 */

export type Returnable = {
    /** The single-serve menu item, which is what a recipe restocks through. */
    menuId: string
    name: string
    localName?: string | null
    /** How many of these the table had, less anything already handed back. */
    quantity: number
}

export type ReturnCheck = { ok: true } | { ok: false; reason: string }

/**
 * What is still on the table to hand back.
 *
 * `had` is everything the table was served - plain lines and package contents
 * alike, already netted for exchanges by the caller. `alreadyReturned` is what
 * earlier counts on this same bill took back, so two visits to the screen
 * cannot return the same bottle twice.
 */
export function returnable(
    had: Returnable[],
    alreadyReturned: { menuId: string; quantity: number }[],
): Returnable[] {
    const merged = new Map<string, Returnable>()
    for (const line of had) {
        if (line.quantity <= 0) continue
        const at = merged.get(line.menuId)
        if (at) at.quantity += line.quantity
        else merged.set(line.menuId, { ...line })
    }

    for (const back of alreadyReturned) {
        const at = merged.get(back.menuId)
        if (at) at.quantity -= back.quantity
    }

    return Array.from(merged.values()).filter((r) => r.quantity > 0)
}

/** Whether a count may be recorded against what the table still holds. */
export function canReturn(
    available: Returnable[],
    returning: { menuId: string; quantity: number }[],
): ReturnCheck {
    if (returning.length === 0) return { ok: false, reason: 'NOTHING_TO_RETURN' }

    const seen = new Set<string>()
    for (const line of returning) {
        if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
            return { ok: false, reason: 'QUANTITY_MUST_BE_POSITIVE' }
        }
        if (!Number.isInteger(line.quantity)) {
            return { ok: false, reason: 'QUANTITY_MUST_BE_WHOLE' }
        }
        // Two rows for the same drink would each pass the cap and together
        // break it - the same hole the exchange screen had.
        if (seen.has(line.menuId)) return { ok: false, reason: 'DUPLICATE_LINE' }
        seen.add(line.menuId)

        const held = available.find((a) => a.menuId === line.menuId)
        if (!held) return { ok: false, reason: 'NOT_ON_THIS_BILL' }
        if (line.quantity > held.quantity) return { ok: false, reason: 'MORE_THAN_ORDERED' }
    }
    return { ok: true }
}
