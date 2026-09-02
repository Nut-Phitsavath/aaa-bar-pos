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

export function canAcceptPayment(
    session: { status: string },
    billTotal: number,
    payments: PaymentLike[],
    amount: number,
    method: string = 'CASH'
): PaymentCheck {
    if (session.status === 'CLOSED') {
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
