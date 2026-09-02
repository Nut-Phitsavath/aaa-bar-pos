// Run: node --experimental-strip-types --test lib/promotions.test.ts
//
// Money path. These cover the cases that would otherwise show one number on
// the till and store a different one on the order.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promoBlocker, promoDiscountFor, validatePromotionInput } from './promotions.ts'

const base = {
    isActive: true,
    discountType: 'fixed',
    discountValue: 70000,
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    minItems: null as number | null,
}
const now = new Date('2026-08-29')

test('percentage rounds to whole kip', () => {
    const promo = { ...base, discountType: 'percentage', discountValue: 15 }
    assert.equal(promoDiscountFor(promo, 33333, 1, now), 5000)
})

test('fixed promo larger than the cart clamps to the cart', () => {
    // 18F6 is 210,000. On a 45,000 order the customer pays 0, never -165,000.
    const promo = { ...base, discountValue: 210000 }
    assert.equal(promoDiscountFor(promo, 45000, 1, now), 45000)
})

test('expired promo is worth nothing', () => {
    const promo = { ...base, endDate: '2026-04-05' }
    assert.equal(promoBlocker(promo, 1, now), 'expired')
    assert.equal(promoDiscountFor(promo, 100000, 1, now), 0)
})

test('promo that has not started yet is worth nothing', () => {
    const promo = { ...base, startDate: '2026-12-01' }
    assert.equal(promoBlocker(promo, 1, now), 'not_started')
    assert.equal(promoDiscountFor(promo, 100000, 1, now), 0)
})

test('inactive promo is worth nothing', () => {
    const promo = { ...base, isActive: false }
    assert.equal(promoBlocker(promo, 1, now), 'inactive')
    assert.equal(promoDiscountFor(promo, 100000, 1, now), 0)
})

test('minItems gates the discount', () => {
    // "15 Free 5": 20 drinks rung up, 175,000 off.
    const promo = { ...base, discountValue: 175000, minItems: 20 }
    assert.equal(promoBlocker(promo, 19, now), 'min_items')
    assert.equal(promoDiscountFor(promo, 700000, 19, now), 0)
    assert.equal(promoBlocker(promo, 20, now), null)
    assert.equal(promoDiscountFor(promo, 700000, 20, now), 175000)
})

test('empty cart never yields a negative total', () => {
    assert.equal(promoDiscountFor(base, 0, 0, now), 0)
})

test('validation rejects a negative minItems', () => {
    const r = validatePromotionInput({
        name: 'x', code: 'X', discountType: 'fixed', discountValue: 1000,
        startDate: '2026-01-01', endDate: '2026-12-31', minItems: -3,
    })
    assert.equal(r.ok, false)
})

test('validation accepts a blank minItems as no minimum', () => {
    const r = validatePromotionInput({
        name: 'x', code: 'X', discountType: 'fixed', discountValue: 1000,
        startDate: '2026-01-01', endDate: '2026-12-31', minItems: '',
    })
    assert.equal(r.ok, true)
    assert.equal(r.ok && r.minItems, null)
})
