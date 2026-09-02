import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params

        // Update order status back to PENDING
        await prisma.order.update({
            where: { id },
            data: { status: 'PENDING' }
        })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error(error)
        return NextResponse.json({ error: 'Failed to resume order' }, { status: 500 })
    }
}
