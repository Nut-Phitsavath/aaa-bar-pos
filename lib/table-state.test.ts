// Run: node --experimental-strip-types --test lib/table-state.test.ts
//
// One resolver decides what a table is doing. The floor plan's card, its
// header counts and its legend all read this, so a disagreement between them
// is a bug here rather than three bugs in three places.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    resolveTableState, isSeatable,
    BILL_OVERDUE_MINUTES, RESERVATION_GRACE_MINUTES,
} from './table-state.ts'

const NOW = new Date('2026-09-19T23:00:00Z')
const minsAgo = (n: number) => new Date(NOW.getTime() - n * 60000)
const minsAhead = (n: number) => new Date(NOW.getTime() + n * 60000)

const sitting = (over = {}) => ({ status: 'OPEN', paid: 0, total: 1000, ...over })

test('an empty table nobody has booked is free', () => {
    const s = resolveTableState({ sessions: [] }, NOW)
    assert.equal(s.state, 'FREE')
    assert.equal(s.bills, 0)
    assert.equal(isSeatable(s.state), true)
})

test('a party in the room is occupied', () => {
    const s = resolveTableState({ sessions: [sitting()] }, NOW)
    assert.equal(s.state, 'OCCUPIED')
    assert.equal(isSeatable(s.state), false)
})

test('asking for the bill outranks merely sitting there', () => {
    const s = resolveTableState({
        sessions: [sitting(), sitting({ status: 'BILL_REQUESTED' })],
    }, NOW)
    assert.equal(s.state, 'BILL_REQUESTED')
})

// --- DIRTY ------------------------------------------------------------------

test('a settled table is dirty, not free, until somebody clears it', () => {
    // The gap this closes: a host could seat a party onto glasses nobody had
    // collected, because the floor plan called the table free the moment its
    // bill closed.
    const s = resolveTableState({ needsClearing: true, sessions: [] }, NOW)
    assert.equal(s.state, 'DIRTY')
    assert.equal(isSeatable(s.state), false)
})

test('a party sitting down outranks the mess they are sitting in', () => {
    // Staff seated them anyway. The floor plan follows the room, not the flag.
    const s = resolveTableState({ needsClearing: true, sessions: [sitting()] }, NOW)
    assert.equal(s.state, 'OCCUPIED')
})

// --- RESERVED ---------------------------------------------------------------

test('a booked table reads as reserved, with who and when', () => {
    const at = minsAhead(60)
    const s = resolveTableState({ reservedFor: 'Somchai', reservedAt: at, sessions: [] }, NOW)
    assert.equal(s.state, 'RESERVED')
    assert.deepEqual(s.reservation, { for: 'Somchai', at })
    assert.equal(isSeatable(s.state), false)
})

test('dirty beats reserved: it cannot take the booking until it is cleared', () => {
    const s = resolveTableState({
        needsClearing: true, reservedFor: 'Somchai', reservedAt: minsAhead(30), sessions: [],
    }, NOW)
    assert.equal(s.state, 'DIRTY')
    // ...but the booking is still reported, because whoever clears it needs to
    // know somebody is coming.
    assert.equal(s.reservation?.for, 'Somchai')
})

test('a late party keeps their table for a grace period', () => {
    const late = resolveTableState({
        reservedFor: 'Somchai', reservedAt: minsAgo(RESERVATION_GRACE_MINUTES - 1), sessions: [],
    }, NOW)
    assert.equal(late.state, 'RESERVED')
})

test('a booking nobody cancelled stops holding the table forever', () => {
    // Otherwise the reservation flag becomes wallpaper and staff learn to seat
    // over it, which defeats the whole point of having one.
    const stale = resolveTableState({
        reservedFor: 'Somchai', reservedAt: minsAgo(RESERVATION_GRACE_MINUTES + 1), sessions: [],
    }, NOW)
    assert.equal(stale.state, 'FREE')
    assert.equal(stale.reservation, null)
})

test('a name with no time, or a time with no name, books nothing', () => {
    assert.equal(resolveTableState({ reservedFor: 'Somchai', sessions: [] }, NOW).state, 'FREE')
    assert.equal(resolveTableState({ reservedAt: minsAhead(30), sessions: [] }, NOW).state, 'FREE')
})

// --- PART PAID --------------------------------------------------------------

test('money taken with something still owed reads as part paid', () => {
    const s = resolveTableState({ sessions: [sitting({ paid: 3000, total: 3500 })] }, NOW)
    assert.equal(s.partPaid, true)
    // Still occupied - part paid is a fact about the bill, not a state.
    assert.equal(s.state, 'OCCUPIED')
})

test('nothing paid, and fully paid, are both not part paid', () => {
    assert.equal(resolveTableState({ sessions: [sitting({ paid: 0, total: 3500 })] }, NOW).partPaid, false)
    assert.equal(resolveTableState({ sessions: [sitting({ paid: 3500, total: 3500 })] }, NOW).partPaid, false)
})

test('on a split table one half paying still counts', () => {
    // The other half is what is left to collect, which is worth seeing.
    const s = resolveTableState({
        sessions: [sitting({ paid: 500, total: 1000 }), sitting({ paid: 0, total: 800 })],
    }, NOW)
    assert.equal(s.partPaid, true)
    assert.equal(s.bills, 2)
})

// --- WAITING ----------------------------------------------------------------

test('a bill just asked for is waiting but not overdue', () => {
    const s = resolveTableState({
        sessions: [sitting({ status: 'BILL_REQUESTED', billRequestedAt: minsAgo(2) })],
    }, NOW)
    assert.equal(s.waitingMinutes, 2)
    assert.equal(s.overdue, false)
})

test('past the threshold it is overdue - nobody went', () => {
    const s = resolveTableState({
        sessions: [sitting({ status: 'BILL_REQUESTED', billRequestedAt: minsAgo(BILL_OVERDUE_MINUTES) })],
    }, NOW)
    assert.equal(s.overdue, true)
})

test('two bills waiting report the longer wait', () => {
    // The older one is the one somebody has been ignoring.
    const s = resolveTableState({
        sessions: [
            sitting({ status: 'BILL_REQUESTED', billRequestedAt: minsAgo(3) }),
            sitting({ status: 'BILL_REQUESTED', billRequestedAt: minsAgo(18) }),
        ],
    }, NOW)
    assert.equal(s.waitingMinutes, 18)
    assert.equal(s.overdue, true)
})

test('a bill asked for before this column existed does not read as waiting', () => {
    // billRequestedAt is null on every session that predates the migration.
    const s = resolveTableState({
        sessions: [sitting({ status: 'BILL_REQUESTED', billRequestedAt: null })],
    }, NOW)
    assert.equal(s.state, 'BILL_REQUESTED')
    assert.equal(s.waitingMinutes, null)
    assert.equal(s.overdue, false)
})

test('clock skew between two tablets cannot produce a negative wait', () => {
    const s = resolveTableState({
        sessions: [sitting({ status: 'BILL_REQUESTED', billRequestedAt: minsAhead(3) })],
    }, NOW)
    assert.equal(s.waitingMinutes, 0)
})

test('ISO strings work, because that is what the API sends', () => {
    const s = resolveTableState({
        reservedFor: 'Somchai',
        reservedAt: minsAhead(30).toISOString(),
        sessions: [],
    }, NOW)
    assert.equal(s.state, 'RESERVED')
})

test('a malformed date is ignored rather than throwing on the floor plan', () => {
    const s = resolveTableState({
        reservedFor: 'Somchai', reservedAt: 'not a date', sessions: [],
    }, NOW)
    assert.equal(s.state, 'FREE')
})
