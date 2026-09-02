import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: Request) {
    try {
        const stockCounts = await prisma.stockCount.findMany({
            include: {
                ingredient: { select: { name: true, unit: true } }
            },
            orderBy: { createdAt: 'desc' },
            take: 50
        })
        return NextResponse.json(stockCounts)
    } catch (error) {
        console.error(error)
        return NextResponse.json({ error: 'Failed to fetch stock counts' }, { status: 500 })
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json()
        const { ingredientId, actualStock, theoreticalStock, notes } = body

        if (!ingredientId || actualStock === undefined || theoreticalStock === undefined) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        const difference = actualStock - theoreticalStock

        const stockCount = await prisma.stockCount.create({
            data: {
                ingredientId,
                theoreticalStock,
                actualStock,
                difference,
                notes
            }
        })

        // Optionally update the ingredient's warehouse stock to match actual count
        // For now, we'll just record it. If the user wants to adjust stock, they can do a separate adjustment.
        // OR we can automatically create an adjustment transaction if there is a difference.

        if (difference !== 0) {
            await prisma.stockTransaction.create({
                data: {
                    ingredientId,
                    type: 'SHOP_ADJUST',
                    quantity: difference,
                    reason: `Stock Audit Adjustment: ${notes || 'No notes'}`,
                    notes: `Theoretical: ${theoreticalStock}, Actual: ${actualStock}`
                }
            })

            // Update ingredient stock
            await prisma.ingredient.update({
                where: { id: ingredientId },
                data: {
                    shopStock: { increment: difference }
                }
            })
        }

        return NextResponse.json(stockCount)
    } catch (error) {
        console.error(error)
        return NextResponse.json({ error: 'Failed to submit stock count' }, { status: 500 })
    }
}
