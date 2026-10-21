// Run: node --experimental-strip-types --test lib/session.test.ts
//
// The login cookie and the door in front of the API. The cookie used to be
// plain JSON naming a user id, which the server took at its word - and
// /api/auth/users handed every id out to anyone who asked. These pin down that
// only a cookie this server signed is a session, and which few API routes may
// answer someone who has not signed in.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { signSession, readSession, isPublicApi, SESSION_TTL_MS } from './session.ts'

const SECRET = 'a'.repeat(64)
const OWNER = { id: 'u-owner', role: 'ADMIN' }
const NOW = Date.UTC(2026, 9, 21, 20, 0, 0)

// --- The cookie --------------------------------------------------------------

test('a cookie this server signed reads back as the same user and role', () => {
    const cookie = signSession(OWNER, SECRET, NOW)
    assert.deepEqual(readSession(cookie, SECRET, NOW + 1000), { id: 'u-owner', role: 'ADMIN', exp: NOW + SESSION_TTL_MS })
})

test('the old unsigned JSON cookie is not a session', () => {
    // Exactly what pin-login used to set, and what anyone could write by hand.
    assert.equal(readSession(JSON.stringify({ id: 'u-owner', role: 'ADMIN' }), SECRET, NOW), null)
})

test('editing the cookie breaks it', () => {
    const cookie = signSession({ id: 'u-staff', role: 'STAFF' }, SECRET, NOW)
    const [, sig] = cookie.split('.')
    const promoted = Buffer.from(JSON.stringify({ id: 'u-staff', role: 'ADMIN', exp: NOW + SESSION_TTL_MS })).toString('base64url')
    assert.equal(readSession(`${promoted}.${sig}`, SECRET, NOW), null)
})

test('a cookie signed with another secret is not a session here', () => {
    assert.equal(readSession(signSession(OWNER, 'b'.repeat(64), NOW), SECRET, NOW), null)
})

test('a session ends after its 24 hours', () => {
    const cookie = signSession(OWNER, SECRET, NOW)
    assert.ok(readSession(cookie, SECRET, NOW + SESSION_TTL_MS - 1))
    assert.equal(readSession(cookie, SECRET, NOW + SESSION_TTL_MS + 1), null)
})

test('with no secret configured, nothing is a session and nothing can be signed', () => {
    assert.equal(readSession(signSession(OWNER, SECRET, NOW), null, NOW), null)
    assert.throws(() => signSession(OWNER, null, NOW), /SESSION_SECRET/)
    // Too short to be a real secret counts as none.
    assert.throws(() => signSession(OWNER, 'short', NOW), /SESSION_SECRET/)
})

test('garbage is not a session, and does not throw', () => {
    for (const junk of [undefined, '', '.', 'abc', 'a.b.c', '%%%.%%%', signSession(OWNER, SECRET, NOW) + 'x']) {
        assert.equal(readSession(junk, SECRET, NOW), null, String(junk))
    }
})

// --- Who may use the API without signing in ----------------------------------

test('the PIN screen can list staff and sign someone in before anyone is signed in', () => {
    assert.equal(isPublicApi('GET', '/api/auth/users'), true)
    assert.equal(isPublicApi('POST', '/api/auth/pin-login'), true)
    assert.equal(isPublicApi('POST', '/api/auth/logout'), true)
})

test('the customer screen, pictures and the bank callback work without a sign-in', () => {
    // The customer display runs in its own browser that never signs in.
    assert.equal(isPublicApi('GET', '/api/settings'), true)
    assert.equal(isPublicApi('GET', '/api/uploads/beer.jpg'), true)
    // BCEL calls this; it proves itself by asking BCEL back, not by a cookie.
    assert.equal(isPublicApi('POST', '/api/webhooks/onepay'), true)
})

test('everything else needs a sign-in - including writes to the open-looking routes', () => {
    assert.equal(isPublicApi('POST', '/api/settings'), false)
    assert.equal(isPublicApi('POST', '/api/menu'), false)
    assert.equal(isPublicApi('PUT', '/api/menu/abc'), false)
    assert.equal(isPublicApi('GET', '/api/orders'), false)
    assert.equal(isPublicApi('GET', '/api/customers'), false)
    assert.equal(isPublicApi('POST', '/api/upload'), false)
    assert.equal(isPublicApi('DELETE', '/api/uploads/beer.jpg'), false)
    assert.equal(isPublicApi('POST', '/api/admin/wipe'), false)
    // No prefix tricks.
    assert.equal(isPublicApi('GET', '/api/settings-export'), false)
    assert.equal(isPublicApi('GET', '/api/auth/users/extra'), false)
    assert.equal(isPublicApi('GET', '/api/uploads/../orders'), false)
})
