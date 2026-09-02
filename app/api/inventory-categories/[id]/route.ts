import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function PUT(request: Request, { params }: { params: { id: string } }) {
    try {
        const { name } = await request.json()
        const id = (await params).id;
        if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })

        const category = await prisma.ingredientCategory.update({
            where: { id },
            data: { name }
        })
        return NextResponse.json(category)
    } catch (error) {
        console.error(error)
        return NextResponse.json({ error: 'Failed to update category' }, { status: 500 })
    }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
    try {
        const id = (await params).id;
        // Optionally handle ingredients in this category (make them null)
        await prisma.ingredient.updateMany({
            where: { categoryId: id },
            data: { categoryId: null }
        })

        await prisma.ingredientCategory.delete({
            where: { id }
        })
        return NextResponse.json({ success: true })
    } catch (error) {
        console.error(error)
        return NextResponse.json({ error: 'Failed to delete category' }, { status: 500 })
    }
}
