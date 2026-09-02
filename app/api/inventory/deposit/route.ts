import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { cookies } from 'next/headers'

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
        const cookieStore = await cookies()
        const sessionCookie = cookieStore.get('pos_session')
        let userId = null
        if (sessionCookie) {
            try {
                const sessionUser = JSON.parse(sessionCookie.value)
                userId = sessionUser.id
            } catch (e) { }
        }

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
