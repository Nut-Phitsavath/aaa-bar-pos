/**
 * The login cookie, and the door in front of the API.
 *
 * pos_session used to be plain JSON naming a user id, and the server took it
 * at its word - while /api/auth/users handed every id, the owner's included, to
 * anyone who asked. So a session is now a payload plus an HMAC-SHA256 of it
 * under a secret only this server holds (SESSION_SECRET in .env): a cookie
 * nobody but this server could have written. It carries the user's id and role
 * and expires after 24 hours, the cookie's own lifetime.
 *
 * The proxy uses it for the quick check - is there a session at all, and may
 * that role open this page - and turns away any API call without one. Who the
 * user really is, and whether they are still active, is still read from the
 * database by lib/auth.ts next to the data: the Next.js guidance is that a
 * proxy check is optimistic, never the whole of authorisation.
 *
 * node:crypto, not Web Crypto: the proxy runs on Node.js in Next.js 16.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

export const SESSION_COOKIE = 'pos_session'
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000

export type SessionClaims = { id: string; role: string; exp: number }

/** The server's secret, or null when it is missing or too short to be one. */
export function sessionSecret(): string | null {
    return validSecret(process.env.SESSION_SECRET)
}

function validSecret(secret: string | null | undefined): string | null {
    return secret && secret.length >= 32 ? secret : null
}

function mac(payload: string, secret: string): Buffer {
    return createHmac('sha256', secret).update(payload).digest()
}

/** The cookie value for a user who has just signed in. */
export function signSession(
    user: { id: string; role: string },
    secret: string | null | undefined,
    now: number = Date.now(),
): string {
    const key = validSecret(secret)
    if (!key) throw new Error('SESSION_SECRET is not set (or is shorter than 32 characters) on this POS')
    const claims: SessionClaims = { id: user.id, role: user.role, exp: now + SESSION_TTL_MS }
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
    return `${payload}.${mac(payload, key).toString('base64url')}`
}

/** The claims in a cookie this server signed and that has not expired, or null. */
export function readSession(
    value: string | null | undefined,
    secret: string | null | undefined,
    now: number = Date.now(),
): SessionClaims | null {
    const key = validSecret(secret)
    if (!key || !value) return null
    const parts = value.split('.')
    if (parts.length !== 2) return null
    const [payload, signature] = parts
    try {
        const given = Buffer.from(signature, 'base64url')
        const expected = mac(payload, key)
        if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
        const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
        if (typeof claims?.id !== 'string' || typeof claims?.role !== 'string' || typeof claims?.exp !== 'number') return null
        if (claims.exp <= now) return null
        return { id: claims.id, role: claims.role, exp: claims.exp }
    } catch {
        return null
    }
}

/**
 * The few API routes that answer someone who has not signed in. Everything
 * else under /api is turned away at the proxy without a session.
 *
 *  - The PIN screen lists who can sign in, signs them in, and signs them out.
 *  - The customer display runs in a browser of its own that never signs in,
 *    and needs the shop's name, logo and settings - and the item pictures.
 *  - BCEL's payment callback carries no cookie; the route proves a payment by
 *    asking BCEL back.
 *
 * Exact paths and methods: a route added later is protected until someone
 * decides otherwise, and /api/settings being readable does not make it
 * writable.
 */
export function isPublicApi(method: string, pathname: string): boolean {
    const m = method.toUpperCase()
    if (m === 'GET' && (pathname === '/api/auth/users' || pathname === '/api/settings')) return true
    if (m === 'POST' && (pathname === '/api/auth/pin-login' || pathname === '/api/auth/logout')) return true
    if (pathname === '/api/webhooks/onepay') return true
    if (m === 'GET' && /^\/api\/uploads\/[^/]+$/.test(pathname) && !pathname.includes('..')) return true
    return false
}
