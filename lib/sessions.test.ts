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

test('formatDuration renders hours and padded minutes', () => {
    const opened = new Date('2026-09-02T21:14:00Z')
    const now = new Date('2026-09-02T23:19:00Z')
    assert.equal(formatDuration(opened, now), '2:05')
})

test('formatDuration renders under an hour as 0:mm', () => {
    const opened = new Date('2026-09-02T21:14:00Z')
    const now = new Date('2026-09-02T21:48:00Z')
    assert.equal(formatDuration(opened, now), '0:34')
})

test('formatDuration accepts an ISO string, as the API returns', () => {
    assert.equal(formatDuration('2026-09-02T21:14:00.000Z', new Date('2026-09-02T21:48:00Z')), '0:34')
})

test('formatDuration clamps a backwards clock to zero', () => {
    // Three devices, three system clocks. A tablet running a minute fast must
    // not render "-0:01" on every card.
    const opened = new Date('2026-09-02T21:14:00Z')
    const now = new Date('2026-09-02T21:13:00Z')
    assert.equal(formatDuration(opened, now), '0:00')
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
