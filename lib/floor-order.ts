/**
 * Reordering tables inside one area of the floor plan.
 *
 * Pulled out of the manage screen because of one invariant that breaks
 * silently: the AREAS are derived from this same array, in first-appearance
 * order. Rebuilding it by concatenating the reordered area onto the rest would
 * reorder the columns too, so the whole board would jump sideways every time a
 * table moved inside one of them.
 */

export type OrderedTable = { id: string; area: string; displayOrder: number }

/**
 * Put one area's tables in a new order, inside the full list.
 *
 * Each slot this area already occupies takes the next table in the new order,
 * so every other table - and every area's position - stays exactly where it
 * was. displayOrder is renumbered from zero within the area.
 */
export function withAreaOrder<T extends OrderedTable>(
    all: T[],
    area: string,
    next: T[],
): T[] {
    const queue = next.map((x, i) => ({ ...x, displayOrder: i }))
    return all.map((x) => (x.area === area ? queue.shift() ?? x : x))
}

/**
 * Move one table within its area, by index.
 *
 * Out-of-range targets return the list untouched rather than clamping: a key
 * press at the top of a list should do nothing, not silently re-save the same
 * order and flash a spinner.
 */
export function moveInArea<T extends OrderedTable>(
    all: T[],
    area: string,
    from: number,
    to: number,
): T[] {
    const inArea = all.filter((x) => x.area === area)
    if (from < 0 || from >= inArea.length) return all
    if (to < 0 || to >= inArea.length || to === from) return all

    const next = [...inArea]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    return withAreaOrder(all, area, next)
}

/**
 * Move one item within a flat list, by index.
 *
 * The same rule as moveInArea without the grouping - the menu's categories and
 * items are each one list. Returns the ORIGINAL array when the move goes
 * nowhere, so a caller can skip a save with `next === list` rather than
 * diffing.
 */
export function moveInList<T>(list: T[], from: number, to: number): T[] {
    if (from < 0 || from >= list.length) return list
    if (to < 0 || to >= list.length || to === from) return list
    const next = [...list]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    return next
}
