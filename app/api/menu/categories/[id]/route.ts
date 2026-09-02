import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const { name, hasSugarLevel, hasShotType } = await request.json()

        if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 })

        const category = await prisma.category.update({
            where: { id },
            data: {
                name,
                hasSugarLevel: Boolean(hasSugarLevel),
                hasShotType: Boolean(hasShotType)
            }
        })

        return NextResponse.json(category)
    } catch (error) {
        console.error(error)
        return NextResponse.json({ error: 'Failed to update category' }, { status: 500 })
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params

        // Check if there are any menu items in this category
        const menuCount = await prisma.menu.count({
            where: { categoryId: id }
        })

        if (menuCount > 0) {
            return NextResponse.json({
                error: 'Cannot delete category with existing menu items. Please reassign or delete the items first.'
            }, { status: 400 })
        }

        await prisma.category.delete({
            where: { id }
        })

        return NextResponse.json({ message: 'Category deleted' })
    } catch (error) {
        console.error(error)
        return NextResponse.json({ error: 'Failed to delete category' }, { status: 500 })
    }
}
