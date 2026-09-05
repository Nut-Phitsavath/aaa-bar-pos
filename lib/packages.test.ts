// Run: node --experimental-strip-types --test lib/packages.test.ts
//
// This is a money path with no manager PIN on it, so the arithmetic and the
// caps are the only things standing between a bar and a staff member trading a
// 3,500 baht set for a bottle of water every night.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    chargeFor, valueOf, canSwap, remainingContents, componentIndex, contentsOf,
    summariseSwaps,
    type Component, type SellableMenu,
} from './packages.ts'

/** The seeded menu, trimmed to what a package draws on. */
const MENUS: SellableMenu[] = [
    { menuId: 'm-beerlao', variationSizeId: 'v-beerlao', name: 'Beer Lao', unitPrice: 45, recipe: [{ ingredientId: 'i-beerlao', quantity: 1 }] },
    { menuId: 'm-heineken', variationSizeId: 'v-heineken', name: 'Heineken', unitPrice: 60, recipe: [{ ingredientId: 'i-heineken', quantity: 1 }] },
    { menuId: 'm-water', variationSizeId: 'v-water', name: 'Drinking Water', unitPrice: 20, recipe: [{ ingredientId: 'i-water', quantity: 1 }] },
    // Not single-serve: a bucket is 2kg of ice, a mojito is six things.
    { menuId: 'm-icebucket', variationSizeId: 'v-icebucket', name: 'Ice Bucket', unitPrice: 20, recipe: [{ ingredientId: 'i-ice', quantity: 2 }] },
    { menuId: 'm-mojito', variationSizeId: 'v-mojito', name: 'Mojito', unitPrice: 150, recipe: [{ ingredientId: 'i-rum', quantity: 0.06 }, { ingredientId: 'i-lime', quantity: 1 }] },
]

/** The owner's example: a package of one wine, four Beer Lao, two Heineken. */
const PACKAGE: Component[] = [
    { menuId: 'wine', variationSizeId: null, name: 'Wine', unitPrice: 400, quantity: 1 },
    { menuId: 'beerlao', variationSizeId: null, name: 'Beer Lao', unitPrice: 45, quantity: 4 },
    { menuId: 'heineken', variationSizeId: null, name: 'Heineken', unitPrice: 60, quantity: 2 },
]

test('a dearer replacement is charged at the difference', () => {
    // 2 Heineken out (120) for 2 Beer Lao + 2 water in (130).
    const out = valueOf([{ unitPrice: 60, quantity: 2 }])
    const inn = valueOf([{ unitPrice: 45, quantity: 2 }, { unitPrice: 20, quantity: 2 }])
    assert.equal(out, 120)
    assert.equal(inn, 130)
    assert.equal(chargeFor(out, inn), 10)
})

test('a cheaper replacement costs nothing and the bar keeps the margin', () => {
    // The package price is a floor. This is the rule the owner confirmed and
    // the one Toast documents for bundles: swaps push a price up, never down.
    const out = valueOf([{ unitPrice: 60, quantity: 2 }])
    const inn = valueOf([{ unitPrice: 45, quantity: 2 }, { unitPrice: 20, quantity: 1 }])
    assert.equal(inn, 110)
    assert.equal(chargeFor(out, inn), 0)
})

test('an even swap is free', () => {
    assert.equal(chargeFor(120, 120), 0)
})

test('no credit is ever returned, however lopsided the trade', () => {
    // 3,500 of Chivas for a 20 baht water still charges nothing, and must never
    // produce a negative charge that would reduce the bill.
    assert.equal(chargeFor(3500, 20), 0)
})

test('a package cannot give up more than it holds', () => {
    assert.deepEqual(
        canSwap(PACKAGE, [{ menuId: 'heineken', quantity: 3 }], [{ quantity: 1 }]),
        { ok: false, reason: 'MORE_THAN_PACKAGE_HOLDS' },
    )
    assert.deepEqual(canSwap(PACKAGE, [{ menuId: 'heineken', quantity: 2 }], [{ quantity: 1 }]), { ok: true })
})

test('only what the package contains can be taken out of it', () => {
    assert.deepEqual(
        canSwap(PACKAGE, [{ menuId: 'chivas', quantity: 1 }], [{ quantity: 1 }]),
        { ok: false, reason: 'NOT_IN_PACKAGE' },
    )
})

test('the cap cannot be split across two rows for the same drink', () => {
    assert.deepEqual(
        canSwap(PACKAGE, [{ menuId: 'heineken', quantity: 2 }, { menuId: 'heineken', quantity: 1 }], [{ quantity: 1 }]),
        { ok: false, reason: 'DUPLICATE_LINE' },
    )
})

test('quantities are whole and positive', () => {
    assert.equal(canSwap(PACKAGE, [{ menuId: 'heineken', quantity: 0 }], [{ quantity: 1 }]).ok, false)
    assert.equal(canSwap(PACKAGE, [{ menuId: 'heineken', quantity: -1 }], [{ quantity: 1 }]).ok, false)
    assert.equal(canSwap(PACKAGE, [{ menuId: 'heineken', quantity: 1.5 }], [{ quantity: 1 }]).ok, false)
    assert.equal(canSwap(PACKAGE, [{ menuId: 'heineken', quantity: 1 }], [{ quantity: 0 }]).ok, false)
})

