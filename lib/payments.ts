/**
 * Split-tender balance math.
 *
 * A bar bill is settled by several payments over several minutes - cash for
 * part, a QR for the rest - so "is this paid?" is computed from the payment
 * rows, never stored as a flag that could drift from them.
 *
 * Pure functions only, no Prisma. The bill screen and the settle endpoint both
 * decide through here, so what the waiter sees and what frees the table cannot
 * disagree.
 */

export type PaymentLike = {
    method: string
    amount: number
    paymentStatus?: string | null
    /** Set when the tender was handed back; it stops counting as money held. */
    voidedAt?: Date | string | null
}

export type PaymentCheck = { ok: true } | { ok: false; reason: string }

/**
 * Has this payment actually settled?
 *
 * Cash is real the moment it is in the drawer, and an owner comp is a decision
 * rather than a transfer - both count immediately. A OnePay leg only counts
 * once BCEL has confirmed it: the customer scanning a QR is not the same as
 * the money arriving, and treating it as such frees the table for a payment
 * that may never land.
 */
export function isConfirmed(payment: PaymentLike): boolean {
    // A refunded tender arrived and then left again. Every balance in the app
    // flows through this one gate, so checking it here is what stops a refunded
    // bill still reading as settled on the ticket, the receipt and the history.
    if (payment.voidedAt) return false
    if (payment.method === 'ONEPAY') return payment.paymentStatus === 'PAID'
    return true
}

export function paidTotal(payments: PaymentLike[]): number {
    return payments
        .filter(isConfirmed)
        .reduce((sum, p) => sum + (p.amount || 0), 0)
}

/** What is still owed. Never negative - an overpayment is change, not debt. */
export function balanceOf(billTotal: number, payments: PaymentLike[]): number {
    return Math.max(0, (billTotal || 0) - paidTotal(payments))
}

/** What to hand back when more cash came in than the bill. */
export function changeDue(billTotal: number, payments: PaymentLike[]): number {
    return Math.max(0, paidTotal(payments) - (billTotal || 0))
}

export function isFullySettled(billTotal: number, payments: PaymentLike[]): boolean {
    return balanceOf(billTotal, payments) <= 0
}

/**
 * What a per-table discount takes off the gross (requirement #15).
 *
 * Clamped to the bill in both directions: a discount bigger than the bill makes
 * it free rather than negative, and a negative one is ignored rather than
 * quietly inflating what the customer owes.
 */
export function discountAmount(
    gross: number,
    type: string | null | undefined,
    value: number | null | undefined
): number {
    const g = gross || 0
    const v = value || 0
    if (!type || v <= 0) return 0

    const raw = type === 'PERCENT' ? g * (v / 100) : v
    return Math.min(Math.max(0, raw), g)
}

/**
 * What the customer actually owes, after any discount.
 *
 * Rounds UP to whole baht: the requirement's own example is 2,499.5 becoming
 * 2,500. Up rather than down keeps satang out of the drawer and leaves the
 * rounding in the house's favour.
 */
export function billTotalOf(
    gross: number,
    discountType: string | null | undefined,
    discountValue: number | null | undefined
): number {
    const g = gross || 0
    return Math.max(0, Math.ceil(g - discountAmount(g, discountType, discountValue)))
}

/**
 * What a set of closed pay-later bills still owes in total.
 *
 * Each entry is one bill: its total after discount, and whatever has been paid
 * against it since. Settling a tab adds ordinary payments to the original bill,
 * so a part-payment simply reduces this.
 */
export function outstandingOf(
    sessions: { total: number; payments: PaymentLike[] }[]
): number {
    return sessions.reduce((sum, s) => sum + balanceOf(s.total, s.payments), 0)
}

export function canAcceptPayment(
    session: { status: string; customerId?: string | null },
    billTotal: number,
    payments: PaymentLike[],
    amount: number,
    method: string = 'CASH'
): PaymentCheck {
    // A closed bill takes no more money, with one exception: a pay-later tab is
    // closed by design and still owes. Collecting on it later is the whole
    // point, so money against a tab has to be allowed through.
    if (session.status === 'CLOSED' && !session.customerId) {
        return { ok: false, reason: 'SESSION_ALREADY_CLOSED' }
    }
    if (!Number.isFinite(amount) || amount <= 0) {
        return { ok: false, reason: 'AMOUNT_MUST_BE_POSITIVE' }
    }

    const balance = balanceOf(billTotal, payments)
    if (balance <= 0) {
        return { ok: false, reason: 'BILL_ALREADY_SETTLED' }
    }

    // Cash can be overpaid because change goes back across the counter. A QR
    // debits the customer's account for exactly what it asks, so overcharging
    // becomes a refund to chase rather than coins in a hand.
    if (method !== 'CASH' && amount > balance) {
        return { ok: false, reason: 'AMOUNT_EXCEEDS_BALANCE' }
    }

    return { ok: true }
}
