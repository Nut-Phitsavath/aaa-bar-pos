import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { canMove } from '@/lib/table-ops'

export const dynamic = 'force-dynamic'

/**
 * A party changes seats (req #2, transfer).
 *
 * The bill is unchanged: same rounds, same opening time, same reference. Only
 * the table it points at moves. Allowed even part-paid, because nothing about
 * the money moves with it - which is also why it needs no approval.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const user = await getSessionUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const { tableId } = await request.json()
        if (typeof tableId !== 'string') {
            return NextResponse.json({ error: 'TABLE_REQUIRED' }, { status: 400 })
        }

        const session = await prisma.tableSession.findUnique({
            where: { id },
            include: { table: { select: { id: true, name: true } } },
        })
        if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

        const target = await prisma.table.findUnique({
            where: { id: tableId },
            include: {
                sessions: { where: { status: { not: 'CLOSED' } }, select: { id: true }, take: 1 },
            },
        })
        if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 })

        const check = canMove(
            session,
            { id: target.id, isActive: target.isActive, occupied: target.sessions.length > 0 },
            session.tableId,
        )
        if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 409 })

        await prisma.$transaction([
            prisma.tableSession.update({ where: { id }, data: { tableId: target.id } }),
            prisma.tableSessionEvent.create({
                data: {
                    sessionId: id,
                    kind: 'MOVE',
                    userId: user.id,
                    // Names, because a table can be renamed after tonight.
                    fromTable: session.table.name,
                    toTable: target.name,
                },
            }),
        ])

        return NextResponse.json({ moved: true, table: target.name })
    } catch (error) {
        console.error('[table move] POST failed', error)
        return NextResponse.json({ error: 'Failed to move table' }, { status: 500 })
    }
}