test('an empty swap is refused', () => {
    assert.deepEqual(canSwap(PACKAGE, [], []), { ok: false, reason: 'NOTHING_TO_SWAP' })
})

test('adding alone is allowed - it can only ever cost the customer more', () => {
    assert.deepEqual(canSwap(PACKAGE, [], [{ quantity: 2 }]), { ok: true })
})

test('swaps stack against what the package has left', () => {
    const left = remainingContents(PACKAGE, [{ menuId: 'heineken', quantity: 1 }])
    assert.equal(left.find((c) => c.menuId === 'heineken')?.quantity, 1)
    // A second swap can only take the one that remains.
    assert.equal(canSwap(left, [{ menuId: 'heineken', quantity: 2 }], [{ quantity: 1 }]).ok, false)
    assert.equal(canSwap(left, [{ menuId: 'heineken', quantity: 1 }], [{ quantity: 1 }]).ok, true)
})

test('a component swapped out entirely stops being offered', () => {
    const left = remainingContents(PACKAGE, [{ menuId: 'heineken', quantity: 2 }])
    assert.equal(left.some((c) => c.menuId === 'heineken'), false)
    assert.equal(left.length, 2)
})

test('money keeps two decimals rather than drifting', () => {
    // Percentages and thirds land here eventually; a raw float difference would
    // print 10.000000000000002 on a receipt.
    assert.equal(chargeFor(0.1 + 0.2, 1), 0.7)
    assert.equal(valueOf([{ unitPrice: 0.1, quantity: 3 }]), 0.3)
})

test('only a true single-serve item represents an ingredient', () => {
    const index = componentIndex(MENUS)
    assert.equal(index.get('i-beerlao')?.menuId, 'm-beerlao')
    assert.equal(index.get('i-heineken')?.menuId, 'm-heineken')
    // A 2kg bucket is not "one ice", and a mojito is not "one rum".
    assert.equal(index.has('i-ice'), false)
    assert.equal(index.has('i-rum'), false)
    assert.equal(index.has('i-lime'), false)
})

test('a package advertises only the components a bar can price and restock', () => {
    // Beer Lao Bucket: five bottles and two kilos of ice.
    const contents = contentsOf(
        [{ ingredientId: 'i-beerlao', quantity: 5 }, { ingredientId: 'i-ice', quantity: 2 }],
        componentIndex(MENUS),
    )
    assert.equal(contents.length, 1)
    assert.deepEqual(
        { name: contents[0].name, quantity: contents[0].quantity, unitPrice: contents[0].unitPrice },
        { name: 'Beer Lao', quantity: 5, unitPrice: 45 },
    )
})

test('the owner\'s package prices out as expected', () => {
    const contents = contentsOf(
        [{ ingredientId: 'i-beerlao', quantity: 4 }, { ingredientId: 'i-heineken', quantity: 2 }],
        componentIndex(MENUS),
    )
    // 4 Beer Lao + 2 Heineken = 180 + 120.
    assert.equal(valueOf(contents), 300)
    // Swap the two Heineken for two Beer Lao and two waters: 130 in, 120 out.
    assert.equal(canSwap(contents, [{ menuId: 'm-heineken', quantity: 2 }], [{ quantity: 4 }]).ok, true)
    assert.equal(chargeFor(120, 130), 10)
})

test('a fractional recipe line is never offered as a whole component', () => {
    // A spirit measured in 30ml pours would otherwise appear as "0.043 bottles".
    const contents = contentsOf([{ ingredientId: 'i-beerlao', quantity: 0.5 }], componentIndex(MENUS))
    assert.deepEqual(contents, [])
})

test('two swaps on one package read as one statement', () => {
    const summary = summariseSwaps([
        { lines: [
            { direction: 'OUT', name: 'Heineken', quantity: 1 },
            { direction: 'IN', name: 'Beer Lao', quantity: 1 },
        ] },
        { lines: [
            { direction: 'OUT', name: 'Heineken', quantity: 1 },
            { direction: 'IN', name: 'Beer Lao', quantity: 2 },
            { direction: 'IN', name: 'Water', quantity: 1 },
        ] },
    ])
    // The customer ended up two Heineken down and three Beer Lao up; nobody
    // reading a bill wants that told as two separate negotiations.
    assert.deepEqual(summary.out, [{ direction: 'OUT', name: 'Heineken', quantity: 2 }])
    assert.deepEqual(summary.in, [
        { direction: 'IN', name: 'Beer Lao', quantity: 3 },
        { direction: 'IN', name: 'Water', quantity: 1 },
    ])
})

test('a line with no swaps summarises to nothing', () => {
    const summary = summariseSwaps([])
    assert.deepEqual(summary.out, [])
    assert.deepEqual(summary.in, [])
})
