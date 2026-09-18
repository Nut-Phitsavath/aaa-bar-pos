import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireManager } from '@/lib/auth'
import { parseMinSpend } from '@/lib/min-spend'

export const dynamic = 'force-dynamic'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const gate = await requireManager()
    if (gate instanceof Response) return gate

    try {
        const { id } = await params
        const { name, area, seats, displayOrder, isActive, minSpend } = await request.json()

        // A table with money open on it cannot be taken off the floor.
        if (isActive === false) {
            const open = await prisma.tableSession.findFirst({
                where: { tableId: id, status: { not: 'CLOSED' } }
            })
            if (open) {
                return NextResponse.json({ error: 'TABLE_HAS_OPEN_SESSION' }, { status: 409 })
            }
        }

        const table = await prisma.table.update({
            where: { id },
            data: {
                ...(name !== undefined && { name: String(name).trim() }),
                ...(area !== undefined && { area: String(area).trim().slice(0, 24) || 'INDOOR' }),
                ...(seats !== undefined && { seats: Number(seats) }),
                ...(displayOrder !== undefined && { displayOrder: Number(displayOrder) }),
                ...(isActive !== undefined && { isActive: Boolean(isActive) }),
                // Sent explicitly, so clearing the field on a room that had a
                // floor actually removes it - parseMinSpend turns blank into
                // null rather than leaving yesterday's figure in place.
                ...(minSpend !== undefined && { minSpend: parseMinSpend(minSpend) })
            }
        })

        return NextResponse.json(table)
    } catch (error) {
        console.error('[tables] PUT failed', error)
        return NextResponse.json({ error: 'Failed to update table' }, { status: 500 })
    }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const gate = await requireManager()
    if (gate instanceof Response) return gate

    try {
        const { id } = await params

        const open = await prisma.tableSession.findFirst({
            where: { tableId: id, status: { not: 'CLOSED' } }
        })
        if (open) {
            return NextResponse.json({ error: 'TABLE_HAS_OPEN_SESSION' }, { status: 409 })
        }

        // Soft delete: the sessions and orders under this table must survive.
        await prisma.table.update({ where: { id }, data: { isActive: false } })
        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('[tables] DELETE failed', error)
        return NextResponse.json({ error: 'Failed to remove table' }, { status: 500 })
    }
}
