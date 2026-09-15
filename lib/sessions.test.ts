// Run: node --experimental-strip-types --test lib/sessions.test.ts
//
// Bill math and lifecycle rules for open table sessions. These cover the cases
// where the floor plan would show one number and the printed bill another.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sessionTotal, formatDuration, canCloseSession } from './sessions.ts'

test('sessionTotal sums sent and completed orders', () => {
    const orders = [
        { status: 'SENT', total: 120000 },
        { status: 'SENT', total: 80000 },
    ]
    assert.equal(sessionTotal(orders), 200000)
})

test('sessionTotal ignores cancelled orders', () => {
    const orders = [
        { status: 'SENT', total: 120000 },
        { status: 'CANCELLED', total: 500000 },
    ]
    assert.equal(sessionTotal(orders), 120000)
})

test('sessionTotal ignores held orders', () => {
    // A HOLD order is the beeper flow, not part of a table bill.
    const orders = [
        { status: 'SENT', total: 120000 },
        { status: 'HOLD', total: 90000 },
    ]
    assert.equal(sessionTotal(orders), 120000)
})

test('sessionTotal of an empty session is zero', () => {
    assert.equal(sessionTotal([]), 0)
})

// A table card is read at a glance from across a room, so the figure has to mean
// one thing at every duration. h:mm printed a one-minute-old table as "0:01",
// which reads as one second to anyone who has ever seen a stopwatch - and every
// table spends its first hour in exactly that range.

test('formatDuration renders under an hour as plain minutes', () => {
    const opened = new Date('2026-09-02T21:14:00Z')
    const now = new Date('2026-09-02T21:48:00Z')
    assert.equal(formatDuration(opened, now), '34m')
})

test('formatDuration renders a fresh table as minutes, never as 0:01', () => {
    const opened = new Date('2026-09-02T21:14:00Z')
    const now = new Date('2026-09-02T21:15:00Z')
    assert.equal(formatDuration(opened, now), '1m')
})

test('formatDuration renders an hour or more as hours and padded minutes', () => {
    const opened = new Date('2026-09-02T21:14:00Z')
    const now = new Date('2026-09-02T23:19:00Z')
    assert.equal(formatDuration(opened, now), '2h 05m')
})

test('formatDuration pads the minutes on a whole hour', () => {
    const opened = new Date('2026-09-02T21:14:00Z')
    const now = new Date('2026-09-02T22:14:00Z')
    assert.equal(formatDuration(opened, now), '1h 00m')
})

test('formatDuration accepts an ISO string, as the API returns', () => {
    assert.equal(formatDuration('2026-09-02T21:14:00.000Z', new Date('2026-09-02T21:48:00Z')), '34m')
})

test('formatDuration clamps a backwards clock to zero', () => {
    // Three devices, three system clocks. A tablet running a minute fast must
    // not render "-1m" on every card.
    const opened = new Date('2026-09-02T21:14:00Z')
    const now = new Date('2026-09-02T21:13:00Z')
    assert.equal(formatDuration(opened, now), '0m')
})

test('canCloseSession allows an open session with orders', () => {
    const check = canCloseSession({ status: 'OPEN' }, [{ status: 'SENT', total: 120000 }])
    assert.deepEqual(check, { ok: true })
})

test('canCloseSession allows an empty session', () => {
    // A table opened by mistake must be closeable, not stuck occupied all night.
    const check = canCloseSession({ status: 'OPEN' }, [])
    assert.deepEqual(check, { ok: true })
})

test('canCloseSession allows closing from BILL_REQUESTED', () => {
    const check = canCloseSession({ status: 'BILL_REQUESTED' }, [{ status: 'SENT', total: 1000 }])
    assert.deepEqual(check, { ok: true })
})

test('canCloseSession refuses an already closed session', () => {
    const check = canCloseSession({ status: 'CLOSED' }, [])
    assert.equal(check.ok, false)
})

test('canCloseSession refuses a session holding a HOLD order', () => {
    const check = canCloseSession({ status: 'OPEN' }, [
        { status: 'SENT', total: 1000 },
        { status: 'HOLD', total: 2000 },
    ])
    assert.equal(check.ok, false)
})
