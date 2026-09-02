import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sessionTotal, canCloseSession } from '@/lib/sessions'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const { paymentMethod } = await request.json()

        const method = paymentMethod === 'BANK_NOTE' ? 'CASH' : (paymentMethod || 'CASH')

        const session = await prisma.tableSession.findUnique({
            where: { id },
            include: { orders: { select: { id: true, status: true, total: true } } }
        })

        if (!session) {
            return NextResponse.json({ error: 'Session not found' }, { status: 404 })
        }

        const check = canCloseSession(session, session.orders)
        if (!check.ok) {
            return NextResponse.json({ error: check.reason }, { status: 409 })
        }

        const total = sessionTotal(session.orders)
        const openShift = await prisma.shift.findFirst({ where: { status: 'OPEN' } })
        const closedAt = new Date()

        await prisma.$transaction(async (tx) => {
            // Book the revenue. Stock already moved when each round was sent,
            // so nothing here touches inventory.
            await tx.order.updateMany({
                where: { sessionId: id, status: 'SENT' },
                data: {
                    status: 'COMPLETED',
                    paymentMethod: method,
                    shiftId: openShift?.id ?? null,
                    updatedAt: closedAt
                }
            })

            await tx.tableSession.update({
                where: { id },
                data: { status: 'CLOSED', closedAt }
            })

            // One drawer movement for the whole bill, not one per round.
            if (method === 'CASH' && openShift && total > 0) {
                await tx.shift.update({
                    where: { id: openShift.id },
                    data: { cashPayments: { increment: total } }
                })
            }
        })

        return NextResponse.json({ success: true, total, closedAt: closedAt.toISOString() })
    } catch (error) {
        console.error('[table-sessions] close failed', error)
        return NextResponse.json({ error: 'Failed to close session' }, { status: 500 })
    }
}
