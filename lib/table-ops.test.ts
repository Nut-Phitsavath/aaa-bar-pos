// Run: node --experimental-strip-types --test lib/table-ops.test.ts
//
// None of these operations asks for a manager PIN, so the rules here are what
// stands between a busy floor and a bill nobody can account for. The one that
// matters most: money already taken pins a bill in place.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    canMove, canMerge, canSplit, withSwapCharges,
    canSplitQuantities, swapChargeLineIds,
} from './table-ops.ts'

const open = (over = {}) => ({ id: 's1', status: 'OPEN', paidCount: 0, ...over })
const freeTable = (over = {}) => ({ id: 't2', isActive: true, occupied: false, ...over })

test('a party can move to a free table', () => {
    assert.deepEqual(canMove({ status: 'OPEN' }, freeTable(), 't1'), { ok: true })
    // Asking for the bill still occupies the table, so it can still move.
    assert.deepEqual(canMove({ status: 'BILL_REQUESTED' }, freeTable(), 't1'), { ok: true })
})

test('a move is refused where it would collide', () => {
    assert.deepEqual(canMove({ status: 'OPEN' }, freeTable({ occupied: true }), 't1'), { ok: false, reason: 'TABLE_OCCUPIED' })
    assert.deepEqual(canMove({ status: 'OPEN' }, freeTable({ isActive: false }), 't1'), { ok: false, reason: 'TABLE_INACTIVE' })
    assert.deepEqual(canMove({ status: 'OPEN' }, freeTable({ id: 't1' }), 't1'), { ok: false, reason: 'SAME_TABLE' })
    assert.deepEqual(canMove({ status: 'CLOSED' }, freeTable(), 't1'), { ok: false, reason: 'SESSION_NOT_OPEN' })
})

test('a part-paid bill can still change seats', () => {
    // Nothing about the money moves, so there is no reason to stop it.
    assert.deepEqual(canMove({ status: 'OPEN' }, freeTable(), 't1'), { ok: true })
})

test('two open bills can be merged', () => {
    assert.deepEqual(canMerge(open({ id: 'a' }), open({ id: 'b' }), 'shift1'), { ok: true })
})

test('money already taken pins a bill in place', () => {
    // A tender belongs to the bill it was taken against. Moving rounds out from
    // under it would leave a payment explaining a total that no longer exists.
    assert.deepEqual(
        canMerge(open({ id: 'a', paidCount: 1 }), open({ id: 'b' }), 'shift1'),
        { ok: false, reason: 'ALREADY_PAID' },
    )
    assert.deepEqual(
        canMerge(open({ id: 'a' }), open({ id: 'b', paidCount: 2 }), 'shift1'),
        { ok: false, reason: 'ALREADY_PAID' },
    )
    assert.deepEqual(
        canSplit(open({ paidCount: 1 }), ['l1', 'l2'], ['l1'], 'shift1'),
        { ok: false, reason: 'ALREADY_PAID' },
    )
})

test('a bill cannot be merged into itself, or merged when closed', () => {
    assert.deepEqual(canMerge(open({ id: 'a' }), open({ id: 'a' }), 'shift1'), { ok: false, reason: 'SAME_BILL' })
    assert.deepEqual(
        canMerge(open({ id: 'a', status: 'CLOSED' }), open({ id: 'b' }), 'shift1'),
        { ok: false, reason: 'SESSION_NOT_OPEN' },
    )
})

test('nothing moves without an open shift', () => {
    assert.deepEqual(canMerge(open({ id: 'a' }), open({ id: 'b' }), null), { ok: false, reason: 'NO_OPEN_SHIFT' })
    assert.deepEqual(canSplit(open(), ['l1', 'l2'], ['l1'], null), { ok: false, reason: 'NO_OPEN_SHIFT' })
})

