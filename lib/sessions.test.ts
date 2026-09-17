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

// ---------------------------------------------------------------------------
// sessionBillTotal: the one place a bill is priced.
//
// Eighteen call sites used to spell this out by hand. The cases below pin the
// thing that made consolidating it necessary - the order a promotion and a
// manual discount come off in, which decides what the customer pays.
// ---------------------------------------------------------------------------

import { sessionBillTotal, sessionSavings, canRepricePromo } from './sessions.ts'

const round = (total: number, status = 'COMPLETED') => ({ status, total })

test('a plain bill is just its rounds', () => {
    assert.equal(sessionBillTotal({ orders: [round(600), round(400)], promoDiscount: null }), 1000)
})

test('a promotion comes off before the manual discount, not after', () => {
    // 1,000 gross, a 200 promo, then 10% off the table.
    // Right:  (1000 - 200) = 800, less 10% = 720.
    // Wrong:  1000 less 10% = 900, less 200 = 700 - the same 200 discounted
    //         twice, and 20 baht the bar never agreed to give away.
    const total = sessionBillTotal({
        orders: [round(1000)],
        promoDiscount: 200,
        discountType: 'PERCENT',
        discountValue: 10,
    })
    assert.equal(total, 720)
})

test('the round-up still happens once, at the end', () => {
    // 999 less a 100 promo is 899; 10% off that is 809.1, charged as 810.
    const total = sessionBillTotal({
        orders: [round(999)],
        promoDiscount: 100,
        discountType: 'PERCENT',
        discountValue: 10,
    })
    assert.equal(total, 810)
})

test('a promo bigger than the bill makes it free, never negative', () => {
    assert.equal(sessionBillTotal({ orders: [round(500)], promoDiscount: 9999 }), 0)
})

test('a held round is not on the bill yet', () => {
    assert.equal(sessionBillTotal({ orders: [round(600), round(400, 'HOLD')], promoDiscount: null }), 600)
})

test('savings is everything that came off the gross', () => {
    const session = {
        orders: [round(1000)],
        promoDiscount: 200,
        discountType: 'PERCENT' as const,
        discountValue: 10,
    }
    assert.equal(sessionSavings(session), 280)
})

test('a session with no promo prices exactly as it did before', () => {
    const before = { orders: [round(2499.5)], discountType: 'PERCENT', discountValue: 0, promoDiscount: null }
    assert.equal(sessionBillTotal(before), 2500)
})

test('an open bill prices its deal live', () => {
    assert.equal(canRepricePromo({ status: 'OPEN' }), true)
    assert.equal(canRepricePromo({ status: 'OPEN', reopenedAt: null }), true)
})

test('a bill waiting for its bill is still open', () => {
    // BILL_REQUESTED occupies the table and can still take another round.
    assert.equal(canRepricePromo({ status: 'BILL_REQUESTED' }), true)
})

test('a closed bill is priced at what the customer was charged', () => {
    assert.equal(canRepricePromo({ status: 'CLOSED' }), false)
})

test('a reopened bill stays frozen, even though its status says OPEN', () => {
    // The trap. Status alone would call this live.
    assert.equal(canRepricePromo({ status: 'OPEN', reopenedAt: new Date() }), false)
})

test('a reopened bill is frozen whether the stamp is a Date or a string', () => {
    // It arrives as a string over JSON and as a Date from Prisma.
    assert.equal(canRepricePromo({ status: 'OPEN', reopenedAt: '2026-09-16T23:00:00Z' }), false)
})

test('a reopened bill that was closed again is doubly frozen', () => {
    assert.equal(canRepricePromo({ status: 'CLOSED', reopenedAt: new Date() }), false)
})
