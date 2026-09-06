// Run: node --experimental-strip-types --test lib/cookie-scope.test.ts
//
// The rule that decides whether a till can log in at all. Getting it wrong in
// either direction is bad: too strict and the satellite devices silently fail,
// too loose and a tunnelled deployment sends its session over plain HTTP.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cookieSecure } from './cookie-scope.ts'

const req = (url: string, headers: Record<string, string> = {}) =>
    new Request(url, { headers })

test('a till on the bar network gets a cookie it can actually keep', () => {
    // The bug this replaces: these were Secure in production, so the browser
    // dropped them and the device bounced back to the PIN screen.
    assert.equal(cookieSecure(req('http://172.20.10.2:3000/api/auth/pin-login')), false)
    assert.equal(cookieSecure(req('http://192.168.1.50:3000/api/auth/pin-login')), false)
    assert.equal(cookieSecure(req('http://localhost:3000/api/auth/pin-login')), false)
})

test('HTTPS still gets Secure', () => {
    assert.equal(cookieSecure(req('https://monitor.sattavath.store/api/auth/pin-login')), true)
})

test('a tunnel is believed over the socket it arrived on', () => {
    // cloudflared connects to 127.0.0.1 over http, so the request URL alone
    // would downgrade a session the browser is holding over HTTPS.
    assert.equal(
        cookieSecure(req('http://127.0.0.1:3000/api/auth/pin-login', { 'x-forwarded-proto': 'https' })),
        true,
    )
    // Proxies append rather than replace: the client's own value leads.
    assert.equal(
        cookieSecure(req('http://127.0.0.1:3000/api/auth/pin-login', { 'x-forwarded-proto': 'https, http' })),
        true,
    )
    assert.equal(
        cookieSecure(req('http://127.0.0.1:3000/api/auth/pin-login', { 'x-forwarded-proto': 'http' })),
        false,
    )
})
