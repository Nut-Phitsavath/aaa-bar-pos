import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { MANAGER_ROLES } from '@/lib/manager-auth'

export const dynamic = 'force-dynamic'

/**
 * Who can authorise a write-off, for the approval dialog's picker.
 *
 * Requires a signed-in till - unlike the login picker, there is no reason for
 * this list to be reachable by an anonymous request. Returns name and username
 * only, and the username is needed because the approval check takes one, the
 * same way login does.
 */
export async function GET() {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    try {
        const managers = await prisma.user.findMany({
            where: { role: { in: MANAGER_ROLES }, isActive: true },
            orderBy: { name: 'asc' },
            select: { id: true, name: true, username: true }
        })
        return NextResponse.json(managers)
    } catch (error) {
        console.error('[managers] GET failed', error)
        return NextResponse.json({ error: 'Failed to load managers' }, { status: 500 })
    }
}
