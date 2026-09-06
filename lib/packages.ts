/**
 * Swapping what a package delivers (req #8).
 *
 * A package is one line on the bill whose recipe IS its contents: a Chivas Set
 * is a bottle, four sodas and ice. Swapping two of the Heinekens out of a set
 * for beer and water is therefore not a change to the bill's lines - the line
 * stays, at its price - it is a change to what that line hands over.
 *
 * The pricing rule is the one Toast documents for bundles: the package price is
 * the floor, and only a dearer replacement moves it. Nothing is ever
 * subtracted, so a customer who trades down leaves the margin with the bar,
 * which is what the requirement asks for and what the owner confirmed.
 *
 * Pure functions, no Prisma: the till shows the customer a number before
 * anyone commits, and the route charges one afterwards. They have to be the
 * same number, so they run the same arithmetic.
 */

/** A component of a package, priced at what the bar sells it for singly. */
export type Component = {
    /** The single-serve menu item this component is sold as. */
    menuId: string
    variationSizeId: string | null
    name: string
    localName?: string | null
    unitPrice: number
    /** How many the package contains, or how many are being moved. */
    quantity: number
}

/**
 * The single-serve menu item a package component is sold as.
 *
 * A package's recipe is in ingredients - "Heineken (bottle) x5" - but a swap
 * has to be priced in what the bar charges for one, and its replacement has to
 * take stock through a recipe of its own. Both ends are the same object: the
 * menu item whose whole recipe is exactly one unit of that ingredient.
 *
 * Ice has no such item (the bucket is 2kg) and neither does a bottle of Chivas,
 * so neither is offered for swapping - which is correct in both cases. Nobody
 * trades away the bottle that IS the package.
 */
export type SellableMenu = {
    menuId: string
    variationSizeId: string | null
    name: string
    localName?: string | null
    unitPrice: number
    recipe: { ingredientId: string; quantity: number }[]
}

export function componentIndex(menus: SellableMenu[]): Map<string, SellableMenu> {
    const index = new Map<string, SellableMenu>()
    for (const menu of menus) {
        if (menu.recipe.length !== 1) continue
        const [only] = menu.recipe
        if (only.quantity !== 1) continue
        // First one wins, and menus arrive in a stable order, so which item
        // represents an ingredient does not change between two reads.
        if (!index.has(only.ingredientId)) index.set(only.ingredientId, menu)
    }
    return index
}

/** What a package contains, in things the bar can price and re-stock. */
export function contentsOf(
    recipe: { ingredientId: string; quantity: number }[],
    index: Map<string, SellableMenu>,
): Component[] {
    const out: Component[] = []
    for (const line of recipe) {
        const sellable = index.get(line.ingredientId)
        if (!sellable) continue
        if (!Number.isInteger(line.quantity) || line.quantity < 1) continue
        out.push({
            menuId: sellable.menuId,
            variationSizeId: sellable.variationSizeId,
            name: sellable.name,
            localName: sellable.localName ?? null,
            unitPrice: sellable.unitPrice,
            quantity: line.quantity,
        })
    }
    return out
}

/** What a swap costs the customer: never less than nothing. */
export function chargeFor(outValue: number, inValue: number): number {
    const difference = Math.round((inValue - outValue) * 100) / 100
    return difference > 0 ? difference : 0
}

export function valueOf(lines: { unitPrice: number; quantity: number }[]): number {
    return Math.round(lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0) * 100) / 100
}

export type SwapCheck = { ok: true } | { ok: false; reason: string }

/**
 * Whether a swap may go through.
 *
 * The cap is the point: a package containing two Heinekens can have at most two
 * taken out of it. Without that, "remove 4 Heineken" from a package holding 2
 * invents 120 baht of credit out of nothing, and with no manager PIN on this
 * screen there is nobody to catch it.
 */
