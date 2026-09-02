import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// Inventory ID API routes

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const body = await request.json()
        const { name, unit, mainStock, subStock, minStock, maxStock, minStockSub, maxStockSub, cost } = body

        const updatedData = {
            name,
            unit,
            mainStock: parseFloat(mainStock?.toString() || "0"),
            subStock: parseFloat(subStock?.toString() || "0"),
            minStock: parseFloat(minStock?.toString() || "0"),
            maxStock: parseFloat(maxStock?.toString() || "0"),
            minStockSub: parseFloat(minStockSub?.toString() || "0"),
            maxStockSub: parseFloat(maxStockSub?.toString() || "0"),
            cost: parseFloat(cost?.toString() || "0"),
            categoryId: body.categoryId || null
        }

        const ingredient = await prisma.ingredient.update({
            where: { id },
            data: updatedData
        })

        return NextResponse.json({ success: true, ingredient })
    } catch (error) {
        console.error(error)
        return NextResponse.json({ error: 'Failed to update ingredient' }, { status: 500 })
    }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        await prisma.ingredient.delete({
            where: { id }
        })
        return NextResponse.json({ success: true })
    } catch (error) {
        console.error(error)
        return NextResponse.json({ error: 'Failed to delete ingredient' }, { status: 500 })
    }
}
