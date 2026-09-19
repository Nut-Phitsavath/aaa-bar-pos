import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * The table has been cleared and can take the next party.
 *
 * Any signed-in staff member, no manager PIN: this is the person standing at
 * the table with a tray, and it changes no money. What it changes is whether a
 * host may seat somebody, which is a question the floor answers, not the till.
 *
 * Clearing also drops a booking whose party has come and gone - the table is
 * being handed back to the room, and a reservation left on it would hold the
 * table against the next walk-in for no reason. A booking still in the future
 * survives, because that party has not arrived yet.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const user = await getSessionUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const table = await prisma.table.findUnique({
            where: { id },
            include: {
                sessions: { where: { status: { not: 'CLOSED' } }, select: { id: true }, take: 1 },
            },
        })
        if (!table) return NextResponse.json({ error: 'Not found' }, { status: 404 })

        // A table somebody is sitting at is not waiting to be cleared, whatever
        // the flag says - staff seated a party onto it before anyone got there
        // with a tray, and clearing it now would say the mess is gone when it
        // is underneath a party.
        if (table.sessions.length > 0) {
            return NextResponse.json({ error: 'TABLE_OCCUPIED' }, { status: 409 })
        }

        const spent = table.reservedAt !== null && table.reservedAt <= new Date()

        const updated = await prisma.table.update({
            where: { id },
            data: {
                needsClearing: false,
                ...(spent ? { reservedFor: null, reservedAt: null } : {}),
            },
        })

        return NextResponse.json({ cleared: true, table: updated.name })
    } catch (error) {
        console.error('[table clear] POST failed', error)
        return NextResponse.json({ error: 'Failed to clear table' }, { status: 500 })
    }
}
