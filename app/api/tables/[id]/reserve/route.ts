import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * Hold a table for a party who is coming.
 *
 * Its own route rather than a field on the table PUT, which is manager-gated:
 * editing the floor plan is a manager's job, but taking a booking is whoever
 * picks up the phone. Gating it behind a PIN would mean bookings kept living in
 * a notebook, which is the problem.
 *
 * Name and time only. What this has to prevent is somebody being seated in a
 * room that is spoken for, and that needs no more than those two facts - see
 * the note on Table.reservedFor for what a real bookings system would add.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const user = await getSessionUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const { reservedFor, reservedAt } = await request.json()

        const name = typeof reservedFor === 'string' ? reservedFor.trim().slice(0, 80) : ''
        if (!name) return NextResponse.json({ error: 'NAME_REQUIRED' }, { status: 400 })

        const at = reservedAt ? new Date(reservedAt) : null
        if (!at || Number.isNaN(at.getTime())) {
            return NextResponse.json({ error: 'TIME_REQUIRED' }, { status: 400 })
        }

        const table = await prisma.table.findUnique({ where: { id } })
        if (!table) return NextResponse.json({ error: 'Not found' }, { status: 404 })

        // A retired table is not on the floor to be booked.
        if (!table.isActive) {
            return NextResponse.json({ error: 'TABLE_INACTIVE' }, { status: 409 })
        }

        const updated = await prisma.table.update({
            where: { id },
            data: { reservedFor: name, reservedAt: at },
        })

        return NextResponse.json({
            reserved: true,
            table: updated.name,
            reservedFor: updated.reservedFor,
            reservedAt: updated.reservedAt,
        })
    } catch (error) {
        console.error('[table reserve] POST failed', error)
        return NextResponse.json({ error: 'Failed to reserve table' }, { status: 500 })
    }
}

/** The party cancelled, or never came. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const user = await getSessionUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const updated = await prisma.table.update({
            where: { id },
            data: { reservedFor: null, reservedAt: null },
        })

        return NextResponse.json({ reserved: false, table: updated.name })
    } catch (error) {
        console.error('[table reserve] DELETE failed', error)
        return NextResponse.json({ error: 'Failed to cancel reservation' }, { status: 500 })
    }
}