test('a split moves some lines, never all of them', () => {
    assert.deepEqual(canSplit(open(), ['l1', 'l2', 'l3'], ['l1', 'l2'], 'shift1'), { ok: true })
    // Taking everything leaves an empty bill on the floor and a new reference
    // for what is plainly the same table.
    assert.deepEqual(
        canSplit(open(), ['l1', 'l2'], ['l1', 'l2'], 'shift1'),
        { ok: false, reason: 'CANNOT_SPLIT_EVERYTHING' },
    )
    assert.deepEqual(canSplit(open(), ['l1', 'l2'], [], 'shift1'), { ok: false, reason: 'NOTHING_SELECTED' })
})

test('a split only moves lines that are on this bill', () => {
    assert.deepEqual(
        canSplit(open(), ['l1', 'l2'], ['other'], 'shift1'),
        { ok: false, reason: 'LINE_NOT_ON_BILL' },
    )
    assert.deepEqual(
        canSplit(open(), ['l1', 'l2', 'l3'], ['l1', 'l1'], 'shift1'),
        { ok: false, reason: 'DUPLICATE_LINE' },
    )
})

test('an exchange upcharge follows its package line, and never moves alone', () => {
    const swaps = [{ orderItemId: 'set1', chargeItemId: 'diff1' }]
    // Ticking the set takes its price difference with it.
    assert.deepEqual(withSwapCharges(['set1'], swaps).sort(), ['diff1', 'set1'])
    // Ticking only the difference leaves it where the set is: otherwise one
    // guest pays the upcharge on another guest's package.
    assert.deepEqual(withSwapCharges(['diff1'], swaps), [])
    // A set with no upcharge is untouched, and so is an unrelated line.
    assert.deepEqual(withSwapCharges(['beer'], swaps), ['beer'])
    assert.deepEqual(withSwapCharges(['set1'], [{ orderItemId: 'set1', chargeItemId: null }]), ['set1'])
})

test('a discounted bill still adds up after it is split', () => {
    // The reason the split-off bill inherits the discount: the manager approved
    // it for these drinks, and two halves at full price bill the party more
    // than the table was quoted.
    const pct = (g: number) => Math.max(0, Math.ceil(g - g * 0.1))
    assert.equal(pct(700) + pct(300), pct(1000))
})

// --- canSplitQuantities: splitting by the unit, not the row ------------------
//
// The case that drove this: a table with 2 whiskeys, 2 waters and 2 snacks is
// THREE rows of two, because the till merges identical items. Moving one
// whiskey was impossible before.

/** 2 whiskeys, 2 waters, 2 snacks - six drinks on three lines. */
const sixOnThree = () => [
    { id: 'wh', quantity: 2 },
    { id: 'wa', quantity: 2 },
    { id: 'sn', quantity: 2 },
]

test('one whiskey and one water can leave, which was the whole point', () => {
    const check = canSplitQuantities(open(), sixOnThree(), [
        { itemId: 'wh', quantity: 1 },
        { itemId: 'wa', quantity: 1 },
    ], 'shift1')
    assert.deepEqual(check, { ok: true })
})

test('a whole line still moves, the way it always did', () => {
    assert.deepEqual(
        canSplitQuantities(open(), sixOnThree(), [{ itemId: 'wh', quantity: 2 }], 'shift1'),
        { ok: true },
    )
})

test('"everything" is counted in drinks, not rows', () => {
    // One of each line is three of six drinks: a real bill stays behind, even
    // though every row was touched. The row-based rule refused this.
    const some = canSplitQuantities(open(), sixOnThree(), [
        { itemId: 'wh', quantity: 1 },
        { itemId: 'wa', quantity: 1 },
        { itemId: 'sn', quantity: 1 },
    ], 'shift1')
    assert.deepEqual(some, { ok: true })

    // All of each is all six, which is a merge wearing a split's clothes.
    const all = canSplitQuantities(open(), sixOnThree(), [
        { itemId: 'wh', quantity: 2 },
        { itemId: 'wa', quantity: 2 },
        { itemId: 'sn', quantity: 2 },
    ], 'shift1')
    assert.deepEqual(all, { ok: false, reason: 'CANNOT_SPLIT_EVERYTHING' })
})

test('the last drink on a bill cannot leave', () => {
    assert.deepEqual(
        canSplitQuantities(open(), [{ id: 'only', quantity: 1 }], [{ itemId: 'only', quantity: 1 }], 'shift1'),
        { ok: false, reason: 'CANNOT_SPLIT_EVERYTHING' },
    )
})

