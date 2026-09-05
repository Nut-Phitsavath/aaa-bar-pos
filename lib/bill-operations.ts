/**
 * Reopening a settled bill, handing a tender back, and the exceptions a
 * manager reads in the morning.
 *
 * Both operations move figures a shift has already counted, so the rule about
 * WHEN they are allowed carries as much weight as what they do. Both are
 * therefore fenced to the shift that is currently open: once the drawer has
 * been counted and the Z-report signed, that night is finished, which is the
 * same rule voiding a round already follows.
 *
 * Pure functions only, no Prisma.
 */

import { isConfirmed, type PaymentLike } from './payments.ts'

export const REOPEN_NOT_CLOSED = 'REOPEN_NOT_CLOSED'
export const REOPEN_OTHER_SHIFT = 'REOPEN_OTHER_SHIFT'
export const REFUND_ALREADY_VOIDED = 'REFUND_ALREADY_VOIDED'
export const REFUND_NOT_CONFIRMED = 'REFUND_NOT_CONFIRMED'
export const REFUND_OTHER_SHIFT = 'REFUND_OTHER_SHIFT'

export type Check = { ok: true } | { ok: false; reason: string }

export type RefundablePayment = PaymentLike & { id?: string; voidedAt?: Date | string | null }

/**
 * May this bill be reopened?
 *
 * The case it exists for is small and immediate: the table settled, then asked
 * for one more round. Without it staff open a SECOND table for the same
 * customers, which inflates the table count, splits the server's figures and
 * ruins average spend - so the absence of this feature does not prevent the
 * mistake, it just records it badly.
 *
 * Fenced to the current shift. Reopening last night's bill would move takings
 * that a counted drawer and a signed Z-report already account for.
 */
export function canReopen(
    bill: { status: string; shiftId?: string | null },
    currentShiftId: string | null
): Check {
    if (bill.status !== 'CLOSED') return { ok: false, reason: REOPEN_NOT_CLOSED }
    if (!currentShiftId) return { ok: false, reason: REOPEN_OTHER_SHIFT }
    // A bill with no shift pre-dates shift tracking: there is no drawer that
    // its money came out of, so there is none to put a change back into.
    if (!bill.shiftId || bill.shiftId !== currentShiftId) {
        return { ok: false, reason: REOPEN_OTHER_SHIFT }
    }
    return { ok: true }
}

/**
 * May this single tender be handed back?
 *
 * One tender at a time, because 17% of bills here are split: a customer may
 * want the cash back while the QR leg stands, and a whole-bill refund cannot
 * express that.
 */
export function canRefund(
    payment: RefundablePayment,
    paymentShiftId: string | null,
    currentShiftId: string | null
): Check {
    if (payment.voidedAt) return { ok: false, reason: REFUND_ALREADY_VOIDED }
    // An unconfirmed QR leg was never taken, so there is nothing to give back.
    if (!isConfirmed(payment)) return { ok: false, reason: REFUND_NOT_CONFIRMED }
    if (!currentShiftId || paymentShiftId !== currentShiftId) {
        return { ok: false, reason: REFUND_OTHER_SHIFT }
    }
    return { ok: true }
}

/** What could still be handed back: confirmed, not already reversed. */
export function refundableTotal(payments: RefundablePayment[]): number {
    return payments
        .filter((p) => !p.voidedAt && isConfirmed(p))
        .reduce((sum, p) => sum + (p.amount || 0), 0)
}

export type ExceptionBill = {
    discount: number
    status: string
    voidedLines: number
    total: number
    paid: number
}

/**
 * The morning read, in one place.
 *
 * Every figure here already existed - a discount was buried inside an expanded
 * row, a comp was one badge among many - but none of it was ever totalled, so
 * "what did we give away last night" could only be answered by opening bills
 * one at a time. Toast calls its version the sales exception report; this is
 * the same question asked of the range on screen.
 */
export function exceptionsOf(bills: ExceptionBill[]) {
    const discounted = bills.filter((b) => (b.discount || 0) > 0)
    const comped = bills.filter((b) => b.status === 'COMPED')
    const owing = bills.filter((b) => b.status === 'TAB' || b.status === 'PART_PAID')

    return {
        discountTotal: discounted.reduce((sum, b) => sum + (b.discount || 0), 0),
        discountCount: discounted.length,
        compedTotal: comped.reduce((sum, b) => sum + (b.total || 0), 0),
        compedCount: comped.length,
        voidedLines: bills.reduce((sum, b) => sum + (b.voidedLines || 0), 0),
        // What is owed, not what was taken: a tab is a debt, not a sale.
        owedTotal: owing.reduce((sum, b) => sum + Math.max(0, (b.total || 0) - (b.paid || 0)), 0),
        tabCount: bills.filter((b) => b.status === 'TAB').length,
    }
}
