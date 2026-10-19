// Run: node --experimental-strip-types --test lib/duplicates.test.ts
//
// The case the requirement names: two waiters keying the same drinks onto one
// table within a minute of each other. A warning has to fire on that and stay
// quiet on a table that is simply drinking, or staff will click through it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recentDuplicates, type SentRound } from './duplicates.ts'

const NOW = new Date('2026-09-19T22:30:00Z')
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000)

const ROUND = (minutes: number, items: SentRound['items'], waiter = 'Kham'): SentRound => ({
    createdAt: ago(minutes),
    waiter: { name: waiter },
    items,
})

test('the same drink keyed twice inside the window warns', () => {
    const warnings = recentDuplicates(
        [{ menuId: 'beerlao', name: 'Beer Lao', quantity: 2 }],
        [ROUND(0.3, [{ menuId: 'beerlao', name: 'Beer Lao', quantity: 2 }])],
        NOW,
    )
    assert.equal(warnings.length, 1)
    assert.equal(warnings[0].waiter, 'Kham')
    assert.equal(warnings[0].quantity, 2)
    assert.equal(warnings[0].minutesAgo, 0)
})

test('the same drink an hour later is a thirsty table, not a duplicate', () => {
    assert.deepEqual(
        recentDuplicates(
            [{ menuId: 'beerlao', name: 'Beer Lao', quantity: 2 }],
            [ROUND(60, [{ menuId: 'beerlao', name: 'Beer Lao', quantity: 2 }])],
            NOW,
        ),
        [],
    )
})

test('a different drink does not warn', () => {
    assert.deepEqual(
        recentDuplicates(
            [{ menuId: 'heineken', name: 'Heineken', quantity: 1 }],
            [ROUND(1, [{ menuId: 'beerlao', name: 'Beer Lao', quantity: 2 }])],
            NOW,
        ),
        [],
    )
})

test('a duplicate already struck does not warn again', () => {
    // Warning about the void that fixed it is how a dialog becomes furniture.
    assert.deepEqual(
        recentDuplicates(
            [{ menuId: 'beerlao', name: 'Beer Lao', quantity: 2 }],
            [ROUND(1, [{ menuId: 'beerlao', name: 'Beer Lao', quantity: 2, voidedAt: ago(0.5) }])],
            NOW,
        ),
        [],
    )
})

test('a cancelled round does not warn', () => {
    const round = ROUND(1, [{ menuId: 'beerlao', name: 'Beer Lao', quantity: 2 }])
    assert.deepEqual(
        recentDuplicates([{ menuId: 'beerlao', name: 'Beer Lao', quantity: 2 }], [{ ...round, status: 'CANCELLED' }], NOW),
        [],
    )
})

test('the warning names which server keyed it and how long ago', () => {
    const warnings = recentDuplicates(
        [{ menuId: 'beerlao', name: 'Beer Lao', quantity: 2 }],
        [ROUND(3, [{ menuId: 'beerlao', name: 'Beer Lao', quantity: 2 }], 'Nok')],
        NOW,
    )
    assert.deepEqual(warnings, [{ name: 'Beer Lao', quantity: 2, waiter: 'Nok', minutesAgo: 3 }])
})

test('two tills with skewed clocks still warn', () => {
    // A round stamped a few seconds in the future is clock skew between two
    // devices, not an order from tomorrow.
    const warnings = recentDuplicates(
        [{ menuId: 'beerlao', name: 'Beer Lao', quantity: 2 }],
        [ROUND(-0.2, [{ menuId: 'beerlao', name: 'Beer Lao', quantity: 2 }])],
        NOW,
    )
    assert.equal(warnings.length, 1)
    assert.equal(warnings[0].minutesAgo, 0)
})

test('a cart line with no menu id cannot match anything', () => {
    assert.deepEqual(
        recentDuplicates(
            [{ name: 'Exchange difference', quantity: 1 }],
            [ROUND(1, [{ menuId: 'beerlao', name: 'Beer Lao', quantity: 2 }])],
            NOW,
        ),
        [],
    )
})
