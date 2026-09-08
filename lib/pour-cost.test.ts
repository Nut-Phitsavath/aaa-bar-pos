// Run: node --experimental-strip-types --test lib/pour-cost.test.ts
//
// A bar that prices a drink below what it costs to pour finds out at
// stocktake, not at the till. This is the arithmetic that puts it on screen
// while the recipe is still being typed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recipeCost, pourCost, bandFor, verdictFor } from './pour-cost.ts'

test('a recipe costs the sum of its lines at base-unit cost', () => {
    // 30ml out of a 700ml bottle costing 450 THB is 19.29 THB.
    const lines = [
        { quantity: 30, costPerPurchaseUnit: 450, purchaseMultiplier: 700 },
        { quantity: 1, costPerPurchaseUnit: 12, purchaseMultiplier: 1 },
    ]
    assert.equal(recipeCost(lines), 31.29)
})

test('an empty recipe costs nothing rather than throwing', () => {
    assert.equal(recipeCost([]), 0)
})

test('a line with a zero multiplier is skipped, not turned into Infinity', () => {
    // A multiplier of zero is bad data, and one bad ingredient must not make
    // the whole recipe cost NaN and blank the footer.
    const lines = [
        { quantity: 30, costPerPurchaseUnit: 450, purchaseMultiplier: 0 },
        { quantity: 1, costPerPurchaseUnit: 12, purchaseMultiplier: 1 },
    ]
    assert.equal(recipeCost(lines), 12)
})

test('pour cost is cost as a percentage of price', () => {
    assert.equal(pourCost(31.29, 180), 17.4)
})

test('a free item is not an infinite pour cost', () => {
    assert.equal(pourCost(31.29, 0), 0)
})

test('the bands are this bar\'s, not the textbook\'s', () => {
    // Deliberately wider than the trade's 18-22% for spirits. The existing
    // check script calibrated these for Laos: imported spirit is duty-heavy
    // and priced against the street, local beer is cheap on the shelf and
    // priced against the bar next door. Do not "correct" them to the textbook.
    assert.deepEqual(bandFor('Spirits'), [15, 30])
    assert.deepEqual(bandFor('Cocktails'), [20, 35])
    assert.deepEqual(bandFor('Sets'), [25, 45])
    const fallback = bandFor('Something New')
    assert.ok(fallback[1] > fallback[0])
    assert.deepEqual(bandFor(null), fallback)
})

test('selling below cost is called out, not merely flagged as high', () => {
    // A manager reading a list needs the one that loses money to stand out
    // from the one that is merely priced thin.
    assert.equal(verdictFor('Spirits', 140), 'BELOW_COST')
    assert.equal(verdictFor('Spirits', 35), 'HIGH')
    assert.equal(verdictFor('Spirits', 20), 'OK')
    assert.equal(verdictFor('Spirits', 10), 'LOW')
})
