// Run: node --experimental-strip-types --test lib/reporting.test.ts
//
// The drift these guard against is not hypothetical. Every case below is a
// figure that was actually wrong on the reports page before 2026-09-16.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { periodDiscounts, netRevenue, COUNTED_ORDER, COUNTED_LINE } from './reporting.ts'

const order = (total: number, status = 'COMPLETED') => ({ status, total })

test('a period with no discounted bills gives back nothing', () => {
    assert.equal(periodDiscounts([]), 0)
})

test('a percent discount is priced off the bill, round-up included', () => {
    // 1,000 less 10% is 900 exactly, so nothing to round.
    assert.equal(
        periodDiscounts([{ discountType: 'PERCENT', discountValue: 10, orders: [order(1000)] }]),
        100
    )
    // 999 less 10% is 899.1, which the customer pays as 900 - so the bar gave
    // away 99, not 99.9. The round-up is the house's, and the discount figure
    // has to agree with the bill the customer was handed.
    assert.equal(
        periodDiscounts([{ discountType: 'PERCENT', discountValue: 10, orders: [order(999)] }]),
        99
    )
})

test('a fixed discount comes straight off', () => {
    assert.equal(
        periodDiscounts([{ discountType: 'FIXED', discountValue: 250, orders: [order(1000)] }]),
        250
    )
})

test('a discount bigger than the bill makes it free, never negative', () => {
    assert.equal(
        periodDiscounts([{ discountType: 'FIXED', discountValue: 5000, orders: [order(1000)] }]),
        1000
    )
})

test('an undiscounted session contributes nothing', () => {
    assert.equal(
        periodDiscounts([{ discountType: null, discountValue: null, orders: [order(1000)] }]),
        0
    )
})

test('discounts sum across bills', () => {
    const total = periodDiscounts([
        { discountType: 'PERCENT', discountValue: 10, orders: [order(1000)] },
        { discountType: 'FIXED', discountValue: 50, orders: [order(400)] },
    ])
    assert.equal(total, 150)
})

test('a session is priced over the orders it is given, not everything on the table', () => {
    // The caller filters to COUNTED_ORDER. A round left SENT is not passed in,
    // and must not widen the base the discount comes off - that mismatch is
    // exactly what put the reports page and its own cross-check ฿297 apart.
    const counted = periodDiscounts([
        { discountType: 'PERCENT', discountValue: 10, orders: [order(1000)] },
    ])
    const ifSentLeaked = periodDiscounts([
        { discountType: 'PERCENT', discountValue: 10, orders: [order(1000), order(500, 'SENT')] },
    ])
    assert.equal(counted, 100)
    assert.equal(ifSentLeaked, 150)
    assert.notEqual(counted, ifSentLeaked)
})

test('net revenue is gross less what was given away', () => {
    assert.equal(netRevenue(642365, 8041), 634324)
})

test('the shared filters say what six routes used to each decide alone', () => {
    // Pinned so a route cannot widen them by editing its own copy: a HOLD or
    // CANCELLED order is not revenue, a comped order stays out, and a struck
    // line is not a sale.
    assert.deepEqual(COUNTED_ORDER, { status: 'COMPLETED', isReportable: true })
    assert.deepEqual(COUNTED_LINE, { voidedAt: null })
})
