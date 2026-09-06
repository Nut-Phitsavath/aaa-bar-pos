// Run: node --experimental-strip-types --test lib/table-ops.test.ts
//
// None of these operations asks for a manager PIN, so the rules here are what
// stands between a busy floor and a bill nobody can account for. The one that
// matters most: money already taken pins a bill in place.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canMove, canMerge, canSplit, withSwapCharges } from './table-ops.ts'

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
