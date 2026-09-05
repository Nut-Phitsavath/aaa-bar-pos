import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { verifyManager } from '@/lib/manager-auth'
import { canRefund } from '@/lib/bill-operations'

export const dynamic = 'force-dynamic'

/**
 * Hand one tender back.
 *
 * One at a time, not the whole bill: 17% of bills here are split, and a
 * customer may want the cash returned while the QR leg stands. A whole-bill
 * refund cannot express that.
 *
 * The payment is marked reversed rather than deleted or mirrored by a negative
 * one. The original tender stays legible on the bill - what was taken, when,
 * and by whom - and a reversal can never be misread as a second sale. This is
 * the same shape as a voided order line, so both read through one audit trail.
 *
 * Cash comes back out of the drawer, so the shift's cash total is reduced by
 * the same amount it was raised by. A QR leg is not adjusted here: BCEL moves
 * that money, and pretending otherwise in the drawer count would make the
 * reconciliation disagree with the bank.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const { managerUsername, managerPin, reason } = await request.json()

        const user = await getSessionUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        if (typeof reason !== 'string' || !reason.trim()) {
            // Money going back needs a stated cause, for the same reason a void does.
            return NextResponse.json({ error: 'REFUND_REASON_REQUIRED' }, { status: 400 })
        }

        const payment = await prisma.payment.findUnique({ where: { id } })
        if (!payment) return NextResponse.json({ error: 'Payment not found' }, { status: 404 })

        const openShift = await prisma.shift.findFirst({ where: { status: 'OPEN' } })
        const check = canRefund(payment, payment.shiftId, openShift?.id ?? null)
        if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 409 })

        const approval = await verifyManager(managerUsername, managerPin)
        if (!approval.ok) {
            return NextResponse.json(
                { error: approval.reason, retryInMs: approval.retryInMs },
                { status: approval.reason === 'TOO_MANY_ATTEMPTS' ? 429 : 403 }
            )
        }

        const refunded = await prisma.$transaction(async (tx) => {
            const updated = await tx.payment.update({
                where: { id },
                data: {
                    voidedAt: new Date(),
                    voidedById: user.id,
                    voidReason: reason.trim(),
                },
            })

            // Only cash physically leaves the drawer.
            if (payment.method === 'CASH' && openShift) {
                await tx.shift.update({
                    where: { id: openShift.id },
                    data: { cashPayments: { decrement: payment.amount } },
                })
            }

            // The bill owes again, so it is no longer a settled one.
            await tx.tableSession.update({
                where: { id: payment.sessionId },
                data: { status: 'OPEN', closedAt: null },
            })

            return updated
        })

        return NextResponse.json({ payment: refunded })
    } catch (error) {
        console.error('[payment refund] POST failed', error)
        return NextResponse.json({ error: 'Failed to refund' }, { status: 500 })
    }
}
