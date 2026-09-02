import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(request: Request) {
    try {
        const body = await request.json()
        const { ingredientId, type, quantity, fromStore, toStore, notes, userId } = body

        if (!ingredientId || !quantity) {
            return NextResponse.json({ error: 'Ingredient ID and quantity are required' }, { status: 400 })
        }

        const qtyNum = parseFloat(quantity.toString())

        // Perform inventory movement and log in a single transaction
        const result = await prisma.$transaction(async (tx) => {
            // 1. Fetch current ingredient
            const ingredient = await tx.ingredient.findUnique({
                where: { id: ingredientId }
            })

            if (!ingredient) throw new Error("Ingredient not found")

            // 2. Adjust stocks based on movement
            const updateData: any = {}

            if (fromStore === 'MAIN') {
                if (ingredient.mainStock < qtyNum) throw new Error("Insufficient stock in Warehouse")
                updateData.mainStock = { decrement: qtyNum }
            } else if (fromStore === 'SUB') {
                if (ingredient.subStock < qtyNum) throw new Error("Insufficient stock in Shop")
                updateData.subStock = { decrement: qtyNum }
            }

            if (toStore === 'MAIN') {
                updateData.mainStock = { ...updateData.mainStock, increment: qtyNum }
            } else if (toStore === 'SUB') {
                updateData.subStock = { ...updateData.subStock, increment: qtyNum }
            }

            // Apply updates
            await tx.ingredient.update({
                where: { id: ingredientId },
                data: updateData
            })

            // 3. Create transaction record
            return await tx.stockTransaction.create({
                data: {
                    ingredientId,
                    type,
                    quantity: qtyNum,
                    fromStore,
                    toStore,
                    notes,
                    userId
                }
            })
        })

        return NextResponse.json(result, { status: 201 })

    } catch (error: any) {
        console.error("Stock Transaction Failed:", error)
        return NextResponse.json({ error: error.message || 'Operation failed' }, { status: 500 })
    }
}

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url)
        const ingredientId = searchParams.get('ingredientId')

        const where: any = {}
        if (ingredientId) where.ingredientId = ingredientId

        const transactions = await prisma.stockTransaction.findMany({
            where,
            include: {
                ingredient: { select: { name: true, unit: true } }
            },
            orderBy: { createdAt: 'desc' }
        })

        return NextResponse.json(transactions)
    } catch (error) {
        return NextResponse.json({ error: 'Failed' }, { status: 500 })
    }
}
