import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { startOfDay, endOfDay } from 'date-fns'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    try {
        const where: any = {
            status: 'CANCELLED'
        }

        if (startDate || endDate) {
            where.createdAt = {}
            if (startDate) where.createdAt.gte = startOfDay(new Date(startDate))
            if (endDate) where.createdAt.lte = endOfDay(new Date(endDate))
        }

        const refunds = await prisma.order.findMany({
            where,
            include: {
                customer: { select: { name: true } },
                items: true
            },
            orderBy: { createdAt: 'desc' }
        })

        const formattedRefunds = refunds.map(order => ({
            id: order.id,
            orderNumber: order.orderNumber,
            total: order.total,
            customerName: order.customer?.name || 'Walk-in',
            reason: order.cancellationReason || 'N/A',
            date: order.createdAt,
            itemCount: order.items.length
        }))

        return NextResponse.json(formattedRefunds)
    } catch (error) {
        console.error('Error fetching refunds:', error)
        return NextResponse.json({ error: 'Failed to fetch refunds' }, { status: 500 })
    }
}
