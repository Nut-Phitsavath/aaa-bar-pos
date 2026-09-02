import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params

        // Update order status to HOLD
        await prisma.order.update({
            where: { id },
            data: { status: 'HOLD' }
        })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error(error)
        return NextResponse.json({ error: 'Failed to hold order' }, { status: 500 })
    }
}
