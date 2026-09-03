// Run: node --experimental-strip-types --test lib/tabs.test.ts
//
// Allocating a lump payment across a customer's open bills. These cover the
// cases where a customer would be told they still owe money they just paid.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allocateOldestFirst, outstandingOfBills } from './tabs.ts'

const bill = (id: string, balance: number, day: string) => ({
    id, balance, closedAt: `2026-08-${day}T20:00:00.000Z`,
})

test('outstanding is the sum of what is still owed', () => {
    assert.equal(outstandingOfBills([bill('a', 500, '15'), bill('b', 300, '20')]), 800)
})

test('outstanding ignores a bill already cleared', () => {
    assert.equal(outstandingOfBills([bill('a', 0, '15'), bill('b', 300, '20')]), 300)
})

test('a payment clears the oldest bill first', () => {
    // Paying off a debt means starting at the beginning, and it stops the
    // ledger filling with ancient part-paid bills nobody will close.
    const r = allocateOldestFirst(500, [bill('new', 400, '20'), bill('old', 500, '15')])
    assert.deepEqual(r.parts, [{ sessionId: 'old', amount: 500 }])
    assert.equal(r.applied, 500)
    assert.equal(r.unapplied, 0)
})

test('a payment spills onto the next bill once the oldest is cleared', () => {
    const r = allocateOldestFirst(700, [bill('new', 400, '20'), bill('old', 500, '15')])
    assert.deepEqual(r.parts, [
        { sessionId: 'old', amount: 500 },
        { sessionId: 'new', amount: 200 },
    ])
    assert.equal(r.applied, 700)
})

test('a part payment lands entirely on the oldest bill', () => {
    const r = allocateOldestFirst(200, [bill('old', 500, '15'), bill('new', 400, '20')])
    assert.deepEqual(r.parts, [{ sessionId: 'old', amount: 200 }])
    assert.equal(r.applied, 200)
    assert.equal(r.unapplied, 0)
})

test('paying more than is owed returns the excess as change, not credit', () => {
    // A bar hands the difference back across the counter. Carrying a negative
    // balance would be a second concept to reconcile for no gain.
    const r = allocateOldestFirst(1000, [bill('old', 500, '15'), bill('new', 300, '20')])
    assert.equal(r.applied, 800)
    assert.equal(r.unapplied, 200)
})

test('bills already cleared are skipped, not allocated zero', () => {
    const r = allocateOldestFirst(300, [bill('paid', 0, '10'), bill('open', 400, '15')])
    assert.deepEqual(r.parts, [{ sessionId: 'open', amount: 300 }])
})

test('nothing owed means nothing applied', () => {
    const r = allocateOldestFirst(500, [])
    assert.deepEqual(r.parts, [])
    assert.equal(r.applied, 0)
    assert.equal(r.unapplied, 500)
})

test('a zero or negative payment allocates nothing', () => {
    assert.equal(allocateOldestFirst(0, [bill('a', 500, '15')]).applied, 0)
    assert.equal(allocateOldestFirst(-100, [bill('a', 500, '15')]).applied, 0)
})

test('allocation is deterministic when two bills closed at the same moment', () => {
    // Two runs must agree, or a retried payment could land differently.
    const same = [
        { id: 'b', balance: 300, closedAt: '2026-08-15T20:00:00.000Z' },
        { id: 'a', balance: 300, closedAt: '2026-08-15T20:00:00.000Z' },
    ]
    const first = allocateOldestFirst(300, same)
    const second = allocateOldestFirst(300, [...same].reverse())
    assert.deepEqual(first.parts, second.parts)
    assert.equal(first.parts[0].sessionId, 'a')
})
