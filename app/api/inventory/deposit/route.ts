import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'

export async function POST(request: Request) {
    try {
        const body = await request.json()
        const { ingredientId, quantity, cost, notes } = body

        if (!ingredientId || !quantity || quantity <= 0) {
            return NextResponse.json({ error: 'Invalid ingredient ID or quantity' }, { status: 400 })
        }

        // Get current ingredient
        const ingredient = await prisma.ingredient.findUnique({
            where: { id: ingredientId }
        })

        if (!ingredient) {
            return NextResponse.json({ error: 'Ingredient not found' }, { status: 404 })
        }

        // Get current user
        // The signed-in user as the database sees them (lib/auth), not a cookie's say-so.
        const userId = (await getSessionUser())?.id ?? null

        // Update ingredient stock and create transaction
        const [updatedIngredient, transaction] = await prisma.$transaction([
            prisma.ingredient.update({
                where: { id: ingredientId },
                data: {
                    mainStock: { increment: quantity }
                }
            }),
            prisma.stockTransaction.create({
                data: {
                    ingredientId,
                    type: 'DEPOSIT',
                    quantity,
                    toStore: 'MAIN',
                    cost: cost || null,
                    notes: notes || null,
                    userId: userId
                }
            })
        ])

        return NextResponse.json({
            ingredient: updatedIngredient,
            transaction
        }, { status: 200 })
    } catch (error) {
        console.error('Deposit error:', error)
        return NextResponse.json({ error: 'Failed to deposit stock' }, { status: 500 })
    }
}
