// Run: node --experimental-strip-types --test lib/ingredient-form.test.ts
//
// Changing a multiplier after stock has moved silently rewrites history: every
// past deduction was computed with the old number and none of them get
// recalculated. The guard is here rather than only on the form because a form
// is one client and the route is the boundary.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canEditUnits } from './ingredient-form.ts'

test('a brand new ingredient is fully editable by anyone who can reach the form', () => {
    assert.deepEqual(canEditUnits({ hasMovements: false, role: 'STAFF' }), { ok: true })
})

test('once stock has moved, staff can no longer change the conversion', () => {
    assert.deepEqual(
        canEditUnits({ hasMovements: true, role: 'STAFF' }),
        { ok: false, reason: 'UNITS_LOCKED_AFTER_MOVEMENT' },
    )
})

test('a manager may override, because sometimes the first entry was wrong', () => {
    assert.deepEqual(canEditUnits({ hasMovements: true, role: 'MANAGER' }), { ok: true })
    assert.deepEqual(canEditUnits({ hasMovements: true, role: 'ADMIN' }), { ok: true })
})

test('an unknown role is refused rather than assumed harmless', () => {
    assert.deepEqual(
        canEditUnits({ hasMovements: true, role: 'SOMETHING_NEW' }),
        { ok: false, reason: 'UNITS_LOCKED_AFTER_MOVEMENT' },
    )
})

test('a missing role is refused too', () => {
    // An unauthenticated caller must never be the one that slips through.
    assert.deepEqual(
        canEditUnits({ hasMovements: true, role: '' }),
        { ok: false, reason: 'UNITS_LOCKED_AFTER_MOVEMENT' },
    )
})
