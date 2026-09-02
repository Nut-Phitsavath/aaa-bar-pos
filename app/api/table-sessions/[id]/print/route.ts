import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { generateOnepayQR } from '@/lib/onepay'
import { classifyPaymentFailure } from '@/lib/net-status'
import { sessionTotal } from '@/lib/sessions'
import { billTotalOf, balanceOf } from '@/lib/payments'

export const dynamic = 'force-dynamic'

/**
 * Prepare a table bill for printing (requirement #3, #20).
 *
 * In this bar the server carries the order to the till, so nobody needs a
 * "bill requested" signal - the till already knows. What the moment actually
 * produces is a printed bill with a QR the customer can pay from. This does
 * both: marks the table as waiting to pay so the floor plan shows it, and
 * mints a QR for whatever is still owed.
 *
 * Re-printing mints a fresh QR for the current balance, because a bill printed
 * before a part-payment would otherwise ask for the wrong amount. The previous
 * pending leg is retired rather than left looking outstanding.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params

        const user = await getSessionUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const session = await prisma.tableSession.findUnique({
            where: { id },
            include: {
                table: true,
                orders: { select: { status: true, total: true } },
                payments: true
            }
        })
        if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

        const total = billTotalOf(sessionTotal(session.orders), session.discountType, session.discountValue)
        const balance = balanceOf(total, session.payments)

        // Retire any QR from an earlier print of this bill; only one should
        // ever be live, or the customer can pay a stale amount.
        await prisma.payment.updateMany({
            where: { sessionId: id, method: 'ONEPAY', paymentStatus: 'PENDING' },
            data: { paymentStatus: 'CANCELLED' }
        })

        let qrCode: string | null = null
        let qrError: string | null = null

        if (balance > 0) {
            const payment = await prisma.payment.create({
                data: {
                    session: { connect: { id } },
                    method: 'ONEPAY',
                    amount: balance,
                    paymentStatus: 'PENDING',
                    user: { connect: { id: user.id } }
                }
            })

            const bcelUuid = `${payment.id}-${Date.now()}`
            try {
                qrCode = await generateOnepayQR({
                    amount: balance,
                    uuid: bcelUuid,
                    invoiceid: session.table.name,
                    description: `Table ${session.table.name}`
                })
                await prisma.payment.update({
                    where: { id: payment.id },
                    data: { qrCodeData: qrCode, bcelUuid }
                })
            } catch (error) {
                // The bill still has to print. A bar with a dead internet line
                // takes cash; refusing to print the bill would stop service
                // over a payment method the customer may not even want.
                const source = await classifyPaymentFailure(error)
                console.error(`Onepay print QR failed (${source}):`, error)
                await prisma.payment.delete({ where: { id: payment.id } })
                qrError = source === 'NO_INTERNET'
                    ? 'This POS has no internet connection'
                    : 'Bank payment service (BCEL Onepay) is not responding'
            }
        }

        if (session.status === 'OPEN') {
            await prisma.tableSession.update({
                where: { id },
                data: { status: 'BILL_REQUESTED' }
            })
        }

        return NextResponse.json({ success: true, balance, qrCode, qrError })
    } catch (error) {
        console.error('[print] POST failed', error)
        return NextResponse.json({ error: 'Failed to prepare bill' }, { status: 500 })
    }
}
