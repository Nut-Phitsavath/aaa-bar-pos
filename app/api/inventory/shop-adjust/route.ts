import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { cookies } from 'next/headers'

export async function POST(request: Request) {
    try {
        const body = await request.json()
        const { ingredientId, actualStock, reason, notes } = body

        if (!ingredientId || actualStock === undefined || actualStock === null) {
            return NextResponse.json({ error: 'Invalid ingredient ID or actual stock' }, { status: 400 })
        }

        if (!reason) {
            return NextResponse.json({ error: 'Reason is required for adjustment' }, { status: 400 })
        }

        // Get current user
        const cookieStore = await cookies()
        const sessionCookie = cookieStore.get('pos_session')
        let userId = null
        if (sessionCookie) {
            try {
                const sessionUser = JSON.parse(sessionCookie.value)
                userId = sessionUser.id
            } catch (e) { }
        }

        // Get current ingredient
        const ingredient = await prisma.ingredient.findUnique({
            where: { id: ingredientId }
        })

        if (!ingredient) {
            return NextResponse.json({ error: 'Ingredient not found' }, { status: 404 })
        }

        const discrepancy = actualStock - ingredient.subStock

        // Update ingredient stock and create transaction
        const [updatedIngredient, transaction] = await prisma.$transaction([
            prisma.ingredient.update({
                where: { id: ingredientId },
                data: {
                    subStock: actualStock
                }
            }),
            prisma.stockTransaction.create({
                data: {
                    ingredientId,
                    type: 'SHOP_ADJUST',
                    quantity: Math.abs(discrepancy),
                    fromStore: discrepancy < 0 ? 'SUB' : null,
                    toStore: discrepancy > 0 ? 'SUB' : null,
                    reason,
                    notes: notes ? `${notes} | Discrepancy: ${discrepancy > 0 ? '+' : ''}${discrepancy.toFixed(2)} ${ingredient.unit}` : `Discrepancy: ${discrepancy > 0 ? '+' : ''}${discrepancy.toFixed(2)} ${ingredient.unit}`,
                    userId: userId
                }
            })
        ])

        return NextResponse.json({
            ingredient: updatedIngredient,
            transaction,
            discrepancy
        }, { status: 200 })
    } catch (error) {
        console.error('Shop adjust error:', error)
        return NextResponse.json({ error: 'Failed to adjust shop stock' }, { status: 500 })
    }
}
