import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { requireOpenShift } from '@/lib/shift-guard'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
    try {
        // No shift, no trading. Seating a table is the start of a sale, and a
        // sale made outside a shift is one that nothing will ever count.
        const openShift = await prisma.shift.findFirst({ where: { status: 'OPEN' } })
        const shiftCheck = requireOpenShift(openShift)
        if (!shiftCheck.ok) {
            return NextResponse.json({ error: shiftCheck.reason }, { status: 409 })
        }

        const { tableId } = await request.json()

        if (!tableId) {
            return NextResponse.json({ error: 'tableId is required' }, { status: 400 })
        }

        const table = await prisma.table.findUnique({ where: { id: tableId } })
        if (!table || !table.isActive) {
            return NextResponse.json({ error: 'Table not found' }, { status: 404 })
        }

        // Who opened it: the signed-in user as the database sees them (lib/auth).
        const openedById = (await getSessionUser())?.id ?? null

        // Idempotent: tapping an already-open table returns its session rather
        // than opening a second bill on the same table. Two devices tapping T7
        // at the same moment must not produce two bills.
        const session = await prisma.$transaction(async (tx) => {
            const existing = await tx.tableSession.findFirst({
                where: { tableId, status: { not: 'CLOSED' } }
            })
            if (existing) return existing

            return tx.tableSession.create({
                data: { tableId, status: 'OPEN', openedById }
            })
        })

        return NextResponse.json(session)
    } catch (error) {
        console.error('[table-sessions] POST failed', error)
        return NextResponse.json({ error: 'Failed to open table' }, { status: 500 })
    }
}
