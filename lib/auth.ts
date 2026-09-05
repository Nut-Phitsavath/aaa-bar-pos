import { cookies } from "next/headers"
import { prisma } from "@/lib/prisma"
import { canManageStaff } from "@/lib/roles"

/**
 * Server-side session checks for API routes.
 *
 * middleware.ts gates *page* routes, but its matcher excludes /api, so every
 * route under app/api is open unless it checks for itself. That matters more
 * than it sounds: the Cloudflare tunnel publishes this host, so "internal
 * tool on the shop PC" is not the threat model.
 *
 * The role is re-read from the database rather than trusted from the cookie.
 * pos_session is plain JSON and is not signed, so anyone can edit role:"ADMIN"
 * into it in DevTools; the cookie is only good for saying *which* user is
 * claimed, never for what they are allowed to do.
 */

export type SessionUser = { id: string; name: string; username: string; role: string }

/** The signed-in user as the database sees them, or null. */
export async function getSessionUser(): Promise<SessionUser | null> {
    try {
        const raw = (await cookies()).get("pos_session")?.value
        if (!raw) return null
        const claimed = JSON.parse(raw)
        if (!claimed?.id) return null

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
