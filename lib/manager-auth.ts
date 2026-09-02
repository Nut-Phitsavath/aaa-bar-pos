import { prisma } from './prisma'
import bcrypt from 'bcryptjs'

export const MANAGER_ROLES = ['ADMIN', 'MANAGER']

/**
 * Failed-attempt throttle for manager approvals.
 *
 * A 4-digit PIN is ~10,000 guesses, and this endpoint authorises giving money
 * away, so it cannot be an unlimited oracle. In memory and per process, which
 * is enough: the bar runs one Node server, and a restart clearing the counter
 * costs an attacker more than it costs us to keep it simple.
 *
 * ponytail: in-memory counter, single server. Move to the DB if this ever runs
 * behind more than one process.
 */
const attempts = new Map<string, { count: number; until: number }>()
const MAX_ATTEMPTS = 5
const LOCKOUT_MS = 60_000

export function throttleState(username: string): { locked: boolean; retryInMs: number } {
    const rec = attempts.get(username)
    if (!rec) return { locked: false, retryInMs: 0 }
    if (Date.now() > rec.until) {
        attempts.delete(username)
        return { locked: false, retryInMs: 0 }
    }
    return { locked: rec.count >= MAX_ATTEMPTS, retryInMs: Math.max(0, rec.until - Date.now()) }
}

function recordFailure(username: string) {
    const rec = attempts.get(username)
    const count = (rec && Date.now() <= rec.until ? rec.count : 0) + 1
    attempts.set(username, { count, until: Date.now() + LOCKOUT_MS })
}

function clearFailures(username: string) {
    attempts.delete(username)
}

export type ApprovalResult =
    | { ok: true; manager: { id: string; name: string } }
    | { ok: false; reason: string; retryInMs?: number }

/**
 * Verify a manager's PIN for a single privileged action.
 *
 * Takes a username as well as a PIN, matching the existing login: a PIN alone
 * would be a far smaller search space, and staff already know each other's
 * names, so requiring the name costs nothing and removes the anonymous guess.
 */
export async function verifyManager(username: string, pin: string): Promise<ApprovalResult> {
    if (!username || !pin) return { ok: false, reason: 'MISSING_CREDENTIALS' }

    const throttle = throttleState(username)
    if (throttle.locked) {
        return { ok: false, reason: 'TOO_MANY_ATTEMPTS', retryInMs: throttle.retryInMs }
    }

    const user = await prisma.user.findUnique({ where: { username } })

    // One generic failure for "no such user", "not a manager" and "wrong PIN".
    // Distinguishing them would let anyone enumerate who can authorise a comp.
    if (!user || !user.isActive || !MANAGER_ROLES.includes(user.role)) {
        recordFailure(username)
        return { ok: false, reason: 'INVALID_APPROVAL' }
    }

    const match = await bcrypt.compare(pin, user.pin)
    if (!match) {
        recordFailure(username)
        return { ok: false, reason: 'INVALID_APPROVAL' }
    }

    clearFailures(username)
    return { ok: true, manager: { id: user.id, name: user.name } }
}
