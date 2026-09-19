// Run: node --experimental-strip-types --test lib/min-spend.test.ts
//
// The room's floor. Money the bar collects when a party books a VIP room and
// then drinks less than they undertook to.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { minSpendShortfall, hasMinSpendCharge, parseMinSpend, MIN_SPEND_LINE } from './min-spend.ts'

test('the requirement: 3,200 against a 5,000 minimum owes 1,800', () => {
    assert.equal(minSpendShortfall(3200, 5000), 1800)
})

test('a party that drank past the minimum owes nothing', () => {
    assert.equal(minSpendShortfall(6000, 5000), 0)
    // Exactly on the floor is met, not short by a rounding error.
    assert.equal(minSpendShortfall(5000, 5000), 0)
})

test('a table with no floor never raises a surcharge', () => {
    assert.equal(minSpendShortfall(3200, null), 0)
    assert.equal(minSpendShortfall(3200, undefined), 0)
    // 0 means "no minimum", not "a minimum of nothing" - otherwise every
    // ordinary table would look like a room that had met its floor.
    assert.equal(minSpendShortfall(3200, 0), 0)
})

test('an empty bill in a booked room owes the whole floor', () => {
    // They booked the room and drank nothing. The room still cost what it cost.
    assert.equal(minSpendShortfall(0, 5000), 5000)
})

test('satang are rounded away rather than billed', () => {
    // A 40-satang surcharge costs more to explain than it collects.
    assert.equal(minSpendShortfall(4999.6, 5000), 0)
    assert.equal(minSpendShortfall(4999.4, 5000), 1)
})

test('a nonsense total raises nothing rather than something invented', () => {
    assert.equal(minSpendShortfall(Number.NaN, 5000), 0)
    assert.equal(minSpendShortfall(Number.POSITIVE_INFINITY, 5000), 0)
})

test('the surcharge is recognised again so it cannot be raised twice', () => {
    assert.equal(hasMinSpendCharge([{ name: MIN_SPEND_LINE }]), true)
    assert.equal(hasMinSpendCharge([{ name: 'Beer Lao' }]), false)
    assert.equal(hasMinSpendCharge([]), false)
})

test('a voided surcharge does not count as raised', () => {
    // A manager who struck it decided the room was not owed it tonight. The
    // till must not put it back on the next tap of Checkout.
    assert.equal(hasMinSpendCharge([{ name: MIN_SPEND_LINE, voidedAt: new Date() }]), false)
    // ...but a live one alongside a struck one still counts.
    assert.equal(hasMinSpendCharge([
        { name: MIN_SPEND_LINE, voidedAt: new Date() },
        { name: MIN_SPEND_LINE },
    ]), true)
})

test('a blank or zero field means no floor, not a floor of nothing', () => {
    // 0 would still satisfy `minSpend > 0` nowhere, but it WOULD make an
    // ordinary table look like a room that had met its minimum.
    for (const blank of ['', null, undefined, 0, '0', -5, 'abc', NaN]) {
        assert.equal(parseMinSpend(blank), null, `expected null for ${JSON.stringify(blank)}`)
    }
})

test('a real amount is stored in whole baht', () => {
    assert.equal(parseMinSpend('5000'), 5000)
    assert.equal(parseMinSpend(5000), 5000)
    assert.equal(parseMinSpend('4999.6'), 5000)
})
