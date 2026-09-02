import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sessionTotal, BILLABLE_ORDER_STATUSES } from '@/lib/sessions'
import { billTotalOf } from '@/lib/payments'

// The floor plan polls this every 5s; it must never be served stale.
export const dynamic = 'force-dynamic'

export async function GET() {
    try {
        const tables = await prisma.table.findMany({
            where: { isActive: true },
            orderBy: [{ area: 'asc' }, { displayOrder: 'asc' }, { name: 'asc' }],
            include: {
                sessions: {
                    where: { status: { not: 'CLOSED' } },
                    take: 1,
                    orderBy: { openedAt: 'desc' },
                    include: {
                        orders: {
                            select: { status: true, total: true, waiterId: true }
                        }
                    }
                }
            }
        })

        const payload = tables.map((table) => {
            const session = table.sessions[0]
            const billable = session
                ? session.orders.filter((o) =>
                    (BILLABLE_ORDER_STATUSES as readonly string[]).includes(o.status))
                : []

            return {
                id: table.id,
                name: table.name,
                area: table.area,
                seats: table.seats,
                displayOrder: table.displayOrder,
                session: session
                    ? {
                        id: session.id,
                        status: session.status,
                        openedAt: session.openedAt.toISOString(),
                        orderCount: billable.length,
                        waiterCount: new Set(billable.map((o) => o.waiterId).filter(Boolean)).size,
                        // What they will actually pay, discount included.
                        total: billTotalOf(sessionTotal(session.orders), session.discountType, session.discountValue),
                        isOwnerVip: session.isOwnerVip
                    }
                    : null
            }
        })

        return NextResponse.json(payload)
    } catch (error) {
        console.error('[tables] GET failed', error)
        return NextResponse.json({ error: 'Failed to load tables' }, { status: 500 })
    }
}

export async function POST(request: Request) {
    try {
        const { name, area, seats, displayOrder } = await request.json()

        if (!name || typeof name !== 'string' || !name.trim()) {
            return NextResponse.json({ error: 'Table name is required' }, { status: 400 })
        }

        const table = await prisma.table.create({
            data: {
                name: name.trim(),
                area: area || 'INDOOR',
                seats: Number(seats) || 4,
                displayOrder: Number(displayOrder) || 0
            }
        })

        return NextResponse.json(table)
    } catch (error) {
        console.error('[tables] POST failed', error)
        return NextResponse.json({ error: 'Failed to create table' }, { status: 500 })
    }
}