export function canSwap(
    contents: Component[],
    removing: { menuId: string; quantity: number }[],
    adding: { quantity: number }[],
): SwapCheck {
    if (removing.length === 0 && adding.length === 0) {
        return { ok: false, reason: 'NOTHING_TO_SWAP' }
    }
    // An exchange trades. Taking drinks out of a set and putting nothing back
    // is a customer handing back what they did not open, which is its own job
    // with its own log - and letting it happen here too would record the same
    // event two different ways depending on which screen someone reached for.
    if (adding.length === 0) {
        return { ok: false, reason: 'REPLACEMENT_REQUIRED' }
    }
    for (const line of [...removing, ...adding]) {
        if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
            return { ok: false, reason: 'QUANTITY_MUST_BE_POSITIVE' }
        }
        if (!Number.isInteger(line.quantity)) {
            return { ok: false, reason: 'QUANTITY_MUST_BE_WHOLE' }
        }
    }
    for (const line of removing) {
        const held = contents.find((c) => c.menuId === line.menuId)
        if (!held) return { ok: false, reason: 'NOT_IN_PACKAGE' }
        if (line.quantity > held.quantity) return { ok: false, reason: 'MORE_THAN_PACKAGE_HOLDS' }
    }
    // Two rows for the same drink would each pass the cap and together break it.
    const seen = new Set<string>()
    for (const line of removing) {
        if (seen.has(line.menuId)) return { ok: false, reason: 'DUPLICATE_LINE' }
        seen.add(line.menuId)
    }
    return { ok: true }
}

/**
 * What a package delivers now: its recipe, less what has been swapped out of
 * it, plus what has been swapped in.
 *
 * Both halves matter. Swaps stack, so two Heinekens out this round and one more
 * later must not let a package of two give up three. And a drink that arrived
 * by exchange is on the table exactly like the ones the recipe named - a set
 * whose Heinekens became Beer Lao holds Beer Lao, and a customer who changes
 * their mind twice has to be able to trade them. Counting only the recipe left
 * the second exchange refusing to touch drinks the bar had already served.
 */
export function remainingContents(
    contents: Component[],
    alreadyRemoved: { menuId: string; quantity: number }[],
    alreadyAdded: Component[] = [],
): Component[] {
    const net = contents.map((c) => {
        const gone = alreadyRemoved
            .filter((r) => r.menuId === c.menuId)
            .reduce((sum, r) => sum + r.quantity, 0)
        return { ...c, quantity: c.quantity - gone }
    })

    for (const added of alreadyAdded) {
        const at = net.find((c) => c.menuId === added.menuId)
        if (at) at.quantity += added.quantity
        else net.push({ ...added })
    }

    return net.filter((c) => c.quantity > 0)
}

export type SwapLine = { direction: string; name: string; quantity: number }

/**
 * Every swap against one package line, as two lists.
 *
 * A bill that has been exchanged twice should read as one statement of what the
 * customer ended up with, not as a diary of the negotiation - so the same drink
 * appearing in two swaps is added up rather than listed twice. The audit report
 * keeps the individual events; this is for the ticket and the printed slip.
 */
export function summariseSwaps(
    swaps: { lines: SwapLine[]; reversedAt?: string | Date | null }[],
): { out: SwapLine[]; in: SwapLine[] } {
    const merge = (lines: SwapLine[]) => {
        const totals = new Map<string, SwapLine>()
        for (const line of lines) {
            const at = totals.get(line.name)
            if (at) at.quantity += line.quantity
            else totals.set(line.name, { ...line })
        }
        return Array.from(totals.values())
    }
    // A reversed swap did not survive, so it describes nothing the customer
    // ended up with. It stays in the audit report; it leaves the bill.
    const all = swaps.filter((s) => !s.reversedAt).flatMap((s) => s.lines ?? [])
    return {
        out: merge(all.filter((l) => l.direction === 'OUT')),
        in: merge(all.filter((l) => l.direction === 'IN')),
    }
}
