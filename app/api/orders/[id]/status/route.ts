import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> } // Params is a Promise in Next.js 15
) {
    try {
        const { id } = await params
        const { status } = await request.json()

        if (!status) {
            return NextResponse.json({ error: 'Status is required' }, { status: 400 })
        }

        const validStatuses = ['PENDING', 'PREPARING', 'READY', 'COMPLETED', 'HOLD', 'CANCELLED']
        if (!validStatuses.includes(status)) {
            return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
        }

        // Update status
        await prisma.order.update({
            where: { id },
            data: { status }
        })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error(error)
        return NextResponse.json({ error: 'Failed to update status' }, { status: 500 })
    }
}
