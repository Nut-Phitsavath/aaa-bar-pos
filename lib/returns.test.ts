// Run: node --experimental-strip-types --test lib/returns.test.ts
//
// Restocking without a manager PIN, so the cap is the whole control: a table
// that was served five beers can hand back five, never six. Anything looser is
// a screen that manufactures inventory out of nothing.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { returnable, canReturn, type Returnable } from './returns.ts'

const HAD: Returnable[] = [
    { menuId: 'beerlao', variationSizeId: 'v1', name: 'Beer Lao', quantity: 5 },
    { menuId: 'water', variationSizeId: 'v2', name: 'Drinking Water', quantity: 2 },
]

test('what the table was served is what can come back', () => {
    assert.deepEqual(returnable(HAD, []), HAD)
})

test('the same drink on two rounds is one line', () => {
    const merged = returnable(
        [
            { menuId: 'beerlao', variationSizeId: 'v1', name: 'Beer Lao', quantity: 5 },
            { menuId: 'beerlao', variationSizeId: 'v1', name: 'Beer Lao', quantity: 3 },
        ],
        [],
    )
    assert.equal(merged.length, 1)
    assert.equal(merged[0].quantity, 8)
})

test('a bottle cannot be handed back twice', () => {
    const left = returnable(HAD, [{ menuId: 'beerlao', quantity: 2 }])
    assert.equal(left.find((r) => r.menuId === 'beerlao')?.quantity, 3)
    assert.equal(canReturn(left, [{ menuId: 'beerlao', quantity: 3 }]).ok, true)
    assert.deepEqual(
        canReturn(left, [{ menuId: 'beerlao', quantity: 4 }]),
        { ok: false, reason: 'MORE_THAN_ORDERED' },
    )
})

test('a drink returned in full stops being offered', () => {
    const left = returnable(HAD, [{ menuId: 'water', quantity: 2 }])
    assert.equal(left.some((r) => r.menuId === 'water'), false)
})

test('only what this table ordered can be returned', () => {
    // Otherwise the screen is a way to add stock from nothing.
    assert.deepEqual(
        canReturn(HAD, [{ menuId: 'chivas', quantity: 1 }]),
        { ok: false, reason: 'NOT_ON_THIS_BILL' },
    )
})

test('the cap cannot be split across two rows', () => {
    assert.deepEqual(
        canReturn(HAD, [{ menuId: 'beerlao', quantity: 3 }, { menuId: 'beerlao', quantity: 3 }]),
        { ok: false, reason: 'DUPLICATE_LINE' },
    )
})

test('quantities are whole and positive', () => {
    assert.equal(canReturn(HAD, [{ menuId: 'beerlao', quantity: 0 }]).ok, false)
    assert.equal(canReturn(HAD, [{ menuId: 'beerlao', quantity: -2 }]).ok, false)
    assert.equal(canReturn(HAD, [{ menuId: 'beerlao', quantity: 1.5 }]).ok, false)
})

test('an empty count is refused', () => {
    assert.deepEqual(canReturn(HAD, []), { ok: false, reason: 'NOTHING_TO_RETURN' })
})
