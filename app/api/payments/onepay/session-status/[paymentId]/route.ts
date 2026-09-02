import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkOnepayStatus } from '@/lib/onepay'
import { closeSessionIfSettled } from '@/lib/settle'

export const dynamic = 'force-dynamic'

/**
 * Poll BCEL for one leg of a table bill.
 *
 * Mirrors the order status route the walk-in till already polls - same helper,
 * same success conditions - but resolves a Payment instead of an Order, and
 * settles the session when this leg clears the remaining balance.
 */
export async function GET(
    request: Request,
    { params }: { params: Promise<{ paymentId: string }> }
) {
    try {
        const { paymentId } = await params

        const payment = await prisma.payment.findUnique({ where: { id: paymentId } })
        if (!payment) {
            return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
        }

        if (payment.paymentStatus === 'PAID') {
            return NextResponse.json({ status: 'PAID', paymentId, closed: true })
        }

        const activeUuid = payment.bcelUuid || payment.id
        const bcelData = await checkOnepayStatus(activeUuid)

        if (bcelData && bcelData.result === 0 && bcelData.data) {
            const bcelStatus = bcelData.data.status
            const transactionId =
                bcelData.data.transactionid || bcelData.data.fccref || bcelData.data.TICKET

            if (transactionId || bcelStatus === 'SUCCESS' || bcelStatus === 'paid' || bcelStatus === 'COMPLETED') {
                await prisma.payment.update({
                    where: { id: payment.id },
                    data: { paymentStatus: 'PAID', bankReference: transactionId || null }
                })

                // This leg may have been the last one owed.
                const settle = await closeSessionIfSettled(payment.sessionId)

                return NextResponse.json({ status: 'PAID', paymentId, closed: settle.closed })
            }
        }

        return NextResponse.json({ status: payment.paymentStatus, paymentId, closed: false })
    } catch (error) {
        console.error('Onepay Session Status Check Error:', error)
        return NextResponse.json({ error: 'Failed to check status' }, { status: 500 })
    }
}
