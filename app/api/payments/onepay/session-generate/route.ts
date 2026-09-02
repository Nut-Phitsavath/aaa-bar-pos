import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateOnepayQR } from '@/lib/onepay'
import { classifyPaymentFailure } from '@/lib/net-status'

export const dynamic = 'force-dynamic'

/**
 * A QR for one leg of a table bill.
 *
 * Deliberately separate from the order-based generate route rather than a
 * change to it: the walk-in till's payment path is in daily use and stays
 * exactly as it is. Both call the same generateOnepayQR helper, so there is
 * one BCEL integration, two callers.
 */
export async function POST(request: Request) {
    try {
        const { paymentId } = await request.json()

        if (!paymentId) {
            return NextResponse.json({ error: 'paymentId is required' }, { status: 400 })
        }

        const payment = await prisma.payment.findUnique({
            where: { id: paymentId },
            include: { session: { include: { table: true } } }
        })

        if (!payment) {
            return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
        }
        if (payment.paymentStatus === 'PAID') {
            return NextResponse.json({ error: 'PAYMENT_ALREADY_PAID' }, { status: 409 })
        }

        // Unique per attempt, exactly as the order route does it, so BCEL never
        // sees a duplicate if a QR is regenerated.
        const bcelUuid = `${paymentId}-${Date.now()}`

        const qrData = await generateOnepayQR({
            amount: payment.amount,
            uuid: bcelUuid,
            invoiceid: payment.session.table.name,
            description: `Table ${payment.session.table.name}`
        })

        const updated = await prisma.payment.update({
            where: { id: paymentId },
            data: { qrCodeData: qrData, bcelUuid, paymentStatus: 'PENDING' }
        })

        return NextResponse.json({ qrCode: qrData, payment: updated })
    } catch (error) {
        // Past the lookup, everything is the BCEL call. Split the two cases the
        // cashier acts on differently - this till offline vs the bank down -
        // and keep the raw cause in the server log, since it can carry request
        // URLs and credentials.
        const source = await classifyPaymentFailure(error)
        console.error(`Onepay Session Generate Error (${source}):`, error)
        return NextResponse.json(
            {
                error: source === 'NO_INTERNET'
                    ? 'This POS has no internet connection'
                    : 'Bank payment service (BCEL Onepay) is not responding',
                source
            },
            { status: 502 }
        )
    }
}
