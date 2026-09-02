import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateOnepayQR } from '@/lib/onepay';
import { classifyPaymentFailure } from '@/lib/net-status';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { orderId } = body;

        if (!orderId) {
            return NextResponse.json({ error: 'Order ID is required' }, { status: 400 });
        }

        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: { items: true }
        });

        if (!order) {
            return NextResponse.json({ error: 'Order not found' }, { status: 404 });
        }

        // DEPRICATED: Reusing QR for order is problematic if items change.
        // We will always regenerate to ensure the current total is represented.
        /*
        if (order.qrCodeData) {
            console.log(`Reusing existing QR for order ${order.orderNumber}`);
            return NextResponse.json({
                qrCode: order.qrCodeData,
                order: order
            });
        }
        */

        // Generate a UNIQUE transaction ID for BCEL by appending a timestamp.
        // This ensures the bank never sees a "duplicate" even if items/totals changed.
        const bcelUuid = `${orderId}-${Date.now()}`;

        // Generate QR Data using real BCEL API
        const qrData = await generateOnepayQR({
            amount: order.total,
            uuid: bcelUuid,          // Unique ID for this specific payment attempt
            invoiceid: order.orderNumber, // Human readable
            description: `Order ${order.orderNumber}`
        });

        // Update order with QR data and the unique reference we used
        const updatedOrder = await prisma.order.update({
            where: { id: orderId },
            data: {
                qrCodeData: qrData,
                bankReference: bcelUuid, // Store the UUID used for this QR
                paymentStatus: 'PENDING'
            }
        });

        return NextResponse.json({
            qrCode: qrData,
            order: updatedOrder
        });
    } catch (error) {
        // Everything after the order lookup is the BCEL/Onepay call, so a throw here
        // means OnePay is unusable right now. Split it into the two cases the cashier
        // can act on differently: this till being offline (go check the router) vs
        // the bank being down (just take cash). The raw cause goes to the server log
        // only -- it can carry request URLs and credentials, and the message we
        // return is shown on the customer-facing screen.
        const source = await classifyPaymentFailure(error);
        console.error(`Onepay Generate Error (${source}):`, error);
        return NextResponse.json(
            {
                error: source === 'NO_INTERNET'
                    ? 'This POS has no internet connection'
                    : 'Bank payment service (BCEL Onepay) is not responding',
                source,
            },
            { status: 502 } // 502 Bad Gateway = we could not complete the upstream call
        );
    }
}
