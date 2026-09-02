import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// Closing is deliberately NOT here. This flips the floor-plan colour; /close
// books revenue and cannot be undone by a stray PUT.
const ALLOWED = ['OPEN', 'BILL_REQUESTED']

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const { status } = await request.json()

        if (!ALLOWED.includes(status)) {
            return NextResponse.json(
                { error: 'Status must be OPEN or BILL_REQUESTED' },
                { status: 400 }
            )
        }

        const existing = await prisma.tableSession.findUnique({ where: { id } })
        if (!existing) {
            return NextResponse.json({ error: 'Session not found' }, { status: 404 })
        }
        if (existing.status === 'CLOSED') {
            return NextResponse.json({ error: 'SESSION_ALREADY_CLOSED' }, { status: 409 })
        }

        const session = await prisma.tableSession.update({ where: { id }, data: { status } })
        return NextResponse.json(session)
    } catch (error) {
        console.error('[table-sessions] status PUT failed', error)
        return NextResponse.json({ error: 'Failed to update session status' }, { status: 500 })
    }
}
