/**
 * House accounts: what a customer owes, and how a payment lands on it.
 *
 * Cash against a tab arrives as a lump - "here's ten thousand toward it" - not
 * as a decision about which night to clear. So a payment is taken against the
 * CUSTOMER and allocated across their open bills, oldest first, which is both
 * what a person means by paying off a debt and what keeps the ledger from
 * filling with ancient part-paid bills nobody will ever close.
 *
 * Pure functions: no Prisma here, so the allocation can be tested directly.
 */

export type OpenBill = {
    id: string
    /** What is still owed on this bill. */
    balance: number
    /** When the bill closed. Ties break on id so allocation is deterministic. */
    closedAt: string | Date | null
}

export type Allocation = {
    /** Per bill, how much of the payment lands on it. */
    parts: { sessionId: string; amount: number }[]
    /** Applied in total. */
    applied: number
    /** Handed over beyond what was owed - change, not credit. */
    unapplied: number
}

/** Oldest first, with a stable tie-break so two runs allocate identically. */
function byAge(a: OpenBill, b: OpenBill) {
    const at = a.closedAt ? new Date(a.closedAt).getTime() : 0
    const bt = b.closedAt ? new Date(b.closedAt).getTime() : 0
    return at === bt ? a.id.localeCompare(b.id) : at - bt
}

export function outstandingOfBills(bills: OpenBill[]): number {
    return bills.reduce((sum, b) => sum + Math.max(0, b.balance || 0), 0)
}

/**
 * Spread `amount` across `bills`, oldest first.
 *
 * Anything beyond the total owed comes back as `unapplied` rather than being
 * left on the account as credit: a bar hands the difference back across the
 * counter, and carrying a negative balance would be a second concept to
 * reconcile for no gain.
 */
export function allocateOldestFirst(amount: number, bills: OpenBill[]): Allocation {
    const parts: { sessionId: string; amount: number }[] = []
    let left = Math.max(0, Math.round(amount || 0))

    for (const bill of [...bills].sort(byAge)) {
        if (left <= 0) break
        const owed = Math.max(0, bill.balance || 0)
        if (owed <= 0) continue

        const take = Math.min(owed, left)
        parts.push({ sessionId: bill.id, amount: take })
        left -= take
    }

    return {
        parts,
        applied: parts.reduce((sum, p) => sum + p.amount, 0),
        unapplied: left,
    }
}
