/**
 * Summarising a bill for the history.
 *
 * A cafe's history is a list of orders because one order is one customer is one
 * payment. A bar's is not: 94% of orders here belong to a table, a bill runs to
 * 2-6 rounds, and it is settled once at the end. So the round is a fragment and
 * the BILL is the transaction - 531 order rows are really 176 bills and 30
 * walk-in sales.
 *
 * The payment side matters most. `Order.paymentMethod` reads CASH on all 501
 * table orders because nothing ever sets it: a table order does not carry
 * payment, the session does. The real tenders are payment rows, and 29 of 167
 * settled bills used more than one - which a single method column cannot say
 * at all.
 *
 * Pure functions only, no Prisma, so the list and any report that shows the
 * same bill agree about what it was.
 */

import { isConfirmed, paidTotal, type PaymentLike } from './payments.ts'

export const PAID = 'PAID'
export const PART_PAID = 'PART_PAID'
export const TAB = 'TAB'
export const COMPED = 'COMPED'
export const VOIDED = 'VOIDED'
export const OPEN = 'OPEN'

export type BillStatus =
    | typeof PAID | typeof PART_PAID | typeof TAB
    | typeof COMPED | typeof VOIDED | typeof OPEN

export type Tender = { method: string; amount: number }

/**
 * How the bill was actually settled, one entry per method.
 *
 * Repeat tenders of the same method are added up - two cash payments ten
 * minutes apart are one cash figure on a slip - and unconfirmed QR legs are
 * left out, because a customer scanning is not the bank paying.
 *
 * Largest first, so the tender that carried the bill reads first.
 */
export function tendersOf(payments: PaymentLike[]): Tender[] {
    const byMethod = new Map<string, number>()
    for (const p of payments) {
        if (!isConfirmed(p)) continue
        byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + (p.amount || 0))
    }
    return [...byMethod.entries()]
        .map(([method, amount]) => ({ method, amount }))
        .sort((a, b) => b.amount - a.amount)
}

/**
 * The translation key a tender prints under, or null for one the app has no
 * name for - which then prints as its raw method rather than as nothing.
 * BANK_NOTE is what old counter sales stored for cash.
 */
export function tenderLabelKey(method: string): 'pay_cash' | 'pay_onepay' | 'pay_transfer' | 'owner_vip' | 'comped' | null {
    switch (method) {
        case 'CASH': case 'BANK_NOTE': return 'pay_cash'
        case 'ONEPAY': return 'pay_onepay'
        case 'TRANSFER': return 'pay_transfer'
        case 'OWNER_VIP': return 'owner_vip'
        case 'COMPED': return 'comped'
        default: return null
    }
}

/**
 * How a counter sale was paid. It has no payment rows: the sale is paid in
 * full, at once, by the one method on the order - unless it went on a tab, in
 * which case nothing was paid and the slip says nothing about a tender.
 *
 * A complimentary walk-in is stored as CASH but not reportable; it prints as
 * comped, because "Paid · Cash" on it claims money that never changed hands.
 */
export function counterTenders(order: { paymentMethod: string | null; total: number; isReportable?: boolean }): Tender[] {
    if (!order.paymentMethod || order.paymentMethod === 'PAY_LATER') return []
    if (order.isReportable === false) return [{ method: 'COMPED', amount: order.total }]
    return [{ method: order.paymentMethod === 'BANK_NOTE' ? 'CASH' : order.paymentMethod, amount: order.total }]
}

/**
 * What state the bill ended in.
 *
 * Order matters. A comp is checked before "is it settled", because an owner
 * comp does settle the bill - and calling that PAID would hide the giveaway in
 * the very report that exists to surface it. A closed bill still owing is a tab
 * only if somebody's name is on it; a nameless debt is a discrepancy and is
 * reported as one rather than dressed up as money someone will come back with.
 */
export function billStatus(bill: {
    status: string
    total: number
    payments: PaymentLike[]
    customerId?: string | null
}): BillStatus {
    if (bill.status !== 'CLOSED') return OPEN

    if (bill.payments.some((p) => p.method === 'OWNER_VIP' && isConfirmed(p))) return COMPED

    const paid = paidTotal(bill.payments)
    if (paid >= (bill.total || 0) && (bill.total || 0) > 0) return PAID

    // Nothing owed and nothing taken: every round on the table was struck.
    if ((bill.total || 0) <= 0) return VOIDED

    return bill.customerId ? TAB : PART_PAID
}
