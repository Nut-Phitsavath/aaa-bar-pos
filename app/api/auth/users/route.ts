import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * Who can sign in, for the PIN screen - the one staff list served before
 * anyone has signed in (see isPublicApi). It gives out what the screen shows
 * and the username it signs in with, and not the user ids: those are what a
 * session names, and handing them to anyone who asked is how a forged cookie
 * would have found the owner's.
 */
export async function GET() {
    try {
        const users = await prisma.user.findMany({
            where: { isActive: true },
            select: {
                username: true,
                name: true,
                role: true
            }
        })
        return NextResponse.json({ users })
    } catch (error) {
        return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 })
    }
}
