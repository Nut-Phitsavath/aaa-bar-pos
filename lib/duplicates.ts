/**
 * Two waiters keying the same drinks onto one table (req #5's headline case).
 *
 * On a busy floor a guest asks the nearest server, gets no answer fast enough,
 * and asks the next one. Both walk to a till and key it. Nothing in the app
 * could see that: each round is valid on its own, and the duplicate only
 * surfaces when the customer argues about the bill or when two identical
 * buckets arrive at the table.
 *
 * So this is a warning, not a refusal. Two beers ordered ten minutes apart is
 * a thirsty table; two beers ordered inside the same few minutes by a different
 * server is the case worth a second look before the drink is poured. The staff
 * member decides, because only they can see the table.
 *
 * Pure, so the confirm dialog and any later server-side check read the same
 * rule rather than two drifting copies of it.
 */

/** The default window. Long enough to catch a walk to the second till. */
export const DUPLICATE_WINDOW_MS = 5 * 60_000

export type SentRound = {
    createdAt: string | Date
    status?: string
    waiter?: { id?: string; name: string } | null
    items: { menuId?: string | null; name: string; quantity: number; voidedAt?: string | Date | null }[]
}

export type DuplicateWarning = {
    name: string
    quantity: number
    waiter: string | null
    minutesAgo: number
}

/**
 * Which lines about to be sent were already sent to this bill just now.
 *
 * Struck lines and cancelled rounds are ignored: a voided duplicate is the
 * problem already dealt with, and warning about it would train staff to click
 * through the dialog without reading it.
 */
export function recentDuplicates(
    sending: { menuId?: string | null; quantity: number; name: string }[],
    rounds: SentRound[],
    now: Date = new Date(),
    windowMs: number = DUPLICATE_WINDOW_MS,
): DuplicateWarning[] {
    const wanted = new Set(sending.map((l) => l.menuId).filter(Boolean) as string[])
    if (wanted.size === 0) return []

    const warnings: DuplicateWarning[] = []
    for (const round of rounds) {
        if (round.status === 'CANCELLED') continue
        const age = now.getTime() - new Date(round.createdAt).getTime()
        // A round timestamped in the future is a clock skew between two tills,
        // not a duplicate from tomorrow; treat it as just sent.
        if (age > windowMs) continue

        for (const item of round.items) {
            if (item.voidedAt || !item.menuId) continue
            if (!wanted.has(item.menuId)) continue
            warnings.push({
                name: item.name,
                quantity: item.quantity,
                waiter: round.waiter?.name ?? null,
                minutesAgo: Math.max(0, Math.floor(age / 60_000)),
            })
        }
    }
    return warnings
}
