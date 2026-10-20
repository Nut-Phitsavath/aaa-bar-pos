// Run: node --experimental-strip-types --test lib/bills.test.ts
//
// History is a list of bills, not of rounds. A bar bill is 2-6 rounds settled
// once, so the round is a fragment and the bill is the transaction. These pin
// down how a bill is summarised - above all how it was PAID, because the
// paymentMethod column on a table order is an untouched default reading CASH
// on all 501 of them while the real tenders live in the payment rows.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tendersOf, billStatus, tenderLabelKey, counterTenders, PAID, PART_PAID, TAB, COMPED, OPEN, VOIDED } from './bills.ts'

const cash = (amount: number) => ({ method: 'CASH', amount, paymentStatus: 'PAID' })
const qr = (amount: number, paymentStatus = 'PAID') => ({ method: 'ONEPAY', amount, paymentStatus })
const comp = (amount: number) => ({ method: 'OWNER_VIP', amount, paymentStatus: null })

// --- How it was actually paid ------------------------------------------------

test('a single cash tender', () => {
    assert.deepEqual(tendersOf([cash(645)]), [{ method: 'CASH', amount: 645 }])
})

test('a split bill lists both tenders, largest first', () => {
    // 29 of 167 settled bills used more than one tender. A single method column
    // cannot say this, which is why the old page could only ever show "CASH".
    assert.deepEqual(tendersOf([cash(500), qr(3680)]), [
        { method: 'ONEPAY', amount: 3680 },
        { method: 'CASH', amount: 500 },
    ])
})

test('two tenders of the same method are added together', () => {
    // Two cash payments taken ten minutes apart are one cash figure on a slip.
    assert.deepEqual(tendersOf([cash(200), cash(300)]), [{ method: 'CASH', amount: 500 }])
})

test('an unconfirmed QR is not a tender', () => {
    // The customer scanned; the bank has not said yes. Showing it as paid is how
    // a bill gets counted for money that never arrived.
    assert.deepEqual(tendersOf([cash(500), qr(1000, 'PENDING')]), [{ method: 'CASH', amount: 500 }])
})

test('a bill with no payments has no tenders', () => {
    assert.deepEqual(tendersOf([]), [])
})

// --- What state the bill ended in --------------------------------------------

test('settled in full is PAID', () => {
    assert.equal(billStatus({ status: 'CLOSED', total: 645, payments: [cash(645)] }), PAID)
})

test('a comped bill reads as COMPED, not as paid', () => {
    // Owner VIP settles the bill without money. Calling it PAID would hide the
    // giveaway in exactly the report that exists to show it.
    assert.equal(billStatus({ status: 'CLOSED', total: 4120, payments: [comp(4120)] }), COMPED)
})

test('a closed bill still owing, with a customer, is a TAB', () => {
    assert.equal(
        billStatus({ status: 'CLOSED', total: 1000, payments: [], customerId: 'c1' }),
        TAB
    )
})

test('a part-paid tab is still a TAB', () => {
    assert.equal(
        billStatus({ status: 'CLOSED', total: 1000, payments: [cash(400)], customerId: 'c1' }),
        TAB
    )
})

test('a closed bill still owing with nobody named is PART_PAID, not a tab', () => {
    // A debt with no name on it is a discrepancy, and must not be dressed up as
    // a tab that somebody is expected to come back and settle.
    assert.equal(billStatus({ status: 'CLOSED', total: 1000, payments: [cash(400)] }), PART_PAID)
})

test('a table still trading is OPEN', () => {
    assert.equal(billStatus({ status: 'OPEN', total: 500, payments: [] }), OPEN)
})

test('a bill requesting its bill is still OPEN', () => {
    assert.equal(billStatus({ status: 'BILL_REQUESTED', total: 500, payments: [] }), OPEN)
})

test('a closed bill worth nothing that was never comped is VOIDED', () => {
    // Every round struck: the table was opened and everything on it cancelled.
    assert.equal(billStatus({ status: 'CLOSED', total: 0, payments: [] }), VOIDED)
})

test('a comp of a zero bill still reads as COMPED', () => {
    assert.equal(billStatus({ status: 'CLOSED', total: 0, payments: [comp(0)] }), COMPED)
})

test('an overpaid bill is PAID, not part-paid', () => {
    assert.equal(billStatus({ status: 'CLOSED', total: 880, payments: [cash(1000)] }), PAID)
})

// --- How it was paid, on the slip -------------------------------------------

test('every tender the bar takes has a printed name', () => {
    assert.equal(tenderLabelKey('CASH'), 'pay_cash')
    assert.equal(tenderLabelKey('ONEPAY'), 'pay_onepay')
    assert.equal(tenderLabelKey('TRANSFER'), 'pay_transfer')
    // A comp prints as what it is, so it cannot pass for a paid bill.
    assert.equal(tenderLabelKey('OWNER_VIP'), 'owner_vip')
    // An old note-counter sale was cash.
    assert.equal(tenderLabelKey('BANK_NOTE'), 'pay_cash')
    // Something new prints as itself rather than as nothing.
    assert.equal(tenderLabelKey('CRYPTO'), null)
})

test('a counter sale was paid in full, by its one method', () => {
    assert.deepEqual(counterTenders({ paymentMethod: 'TRANSFER', total: 90 }), [{ method: 'TRANSFER', amount: 90 }])
    assert.deepEqual(counterTenders({ paymentMethod: 'BANK_NOTE', total: 90 }), [{ method: 'CASH', amount: 90 }])
})

test('a counter sale nobody has paid for prints no tender', () => {
    assert.deepEqual(counterTenders({ paymentMethod: 'PAY_LATER', total: 90 }), [])
    assert.deepEqual(counterTenders({ paymentMethod: null, total: 90 }), [])
})

test('a free counter sale prints as comped, not as cash', () => {
    // A complimentary walk-in is stored as CASH with isReportable false. Its
    // slip saying "Paid · Cash" claims money changed hands when none did.
    assert.deepEqual(
        counterTenders({ paymentMethod: 'CASH', total: 90, isReportable: false }),
        [{ method: 'COMPED', amount: 90 }],
    )
    assert.equal(tenderLabelKey('COMPED'), 'comped')
    // A normal sale is unaffected.
    assert.deepEqual(counterTenders({ paymentMethod: 'CASH', total: 90, isReportable: true }), [{ method: 'CASH', amount: 90 }])
})
