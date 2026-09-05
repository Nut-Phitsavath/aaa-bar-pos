// Run: node --experimental-strip-types --test lib/bill-operations.test.ts
//
// Reopening a settled bill and handing money back. Both move figures a shift
// has already counted, so the rules about WHEN they are allowed matter as much
// as what they do.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    canReopen, canRefund, refundableTotal, exceptionsOf,
    REOPEN_NOT_CLOSED, REOPEN_OTHER_SHIFT, REFUND_ALREADY_VOIDED,
    REFUND_NOT_CONFIRMED, REFUND_OTHER_SHIFT,
} from './bill-operations.ts'

const cash = (amount: number, extra = {}) => ({ id: 'p1', method: 'CASH', amount, paymentStatus: 'PAID', ...extra })
const qr = (amount: number, extra = {}) => ({ id: 'p2', method: 'ONEPAY', amount, paymentStatus: 'PAID', ...extra })

// --- Reopening ---------------------------------------------------------------

test('a bill closed in the current shift can be reopened', () => {
    assert.deepEqual(canReopen({ status: 'CLOSED', shiftId: 's1' }, 's1'), { ok: true })
})

test('a bill that is still open cannot be reopened', () => {
    const check = canReopen({ status: 'OPEN', shiftId: 's1' }, 's1')
    assert.equal(check.ok, false)
    assert.equal(check.ok === false && check.reason, REOPEN_NOT_CLOSED)
})

test('a bill from an earlier shift cannot be reopened', () => {
    // Its takings are inside a Z-report that has been counted and signed.
    const check = canReopen({ status: 'CLOSED', shiftId: 'last-night' }, 's1')
    assert.equal(check.ok, false)
    assert.equal(check.ok === false && check.reason, REOPEN_OTHER_SHIFT)
})

test('a bill with no shift cannot be reopened into one', () => {
    // Pre-dates shift tracking; there is no drawer to put the change back into.
    assert.equal(canReopen({ status: 'CLOSED', shiftId: null }, 's1').ok, false)
})

test('reopening needs an open shift to reopen into', () => {
    assert.equal(canReopen({ status: 'CLOSED', shiftId: 's1' }, null).ok, false)
})

// --- Refunding a single tender -----------------------------------------------

test('a confirmed payment from the current shift can be refunded', () => {
    assert.deepEqual(canRefund(cash(500), 's1', 's1'), { ok: true })
})

test('an already refunded payment cannot be refunded twice', () => {
    // Otherwise the drawer is credited twice for one reversal.
    const check = canRefund(cash(500, { voidedAt: new Date() }), 's1', 's1')
    assert.equal(check.ok, false)
    assert.equal(check.ok === false && check.reason, REFUND_ALREADY_VOIDED)
})

test('an unconfirmed QR leg cannot be refunded', () => {
    // The bank never took it, so there is nothing to give back.
    const check = canRefund(qr(1000, { paymentStatus: 'PENDING' }), 's1', 's1')
    assert.equal(check.ok, false)
    assert.equal(check.ok === false && check.reason, REFUND_NOT_CONFIRMED)
})

test('a payment taken in an earlier shift cannot be refunded here', () => {
    const check = canRefund(cash(500), 'last-night', 's1')
    assert.equal(check.ok, false)
    assert.equal(check.ok === false && check.reason, REFUND_OTHER_SHIFT)
})

test('refundable total counts only live confirmed tenders', () => {
    const payments = [
        cash(500),
        qr(1000, { paymentStatus: 'PENDING' }),
        cash(200, { voidedAt: new Date() }),
        qr(300),
    ]
    assert.equal(refundableTotal(payments), 800)
})

// --- The exceptions a manager reads in the morning ---------------------------

test('exceptions add up discounts, comps, voids and tabs', () => {
    const bills = [
        { discount: 400, status: 'PAID', voidedLines: 0, total: 3600, paid: 3600 },
        { discount: 0, status: 'COMPED', voidedLines: 1, total: 980, paid: 980 },
        { discount: 150, status: 'TAB', voidedLines: 0, total: 1200, paid: 0 },
        { discount: 0, status: 'PAID', voidedLines: 2, total: 500, paid: 500 },
    ]
    const x = exceptionsOf(bills)
    assert.equal(x.discountTotal, 550)
    assert.equal(x.discountCount, 2)
    assert.equal(x.compedTotal, 980)
    assert.equal(x.compedCount, 1)
    assert.equal(x.voidedLines, 3)
    // A tab is money owed, not money taken.
    assert.equal(x.owedTotal, 1200)
    assert.equal(x.tabCount, 1)
})

test('a clean night has zero exceptions rather than undefined', () => {
    const x = exceptionsOf([{ discount: 0, status: 'PAID', voidedLines: 0, total: 100, paid: 100 }])
    assert.deepEqual(
        [x.discountTotal, x.compedTotal, x.voidedLines, x.owedTotal],
        [0, 0, 0, 0]
    )
})

test('exceptions of nothing are all zero', () => {
    const x = exceptionsOf([])
    assert.equal(x.discountTotal, 0)
    assert.equal(x.tabCount, 0)
})

test('a part-paid bill counts what is still owed', () => {
    const x = exceptionsOf([{ discount: 0, status: 'PART_PAID', voidedLines: 0, total: 1000, paid: 400 }])
    assert.equal(x.owedTotal, 600)
})
