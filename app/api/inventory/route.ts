import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { BASE_UNIT, type MeasureType } from '@/lib/units'

// Inventory API routes

export async function GET(request: Request) {
    try {
        const ingredients = await prisma.ingredient.findMany({
            include: { category: true },
            orderBy: { name: 'asc' }
        })
        return NextResponse.json(ingredients)
    } catch (error) {
        return NextResponse.json({ error: 'Failed to fetch inventory' }, { status: 500 })
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json()
        const { name, unit, measureType, purchaseUnit, purchaseMultiplier,
                mainStock, minStock, maxStock, minStockSub, maxStockSub, cost } = body

        // Validate required fields
        if (!name || !(purchaseUnit || unit)) {
            return NextResponse.json({ error: 'Name and purchase unit are required' }, { status: 400 })
        }

        const mt: MeasureType = ['WEIGHT', 'VOLUME', 'EACH'].includes(measureType) ? measureType : 'EACH'
        // A whole-unit item buys and counts in the same thing, so its
        // multiplier is 1 by definition rather than by what a client sent.
        const multiplier = mt === 'EACH' ? 1 : Number(purchaseMultiplier)
        if (!Number.isFinite(multiplier) || multiplier <= 0) {
            return NextResponse.json({ error: 'MULTIPLIER_MUST_BE_POSITIVE' }, { status: 400 })
        }

        const ingredientData = {
            name,
            unit: unit || purchaseUnit,
            measureType: mt,
            // Derived from the measure type, never taken from the client.
            baseUnit: BASE_UNIT[mt],
            purchaseUnit: purchaseUnit || unit,
            purchaseMultiplier: multiplier,
            mainStock: parseFloat(mainStock) || 0,
            subStock: 0,
            minStock: parseFloat(minStock) || 0,
            maxStock: parseFloat(maxStock) || 0,
            minStockSub: parseFloat(minStockSub) || 0,
            maxStockSub: parseFloat(maxStockSub) || 0,
            cost: parseFloat(cost) || 0,
            categoryId: body.categoryId || null
        }

        const ingredient = await prisma.ingredient.create({
            data: ingredientData
        })

        return NextResponse.json(ingredient, { status: 201 })
    } catch (error) {
        console.error(error)
        return NextResponse.json({ error: 'Failed to create ingredient' }, { status: 500 })
    }
}
