export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
    try {
        const activeShift = await prisma.shift.findFirst({
            where: { status: 'OPEN' },
            select: {
                id: true,
                startCash: true,
                cashPayments: true,
                startTime: true
            }
        })

        if (!activeShift) {
            return NextResponse.json({ activeShift: null })
        }

        // Calculate other payment methods since shift started (Total = Completed - Cancelled)
        const completions = await prisma.order.groupBy({
            by: ['paymentMethod'],
            where: {
                createdAt: { gte: activeShift.startTime },
                status: 'COMPLETED',
                isReportable: true
            },
            _sum: { total: true },
            _count: { id: true }
        })

        const cancellations = await prisma.order.groupBy({
            by: ['paymentMethod'],
            where: {
                createdAt: { gte: activeShift.startTime },
                status: 'CANCELLED',
                isReportable: true
            },
            _sum: { total: true },
            _count: { id: true }
        })

        const getNetValue = (method: string) => {
            const comp = completions.find(p => p.paymentMethod === method)?._sum.total || 0
            const canc = cancellations.find(p => p.paymentMethod === method)?._sum.total || 0
            return comp - canc
        }

        const getNetCount = (method: string) => {
            const comp = completions.find(p => p.paymentMethod === method)?._count.id || 0
            const canc = cancellations.find(p => p.paymentMethod === method)?._count.id || 0
            return comp - canc
        }

        return NextResponse.json({
            activeShift: {
                ...activeShift,
                onePayPayments: getNetValue('ONEPAY'),
                onePayCount: getNetCount('ONEPAY'),
                transferPayments: getNetValue('TRANSFER'),
                transferCount: getNetCount('TRANSFER')
            }
        })
    } catch (error) {
        console.error('Shift Status API error:', error)
        return NextResponse.json({ error: "Error checking shift status" }, { status: 500 })
    }
}
