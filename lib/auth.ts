import { cookies } from "next/headers"
import { prisma } from "@/lib/prisma"
import { canManageStaff } from "@/lib/roles"
import { SESSION_COOKIE, readSession, sessionSecret } from "@/lib/session"

/**
 * Server-side session checks for API routes.
 *
 * proxy.ts turns away any API call without a valid session (see lib/session),
 * but that is the quick check; this is the one next to the data. The cookie is
 * signed by this server, so it really does name the user who signed in - and
 * the role is still re-read from the database, so a demoted or deactivated
 * member of staff loses access at once rather than when the cookie expires.
 */

export type SessionUser = { id: string; name: string; username: string; role: string }

/** The signed-in user as the database sees them, or null. */
export async function getSessionUser(): Promise<SessionUser | null> {
    try {
        const claimed = readSession((await cookies()).get(SESSION_COOKIE)?.value, sessionSecret())
        if (!claimed) return null

        const user = await prisma.user.findUnique({
            where: { id: claimed.id },
            select: { id: true, name: true, username: true, role: true, isActive: true },
        })
        if (!user || !user.isActive) return null
        return { id: user.id, name: user.name, username: user.username, role: user.role }
    } catch {
        return null
    }
}

/**
 * Returns the user, or a Response to return straight from the handler:
 *
 *   const gate = await requireAdmin()
 *   if (gate instanceof Response) return gate
 *
 * 404 rather than 403 for a non-admin, so an unauthenticated scan of the API
 * cannot use the status code to map which endpoints exist.
 */
export async function requireAdmin(): Promise<SessionUser | Response> {
    const user = await getSessionUser()
    if (!user) return Response.json({ error: "Not signed in" }, { status: 401 })
    if (user.role !== "ADMIN") return Response.json({ error: "Not found" }, { status: 404 })
    return user
}

/**
 * The same gate for the owner and whoever is running the floor tonight.
 *
 * Used by the staff list and the floor plan editor: both are jobs a manager
 * does at 6pm without waking the owner, and neither is a job for a server.
 * Who may edit *whom* is a separate question, answered by canManageUser.
 */
export async function requireManager(): Promise<SessionUser | Response> {
    const user = await getSessionUser()
    if (!user) return Response.json({ error: "Not signed in" }, { status: 401 })
    if (!canManageStaff(user.role)) return Response.json({ error: "Not found" }, { status: 404 })
    return user
}
