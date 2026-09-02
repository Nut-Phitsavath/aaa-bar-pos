import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sessionTotal, canCloseSession } from '@/lib/sessions'
import { DEFAULT_RATE_LAK, DEFAULT_RATE_USD } from '@/lib/currency'

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

        // Stamp the rate this bill settles at. Read once, here, and stored on
        // the row - after this the bill never consults settings again, so a
        // rate change tomorrow cannot restate tonight's takings (req #18).
        const rateRows = await prisma.setting.findMany({
            where: { key: { in: ['rate_lak', 'rate_usd'] } }
        })
        const rateOf = (key: string, fallback: number) => {
            const parsed = Number(rateRows.find((r) => r.key === key)?.value)
            return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
        }
        const fxRateLAK = rateOf('rate_lak', DEFAULT_RATE_LAK)
        const fxRateUSD = rateOf('rate_usd', DEFAULT_RATE_USD)

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
                data: { status: 'CLOSED', closedAt, fxRateLAK, fxRateUSD }
            })

            // One drawer movement for the whole bill, not one per round.
            if (method === 'CASH' && openShift && total > 0) {
                await tx.shift.update({
                    where: { id: openShift.id },
                    data: { cashPayments: { increment: total } }
                })
            }
        })

        return NextResponse.json({
            success: true, total, closedAt: closedAt.toISOString(), fxRateLAK, fxRateUSD
        })
    } catch (error) {
        console.error('[table-sessions] close failed', error)
        return NextResponse.json({ error: 'Failed to close session' }, { status: 500 })
    }
}
