import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sessionTotal, canCloseSession, sessionBillTotal } from '@/lib/sessions'
import { balanceOf } from '@/lib/payments'
import { closeSessionIfSettled } from '@/lib/settle'

export const dynamic = 'force-dynamic'

/**
 * Finalise a bill that is already paid for.
 *
 * Money is never taken here - that is POST .../payments, and a bill normally
 * closes itself the moment its balance reaches zero. This exists for the two
 * cases that need an explicit close: a table opened by mistake with nothing on
 * it, and a bill whose last leg was a QR that confirmed on a poll from another
 * device.
 *
 * It refuses to close a bill with money still owed. Before payments existed
 * this endpoint took a paymentMethod and closed regardless, which would now
 * mean a table freed with an unpaid balance.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params

        const session = await prisma.tableSession.findUnique({
            where: { id },
            include: {
                orders: { select: { id: true, status: true, total: true } },
                payments: true
            }
        })

        if (!session) {
            return NextResponse.json({ error: 'Session not found' }, { status: 404 })
        }

        const check = canCloseSession(session, session.orders)
        if (!check.ok) {
            return NextResponse.json({ error: check.reason }, { status: 409 })
        }

        const total = sessionBillTotal(session)
        const balance = balanceOf(total, session.payments)
        if (balance > 0) {
            return NextResponse.json(
                { error: 'BALANCE_OUTSTANDING', balance, total },
                { status: 409 }
            )
        }

        const settled = await closeSessionIfSettled(id)
        if (!settled.closed) {
            return NextResponse.json({ error: settled.reason || 'CLOSE_FAILED' }, { status: 409 })
        }

        const closed = await prisma.tableSession.findUnique({ where: { id } })

        return NextResponse.json({
            success: true,
            total,
            closedAt: closed?.closedAt?.toISOString() ?? null,
            fxRateLAK: closed?.fxRateLAK,
            fxRateUSD: closed?.fxRateUSD
        })
    } catch (error) {
        console.error('[table-sessions] close failed', error)
        return NextResponse.json({ error: 'Failed to close session' }, { status: 500 })
    }
}
