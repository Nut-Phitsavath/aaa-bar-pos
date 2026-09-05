// Run: node --experimental-strip-types --test lib/voids.test.ts
//
// Voiding is where a bill quietly loses money, so the arithmetic that decides
// what a round is still worth after a line is struck lives here, testable on
// its own rather than buried inside a route handler.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    VOID_REASONS, isVoidReason, liveItems, voidedItems, totalsFrom,
    canVoid, allVoided,
} from './voids.ts'

const line = (id: string, price: number, quantity: number, voidedAt: string | null = null) => ({
    id, price, quantity, total: price * quantity, voidedAt,
})

// --- The reason list (req #5: "mandatory void reason selection") -------------

test('the reason list is fixed and non-empty', () => {
    assert.ok(VOID_REASONS.length >= 5)
    assert.ok(VOID_REASONS.includes('DUPLICATE'))
})

test('a reason off the list is refused', () => {
    // Free text in this field would make the report ungroupable, which is the
    // whole reason the requirement asks for a selection rather than a note.
    assert.equal(isVoidReason('DUPLICATE'), true)
    assert.equal(isVoidReason('whatever'), false)
    assert.equal(isVoidReason(''), false)
    assert.equal(isVoidReason(null), false)
})

// --- Which lines still count -------------------------------------------------

test('a voided line stops counting toward the bill', () => {
    const items = [line('a', 45, 5), line('b', 60, 1, '2026-09-05T18:00:00Z')]
    assert.deepEqual(liveItems(items).map((i) => i.id), ['a'])
    assert.deepEqual(voidedItems(items).map((i) => i.id), ['b'])
})

test('a voided line is kept, not deleted', () => {
    // The audit report is the point. A deleted row proves nothing happened.
    const items = [line('a', 45, 1, '2026-09-05T18:00:00Z')]
    assert.equal(items.length, 1)
    assert.equal(liveItems(items).length, 0)
})

// --- What the round is worth afterwards --------------------------------------

test('voiding one of five beers drops the round by exactly one beer', () => {
    const before = totalsFrom([line('a', 45, 5)])
    assert.equal(before.total, 225)

    const after = totalsFrom([line('a', 45, 4), line('b', 45, 1, '2026-09-05T18:00:00Z')])
    assert.equal(after.total, 180)
})

test('a round with every line voided is worth nothing', () => {
    const items = [line('a', 45, 5, 'x'), line('b', 60, 1, 'x')]
    assert.equal(totalsFrom(items).total, 0)
    assert.equal(totalsFrom(items).subtotal, 0)
})

test('an untouched round keeps its total', () => {
    assert.equal(totalsFrom([line('a', 45, 5), line('b', 60, 2)]).total, 345)
})

test('totals of an empty round are zero, not NaN', () => {
    assert.deepEqual(totalsFrom([]), { subtotal: 0, tax: 0, total: 0 })
})

test('the total is the sum of surviving lines, priced from the line itself', () => {
    // Price is snapshotted on the line, so re-pricing the menu tomorrow cannot
    // change what a voided round was worth tonight.
    const items = [line('a', 45, 2), line('b', 1000, 1, 'x')]
    assert.equal(totalsFrom(items).total, 90)
})

test('allVoided is true only when nothing survives', () => {
    assert.equal(allVoided([line('a', 45, 1, 'x')]), true)
    assert.equal(allVoided([line('a', 45, 1, 'x'), line('b', 45, 1)]), false)
    assert.equal(allVoided([]), false)
})

// --- What may be voided at all -----------------------------------------------

test('a submitted round can be voided', () => {
    assert.deepEqual(canVoid({ status: 'SENT', shiftId: 's1' }, 's1'), { ok: true })
})

test('a settled round cannot be voided - that is a refund', () => {
    // A COMPLETED order has reached the drawer. Striking a line out of it would
    // change takings that a Z-report has already counted.
    const check = canVoid({ status: 'COMPLETED', shiftId: 's1' }, 's1')
    assert.equal(check.ok, false)
})

test('a round from a previous shift cannot be voided', () => {
    // Same rule the counter already enforces: a closed Z-report must not move.
    const check = canVoid({ status: 'SENT', shiftId: 'yesterday' }, 'today')
    assert.equal(check.ok, false)
})

test('an already cancelled round cannot be voided twice', () => {
    assert.equal(canVoid({ status: 'CANCELLED', shiftId: 's1' }, 's1').ok, false)
})

test('a round with no shift is voidable within the open shift', () => {
    // Orders keyed before a shift was opened still belong to whoever is on now.
    assert.deepEqual(canVoid({ status: 'SENT', shiftId: null }, 's1'), { ok: true })
})
