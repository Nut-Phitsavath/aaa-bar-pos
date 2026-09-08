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

        // All three writes together, or none of them. Previously the count and
        // the adjustment row were written first and the stock update ran on its
        // own - so when it failed, the ledger was left claiming an adjustment
        // that never reached the shelf, which is the one thing a stock ledger
        // must never say.
        const stockCount = await prisma.$transaction(async (tx) => {
            const count = await tx.stockCount.create({
                data: {
                    ingredientId,
                    theoreticalStock,
                    actualStock,
                    notes,
                    difference
                }
            })

            if (difference !== 0) {
                await tx.stockTransaction.create({
                    data: {
                        ingredientId,
                        type: 'SHOP_ADJUST',
                        quantity: difference,
                        toStore: 'SUB',
                        reason: `Stock Audit Adjustment: ${notes || 'No notes'}`,
                        notes: `Theoretical: ${theoreticalStock}, Actual: ${actualStock}`
                    }
                })

                // subStock is the shop shelf. `shopStock` is not a field on
                // Ingredient and never has been, so this threw on every count
                // that found a discrepancy - which is the only kind anyone
                // submits, and the whole point of counting.
                await tx.ingredient.update({
                    where: { id: ingredientId },
                    data: {
                        subStock: { increment: difference }
                    }
                })
            }

            return count
        })

        return NextResponse.json(stockCount)
    } catch (error) {
        console.error(error)
        return NextResponse.json({ error: 'Failed to submit stock count' }, { status: 500 })
    }
}
