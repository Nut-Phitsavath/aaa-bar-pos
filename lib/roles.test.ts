// Run: node --experimental-strip-types --test lib/roles.test.ts
//
// The rule worth testing here is the one that is invisible until it is abused:
// a manager who can edit any role can promote themselves, or promote a friend,
// and the owner finds out afterwards.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canManageUser, canManageStaff, isTillRole, isRole, usernameFrom } from './roles.ts'

test('an admin may manage every role', () => {
    for (const role of ['ADMIN', 'MANAGER', 'STAFF', 'WAITER']) {
        assert.equal(canManageUser('ADMIN', role), true, role)
    }
})

test('a manager may manage staff and servers, and nobody above them', () => {
    assert.equal(canManageUser('MANAGER', 'STAFF'), true)
    assert.equal(canManageUser('MANAGER', 'WAITER'), true)
    // The whole point: no self-promotion, and no minting an owner.
    assert.equal(canManageUser('MANAGER', 'MANAGER'), false)
    assert.equal(canManageUser('MANAGER', 'ADMIN'), false)
})

test('everyone else may manage nobody', () => {
    for (const actor of ['STAFF', 'WAITER', undefined, null, '', 'admin']) {
        assert.equal(canManageUser(actor as string, 'WAITER'), false, String(actor))
    }
})

test('an unknown target role is never manageable', () => {
    // A role that fell out of a typo must not be created by an admin either.
    assert.equal(canManageUser('ADMIN', 'OWNER'), false)
    assert.equal(canManageUser('ADMIN', ''), false)
})

test('the staff screen opens for managers and admins only', () => {
    assert.equal(canManageStaff('ADMIN'), true)
    assert.equal(canManageStaff('MANAGER'), true)
    assert.equal(canManageStaff('STAFF'), false)
    assert.equal(canManageStaff('WAITER'), false)
    assert.equal(canManageStaff(null), false)
})

test('a server is not a till role, so never needs a credential', () => {
    assert.equal(isTillRole('ADMIN'), true)
    assert.equal(isTillRole('MANAGER'), true)
    assert.equal(isTillRole('STAFF'), true)
    assert.equal(isTillRole('WAITER'), false)
})

test('isRole rejects anything not in the list', () => {
    assert.equal(isRole('ADMIN'), true)
    assert.equal(isRole('admin'), false)
    assert.equal(isRole(undefined), false)
})

test('a username can be derived from any name', () => {
    assert.equal(usernameFrom('Nok'), 'nok')
    assert.equal(usernameFrom('Mai Souk'), 'maisouk')
    // A fully Lao name leaves nothing typeable behind, so it gets a handle.
    assert.equal(usernameFrom('ນົກ'), 'server')
    assert.equal(usernameFrom(''), 'server')
})
