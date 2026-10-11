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

// ---------------------------------------------------------------------------
// Scoping a deal to a shelf, and pricing a promo onto a table bill.
//
// The bug these close: "15 Free 5" is a beer crate, and counting every line on
// the bill towards it let fifteen snacks unlock a beer deal - and then took the
// discount off the snacks as well. The schema carried a note calling this "the
// open fix" for months.
// ---------------------------------------------------------------------------

import { scopeOf, promoDiscountForLines } from './promotions.ts'

const BEER = 'cat-beer'
const SNACKS = 'cat-snacks'

const beerDeal = {
    isActive: true,
    discountType: 'percentage',
    discountValue: 20,
    startDate: new Date('2020-01-01'),
    endDate: new Date('2030-01-01'),
    minItems: 15,
    categoryId: BEER,
}

test('a scoped promo only counts its own shelf towards the minimum', () => {
    const snacksOnly = [{ categoryId: SNACKS, quantity: 20, total: 4000 }]
    // Twenty snacks must not unlock a beer deal.
    assert.equal(promoDiscountForLines(beerDeal, snacksOnly), 0)
})

test('a scoped promo discounts only its own shelf', () => {
    const mixed = [
        { categoryId: BEER, quantity: 15, total: 3000 },
        { categoryId: SNACKS, quantity: 10, total: 5000 },
    ]
    // 20% of the beer alone, not of the 8,000 bill.
    assert.equal(promoDiscountForLines(beerDeal, mixed), 600)
})

test('the minimum counts quantity, not lines', () => {
    const oneBigLine = [{ categoryId: BEER, quantity: 15, total: 3000 }]
    const manySmall = [
        { categoryId: BEER, quantity: 7, total: 1400 },
        { categoryId: BEER, quantity: 8, total: 1600 },
    ]
    assert.equal(promoDiscountForLines(beerDeal, oneBigLine), 600)
    assert.equal(promoDiscountForLines(beerDeal, manySmall), 600)
})

test('one bottle short of the minimum is no deal', () => {
    assert.equal(promoDiscountForLines(beerDeal, [{ categoryId: BEER, quantity: 14, total: 2800 }]), 0)
})

test('an unscoped promo still sees the whole bill', () => {
    const blanket = { ...beerDeal, categoryId: null, minItems: null }
    const mixed = [
        { categoryId: BEER, quantity: 2, total: 400 },
        { categoryId: SNACKS, quantity: 1, total: 600 },
    ]
    assert.equal(promoDiscountForLines(blanket, mixed), 200)
})

test('an expired deal takes nothing off, however much is in scope', () => {
    const expired = { ...beerDeal, endDate: new Date('2020-06-01') }
    assert.equal(promoDiscountForLines(expired, [{ categoryId: BEER, quantity: 50, total: 10000 }]), 0)
})

test('scopeOf reports what the deal can see', () => {
    const lines = [
        { categoryId: BEER, quantity: 15, total: 3000 },
        { categoryId: SNACKS, quantity: 10, total: 5000 },
    ]
    assert.deepEqual(scopeOf(lines, BEER), { count: 15, subtotal: 3000 })
    assert.deepEqual(scopeOf(lines, null), { count: 25, subtotal: 8000 })
})

// ---------------------------------------------------------------------------
// The scope has to survive the form, not just the engine.
//
// The scoping worked from the day it was written, but only if categoryId was
// written straight into the database - the API dropped it, the validator never
// saw it, and the form had no field. The feature was unreachable by anyone
// using the app.
// ---------------------------------------------------------------------------

const baseInput = {
    name: 'Crate deal', code: 'CRATE', discountType: 'percentage', discountValue: 25,
    startDate: '2026-01-01', endDate: '2026-12-31',
}

test('a category picked on the form reaches the promo', () => {
    const v = validatePromotionInput({ ...baseInput, categoryId: 'cat-beer' })
    assert.equal(v.ok, true)
    assert.equal((v as any).categoryId, 'cat-beer')
})

test('the empty string a select sends for "whole bill" becomes null', () => {
    // Not cosmetic: storing "" as a category id makes the deal match no line at
    // all, so a blanket promotion would silently be worth nothing.
    const v = validatePromotionInput({ ...baseInput, categoryId: '' })
    assert.equal((v as any).categoryId, null)
})

test('an omitted category is the whole bill', () => {
    const v = validatePromotionInput(baseInput)
    assert.equal((v as any).categoryId, null)
})

test('whitespace is not a category', () => {
    const v = validatePromotionInput({ ...baseInput, categoryId: '   ' })
    assert.equal((v as any).categoryId, null)
})

// ---------------------------------------------------------------------------
// Who may pick a deal, and when it is live.
//
// Both of these were decided inline before - one not at all, one by passing
// Number.MAX_SAFE_INTEGER to a function to make it skip a check.
// ---------------------------------------------------------------------------

import { isStaffPickable, promoWindowBlocker } from './promotions.ts'

const live = {
    isActive: true, discountType: 'percentage', discountValue: 10,
    startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31'),
}
const during = new Date('2026-06-01')

test('a customer coupon is never offered in the staff picker', () => {
    // The whole point of staffPickable:false. Before this check, every coupon
    // in the system sat in the till's list waiting to be given away.
    assert.equal(isStaffPickable({ staffPickable: false }), false)
})

test('a normal promo is pickable, and so is one that never set the flag', () => {
    assert.equal(isStaffPickable({ staffPickable: true }), true)
    assert.equal(isStaffPickable({}), true)
})

test('nothing is pickable', () => {
    assert.equal(isStaffPickable(null), false)
    assert.equal(isStaffPickable(undefined), false)
})

test('the window check ignores the item count entirely', () => {
    // It must say nothing about minimums: the apply endpoint checks the window
    // before the bill's contents are known, and used to fake an item count to
    // get that answer.
    const withMin = { ...live, minItems: 500 }
    assert.equal(promoWindowBlocker(withMin, during), null)
})

test('the window check catches each way a deal can be unusable', () => {
    assert.equal(promoWindowBlocker({ ...live, isActive: false }, during), 'inactive')
    assert.equal(promoWindowBlocker(live, new Date('2025-12-31')), 'not_started')
    assert.equal(promoWindowBlocker(live, new Date('2027-01-01')), 'expired')
    assert.equal(promoWindowBlocker(null, during), 'inactive')
})

test('promoBlocker still answers the full question', () => {
    // The window checks were moved out; the combined check must not have lost
    // any of them on the way.
    const withMin = { ...live, minItems: 15 }
    assert.equal(promoBlocker(withMin, 20, during), null)
    assert.equal(promoBlocker(withMin, 14, during), 'min_items')
    assert.equal(promoBlocker({ ...withMin, isActive: false }, 20, during), 'inactive')
    assert.equal(promoBlocker(withMin, 20, new Date('2027-01-01')), 'expired')
})
