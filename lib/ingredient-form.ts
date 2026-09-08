/**
 * What may still be changed about an ingredient, and by whom.
 *
 * "Stock has moved" means at least one StockTransaction row references this
 * ingredient - not that stock is non-zero. An ingredient received and fully
 * consumed is back at zero and must stay locked, because the rows recording
 * that consumption were computed with the old multiplier.
 *
 * Pure: the form greys the control and the route refuses the write, and both
 * have to agree about when. Re-implementing the role list in the component is
 * how a form and its endpoint start disagreeing.
 */

export type EditCheck = { ok: true } | { ok: false; reason: string }

const OVERRIDE_ROLES = ['MANAGER', 'ADMIN']

export function canEditUnits(input: { hasMovements: boolean; role: string }): EditCheck {
    if (!input.hasMovements) return { ok: true }
    // A manager can still fix a genuinely wrong first entry. It is logged by
    // the ordinary update path; what it must not be is quiet and universal.
    if (OVERRIDE_ROLES.includes(input.role)) return { ok: true }
    return { ok: false, reason: 'UNITS_LOCKED_AFTER_MOVEMENT' }
}
