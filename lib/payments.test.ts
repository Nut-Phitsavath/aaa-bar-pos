// Run: node --experimental-strip-types --test lib/payments.test.ts
//
// Split-tender balance math. A bar bill is settled by several payments over
// several minutes, so "is this bill paid?" is a computed answer, not a flag.
// These cover the cases where the till would free a table nobody paid for.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    isConfirmed, paidTotal, balanceOf, changeDue, canAcceptPayment, isFullySettled,
} from './payments.ts'

const cash = (amount: number) => ({ method: 'CASH', amount, paymentStatus: 'PAID' })
const onepay = (amount: number, paymentStatus: string) => ({ method: 'ONEPAY', amount, paymentStatus })

test('cash is confirmed the moment it is recorded', () => {
    assert.equal(isConfirmed(cash(500)), true)
})

test('a pending OnePay payment is NOT confirmed', () => {
    // The customer has scanned the QR but the bank has not said yes. Counting
    // this would free the table for a payment that may never land.
    assert.equal(isConfirmed(onepay(500, 'PENDING')), false)
})

test('a paid OnePay payment is confirmed', () => {
    assert.equal(isConfirmed(onepay(500, 'PAID')), true)
})

test('an owner comp settles the bill without money', () => {
    assert.equal(isConfirmed({ method: 'OWNER_VIP', amount: 4120, paymentStatus: null }), true)
})

test('paidTotal sums only confirmed payments', () => {
    const payments = [cash(500), onepay(1000, 'PAID'), onepay(2000, 'PENDING')]
    assert.equal(paidTotal(payments), 1500)
})

test('paidTotal of nothing is zero', () => {
    assert.equal(paidTotal([]), 0)
})

test('balance is what is still owed', () => {
    // The requirement's own example: 500,000 kip cash first, rest on OnePay.
    // In baht: pay 500 of a 1,500 bill, 1,000 left.
    assert.equal(balanceOf(1500, [cash(500)]), 1000)
})

test('balance ignores a pending OnePay leg', () => {
    assert.equal(balanceOf(1500, [cash(500), onepay(1000, 'PENDING')]), 1000)
})

test('balance drops to zero once the pending leg confirms', () => {
    assert.equal(balanceOf(1500, [cash(500), onepay(1000, 'PAID')]), 0)
})

test('balance never goes negative on an overpayment', () => {
    assert.equal(balanceOf(880, [cash(1000)]), 0)
})

test('overpayment surfaces as change due, not as a negative balance', () => {
    assert.equal(changeDue(880, [cash(1000)]), 120)
    assert.equal(changeDue(880, [cash(880)]), 0)
})

test('a bill is settled only when the balance reaches zero', () => {
    assert.equal(isFullySettled(1500, [cash(500)]), false)
    assert.equal(isFullySettled(1500, [cash(500), onepay(1000, 'PAID')]), true)
})

test('a zero-total bill counts as settled with no payments', () => {
    // A table opened by mistake must be closeable.
    assert.equal(isFullySettled(0, []), true)
})

test('canAcceptPayment refuses a closed session', () => {
    const check = canAcceptPayment({ status: 'CLOSED' }, 1500, [], 100)
    assert.equal(check.ok, false)
})

test('canAcceptPayment refuses a zero or negative amount', () => {
    assert.equal(canAcceptPayment({ status: 'OPEN' }, 1500, [], 0).ok, false)
    assert.equal(canAcceptPayment({ status: 'OPEN' }, 1500, [], -50).ok, false)
})

test('canAcceptPayment refuses money on an already settled bill', () => {
    const check = canAcceptPayment({ status: 'OPEN' }, 1500, [cash(1500)], 100)
    assert.equal(check.ok, false)
})

test('canAcceptPayment allows cash above the balance, because change exists', () => {
    const check = canAcceptPayment({ status: 'OPEN' }, 1500, [], 2000)
    assert.deepEqual(check, { ok: true })
})

test('canAcceptPayment refuses OnePay above the balance', () => {
    // Cash can be overpaid and change given back. A QR charges the customer's
    // account exactly, so overcharging is a refund problem, not a change one.
    const check = canAcceptPayment({ status: 'OPEN' }, 1500, [], 2000, 'ONEPAY')
    assert.equal(check.ok, false)
})

test('canAcceptPayment allows OnePay for exactly the remaining balance', () => {
    const check = canAcceptPayment({ status: 'OPEN' }, 1500, [cash(500)], 1000, 'ONEPAY')
    assert.deepEqual(check, { ok: true })
})
