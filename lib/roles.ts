/**
 * Who the four roles are, and who may edit whom.
 *
 * All four have existed in the data since the first seed, but the staff screen
 * only ever offered two of them, so the two that matter most on a bar floor
 * could not be created at all: MANAGER signs off voids, comps and discounts,
 * and WAITER is the list the table screen picks a server from.
 */

export const ROLES = ['ADMIN', 'MANAGER', 'STAFF', 'WAITER'] as const
export type Role = (typeof ROLES)[number]

export function isRole(value: unknown): value is Role {
    return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
}

/**
 * Roles that sign in at a till, and therefore need a username and a PIN.
 *
 * A WAITER is deliberately not one of them: they are recorded as the server on
 * a round, never authenticated, so they have no credential to hand around or
 * leave written on the bar. Their PIN is a random hash nobody knows.
 */
export const TILL_ROLES: readonly Role[] = ['ADMIN', 'MANAGER', 'STAFF']

export function isTillRole(role: string): boolean {
    return (TILL_ROLES as readonly string[]).includes(role)
}

/** Who may open the staff screen or the floor plan editor at all. */
export function canManageStaff(actorRole: string | undefined | null): boolean {
    return actorRole === 'ADMIN' || actorRole === 'MANAGER'
}

export const canManageTables = canManageStaff

/**
 * Whether `actor` may create, edit or deactivate someone of role `target`.
 *
 * A manager may not touch an admin or another manager. Without that rule the
 * answer "managers can manage staff" quietly means "a manager can mint an
 * admin", and one promoted server owns the whole till by tomorrow.
 */
export function canManageUser(actorRole: string | undefined | null, targetRole: string): boolean {
    if (!isRole(targetRole)) return false
    if (actorRole === 'ADMIN') return true
    if (actorRole === 'MANAGER') return targetRole === 'STAFF' || targetRole === 'WAITER'
    return false
}

/**
 * A username for someone who will never type one.
 *
 * Latin letters and digits only: a Lao name would otherwise produce a username
 * nobody can type at the login screen if the role is ever changed to a till
 * role. Falls back to "server" so a fully Lao name still gets a handle.
 */
export function usernameFrom(name: string): string {
    const base = (name || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '')
        .slice(0, 20)
    return base || 'server'
}
