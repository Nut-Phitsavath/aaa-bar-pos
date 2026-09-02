import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { cookies } from 'next/headers'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
    try {
        const { tableId } = await request.json()

        if (!tableId) {
            return NextResponse.json({ error: 'tableId is required' }, { status: 400 })
        }

        const table = await prisma.table.findUnique({ where: { id: tableId } })
        if (!table || !table.isActive) {
            return NextResponse.json({ error: 'Table not found' }, { status: 404 })
        }

        // Who opened it. Same cookie shape POST /api/orders reads.
        const cookieStore = await cookies()
        const sessionCookie = cookieStore.get('pos_session')
        let openedById: string | null = null
        if (sessionCookie) {
            try {
                const sessionUser = JSON.parse(sessionCookie.value)
                const dbUser = await prisma.user.findUnique({ where: { id: sessionUser.id } })
                if (dbUser) openedById = dbUser.id
            } catch { }
        }

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
