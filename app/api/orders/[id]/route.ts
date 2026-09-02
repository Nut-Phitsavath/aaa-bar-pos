import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params

        const order = await prisma.order.findUnique({
            where: { id },
            include: {
                items: {
                    include: {
                        variationSize: {
                            include: {
                                variation: true
                            }
                        }
                    }
                },
                customer: true,
                promotion: true,
                user: true
            }
        })

        if (!order) {
            return NextResponse.json({ error: 'Order not found' }, { status: 404 })
        }

        return NextResponse.json(order)
    } catch (e) {
        console.error(e)
        return NextResponse.json({ error: 'Failed to fetch order' }, { status: 500 })
    }
}
