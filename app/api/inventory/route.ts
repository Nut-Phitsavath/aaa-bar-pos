import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

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
        const { name, unit, mainStock, minStock, maxStock, minStockSub, maxStockSub, cost } = body

        // Validate required fields
        if (!name || !unit) {
            return NextResponse.json({ error: 'Name and unit are required' }, { status: 400 })
        }

        const ingredientData = {
            name,
            unit,
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
