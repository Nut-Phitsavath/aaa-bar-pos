import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkOnepayStatus } from '@/lib/onepay';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ orderId: string }> }
) {
    try {
        const { orderId } = await params;

        const order = await prisma.order.findUnique({
            where: { id: orderId }
        });

        if (!order) {
            return NextResponse.json({ error: 'Order not found' }, { status: 404 });
        }

        // If already paid in DB, return that immediately
        if (order.paymentStatus === 'PAID') {
            return NextResponse.json({
                status: 'PAID',
                paymentMethod: order.paymentMethod,
                orderNumber: order.orderNumber
            });
        }

        // Perform a real-time check with BCEL
        // Use the bankReference if we have it, otherwise fallback to orderId
        const activeUuid = order.bankReference || order.id;
        console.log(`Polling status for order ${orderId} (uuid: ${activeUuid}) from BCEL...`);
        const bcelData = await checkOnepayStatus(activeUuid);

        if (bcelData && bcelData.result === 0 && bcelData.data) {
            const bcelStatus = bcelData.data.status;
            const transactionId = bcelData.data.transactionid || bcelData.data.fccref || bcelData.data.TICKET;

            // BCEL 'checkonepayqr' returns result: 0 if a matching successful transaction is found.
            // Some versions return a 'status' field, others just the transaction details.
            if (transactionId || bcelStatus === 'SUCCESS' || bcelStatus === 'paid' || bcelStatus === 'COMPLETED') {
                console.log(`Payment CONFIRMED for order ${order.orderNumber} (Ref: ${transactionId})`);
                await prisma.order.update({
                    where: { id: order.id },
                    data: {
                        paymentStatus: 'PAID',
                        bankReference: transactionId || null,
                        paymentMethod: 'ONEPAY'
                    }
                });

                return NextResponse.json({
                    status: 'PAID',
                    paymentMethod: 'ONEPAY',
                    orderNumber: order.orderNumber
                });
            }
        }

        // Otherwise return whatever is in the DB (usually PENDING or WAITING)
        return NextResponse.json({
            status: order.paymentStatus,
            paymentMethod: order.paymentMethod,
            orderNumber: order.orderNumber
        });
    } catch (error) {
        console.error('Onepay Status Check Error:', error);
        return NextResponse.json({ error: 'Failed to check status' }, { status: 500 });
    }
}
