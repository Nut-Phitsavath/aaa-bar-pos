import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkOnepayStatus } from '@/lib/onepay';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        console.log('Onepay Webhook Received:', JSON.stringify(body, null, 2));

        const { uuid, status: initialStatus } = body;

        if (!uuid) {
            return NextResponse.json({ error: 'Missing uuid' }, { status: 400 });
        }

        // Find the order by its globally unique id
        const order = await prisma.order.findUnique({
            where: { id: uuid }
        });

        if (!order) {
            console.warn(`Webhook received for unknown order uuid: ${uuid}`);
            return NextResponse.json({ error: 'Order not found' }, { status: 404 });
        }

        // Already paid? No need to re-verify
        if (order.paymentStatus === 'PAID') {
            return NextResponse.json({ res_code: '00', res_desc: 'Already processed' });
        }

        // SECURITY: Double-check with BCEL directly to verify this isn't a fake webhook
        console.log(`Verifying payment for order ${uuid} with BCEL...`);
        const bcelData = await checkOnepayStatus(uuid);

        if (!bcelData || bcelData.result !== 0) {
            console.error(`Verification failed for order ${uuid}: BCEL returned error or no data.`);
            return NextResponse.json({ error: 'Verification failed' }, { status: 403 });
        }

        const bcelStatus = bcelData.data?.status; // Usually 'SUCCESS' or 'paid'
        const transactionId = bcelData.data?.transactionid || bcelData.data?.fccref;

        // Check if BCEL confirms it is paid
        if (bcelStatus === 'SUCCESS' || bcelStatus === 'paid' || bcelStatus === 'COMPLETED') {
            await prisma.order.update({
                where: { id: order.id },
                data: {
                    paymentStatus: 'PAID',
                    bankReference: transactionId || null,
                    paymentMethod: 'ONEPAY'
                }
            });
            console.log(`Order ${uuid} verified and marked as PAID.`);
        } else {
            console.log(`BCEL Status Inquiry says order ${uuid} is: ${bcelStatus}`);
        }

        // BCEL One expects specific response codes
        return NextResponse.json({
            res_code: '00',
            res_desc: 'Success'
        });
    } catch (error) {
        console.error('Onepay Webhook Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
