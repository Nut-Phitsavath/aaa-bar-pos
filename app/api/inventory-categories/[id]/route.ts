import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { name } = await request.json()
        const { id } = await params
        const trimmed = typeof name === 'string' ? name.trim() : ''
        if (!trimmed) return NextResponse.json({ error: 'Name is required' }, { status: 400 })

        const category = await prisma.ingredientCategory.update({
            where: { id },
            data: { name: trimmed }
        })
        return NextResponse.json(category)
    } catch (error: any) {
        // The name is unique. Saying so is the difference between a person
        // fixing the name and a person wondering what they broke - and the
        // rename editor now stays open on the row, so the message is read.
        if (error?.code === 'P2002') {
            return NextResponse.json({ error: 'CATEGORY_NAME_TAKEN' }, { status: 409 })
        }
        console.error(error)
        return NextResponse.json({ error: 'Failed to update category' }, { status: 500 })
    }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
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
