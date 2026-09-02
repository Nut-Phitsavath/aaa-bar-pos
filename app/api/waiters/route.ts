import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * The waiter picker on the POS order panel.
 *
 * Deliberately NOT /api/users, which is admin-only because a username list is
 * half of a 4-digit PIN brute force. This returns id and name only, for active
 * waiters only, to any signed-in till - no usernames, no roles, no PIN surface.
 */
export async function GET() {
    const user = await getSessionUser()
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
        const waiters = await prisma.user.findMany({
            where: { role: 'WAITER', isActive: true },
            orderBy: { name: 'asc' },
            select: { id: true, name: true }
        })
        return NextResponse.json(waiters)
    } catch (error) {
        console.error('[waiters] GET failed', error)
        return NextResponse.json({ error: 'Failed to load waiters' }, { status: 500 })
    }
}
