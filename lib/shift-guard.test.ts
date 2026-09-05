// Run: node --experimental-strip-types --test lib/shift-guard.test.ts
//
// A shift is the container every sale belongs to. Without one, an order
// completes with shiftId null and a cash payment lands in no drawer count -
// the money is taken, the night is simply not counted. These decide when the
// till refuses rather than quietly carrying on.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { requireOpenShift, canCloseShift, NO_OPEN_SHIFT, TABLES_STILL_OPEN } from './shift-guard.ts'

// --- Nothing trades without a shift ------------------------------------------

test('an open shift lets trading through', () => {
    assert.deepEqual(requireOpenShift({ id: 's1', status: 'OPEN' }), { ok: true })
})

test('no shift at all is refused', () => {
    const check = requireOpenShift(null)
    assert.equal(check.ok, false)
    assert.equal(check.ok === false && check.reason, NO_OPEN_SHIFT)
})

test('a closed shift is refused', () => {
    // Finding the row is not the same as it being open; the query that fetches
    // "the shift" must not be trusted to have filtered.
    assert.equal(requireOpenShift({ id: 's1', status: 'CLOSED' }).ok, false)
})

test('an undefined shift is refused rather than throwing', () => {
    assert.equal(requireOpenShift(undefined).ok, false)
})

// --- The night cannot be closed out from under a live table ------------------

test('a shift with no open tables closes', () => {
    assert.deepEqual(canCloseShift([]), { ok: true })
})

test('a shift with an open table is refused, and says which', () => {
    // SambaPOS refuses the same way: settle the ticket or move it to an
    // account. Being blocked without being told what is blocking you is the
    // complaint its own forums are full of, so the names come back with it.
    const check = canCloseShift([
        { id: 'a', table: 'T4', balance: 1240 },
        { id: 'b', table: 'VIP 2', balance: 2700 },
    ])
    assert.equal(check.ok, false)
    if (check.ok) return
    assert.equal(check.reason, TABLES_STILL_OPEN)
    // Largest balance first, so the list is not in the order they were fetched.
    assert.deepEqual(check.tables.map((t) => t.table), ['VIP 2', 'T4'])
    assert.equal(check.outstanding, 3940)
})

test('a table open with nothing on it still blocks the close', () => {
    // An empty table is a table someone is sitting at. Letting it through would
    // close the night on a customer who has not ordered yet.
    const check = canCloseShift([{ id: 'a', table: 'T1', balance: 0 }])
    assert.equal(check.ok, false)
    assert.equal(check.ok === false && check.outstanding, 0)
})

test('the blocking list is ordered by what is owed, largest first', () => {
    const check = canCloseShift([
        { id: 'a', table: 'O1', balance: 240 },
        { id: 'b', table: 'VIP 2', balance: 2700 },
        { id: 'c', table: 'T4', balance: 1240 },
    ])
    assert.equal(check.ok, false)
    if (check.ok) return
    assert.deepEqual(check.tables.map((t) => t.table), ['VIP 2', 'T4', 'O1'])
})