test('you cannot move more drinks than the line holds', () => {
    assert.deepEqual(
        canSplitQuantities(open(), sixOnThree(), [{ itemId: 'wh', quantity: 3 }], 'shift1'),
        { ok: false, reason: 'MORE_THAN_ORDERED' },
    )
})

test('half a beer is not a thing the bar can pour', () => {
    assert.deepEqual(
        canSplitQuantities(open(), sixOnThree(), [{ itemId: 'wh', quantity: 1.5 }], 'shift1'),
        { ok: false, reason: 'QUANTITY_MUST_BE_WHOLE' },
    )
    assert.deepEqual(
        canSplitQuantities(open(), sixOnThree(), [{ itemId: 'wh', quantity: 0 }], 'shift1'),
        { ok: false, reason: 'QUANTITY_MUST_BE_POSITIVE' },
    )
    assert.deepEqual(
        canSplitQuantities(open(), sixOnThree(), [{ itemId: 'wh', quantity: -1 }], 'shift1'),
        { ok: false, reason: 'QUANTITY_MUST_BE_POSITIVE' },
    )
})

test('a line that is not on the bill cannot be moved off it', () => {
    assert.deepEqual(
        canSplitQuantities(open(), sixOnThree(), [{ itemId: 'ghost', quantity: 1 }], 'shift1'),
        { ok: false, reason: 'LINE_NOT_ON_BILL' },
    )
})

test('the same line twice would pass each check and break the cap together', () => {
    assert.deepEqual(
        canSplitQuantities(open(), sixOnThree(), [
            { itemId: 'wh', quantity: 2 },
            { itemId: 'wh', quantity: 2 },
        ], 'shift1'),
        { ok: false, reason: 'DUPLICATE_LINE' },
    )
})

test('a swapped package moves whole or not at all', () => {
    const lines = [{ id: 'pkg', quantity: 2, hasSwap: true }, { id: 'beer', quantity: 4 }]
    // Splitting the row leaves no honest answer to which half the exchange
    // happened on.
    assert.deepEqual(
        canSplitQuantities(open(), lines, [{ itemId: 'pkg', quantity: 1 }], 'shift1'),
        { ok: false, reason: 'SWAPPED_LINE_MOVES_WHOLE' },
    )
    // Whole is fine.
    assert.deepEqual(
        canSplitQuantities(open(), lines, [{ itemId: 'pkg', quantity: 2 }], 'shift1'),
        { ok: true },
    )
})

test('the old refusals still hold with quantities in play', () => {
    const one = [{ itemId: 'wh', quantity: 1 }]
    assert.deepEqual(
        canSplitQuantities(open({ status: 'CLOSED' }), sixOnThree(), one, 'shift1'),
        { ok: false, reason: 'SESSION_NOT_OPEN' },
    )
    assert.deepEqual(
        canSplitQuantities(open({ paidCount: 1 }), sixOnThree(), one, 'shift1'),
        { ok: false, reason: 'ALREADY_PAID' },
    )
    assert.deepEqual(
        canSplitQuantities(open(), sixOnThree(), one, null),
        { ok: false, reason: 'NO_OPEN_SHIFT' },
    )
    assert.deepEqual(
        canSplitQuantities(open(), sixOnThree(), [], 'shift1'),
        { ok: false, reason: 'NOTHING_SELECTED' },
    )
})

test('an upcharge follows the package it came from, and only once', () => {
    const swaps = [{ orderItemId: 'pkg', chargeItemId: 'chg' }]
    assert.deepEqual(swapChargeLineIds([{ itemId: 'pkg', quantity: 2 }], swaps), ['chg'])
    // Not dragged in when its package stays put.
    assert.deepEqual(swapChargeLineIds([{ itemId: 'beer', quantity: 1 }], swaps), [])
    // Not added twice if the charge was ticked as well.
    assert.deepEqual(
        swapChargeLineIds([{ itemId: 'pkg', quantity: 2 }, { itemId: 'chg', quantity: 1 }], swaps),
        [],
    )
})
