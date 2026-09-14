import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const body = await request.json()
        const { name, localName, description, category, image, isAvailable, price } = body

        // Find or Create Category
        let categoryId: string
        if (category) {
            const existingCat = await prisma.category.findFirst({
                where: { name: category }
            })
            if (existingCat) {
                categoryId = existingCat.id
            } else {
                const newCat = await prisma.category.create({
                    data: { name: category }
                })
                categoryId = newCat.id
            }
        } else {
            // Fallback or error?
            // Assuming category is required or we keep existing.
            // If not provided, maybe we shouldn't update it?
            // But UI sends it.
            const current = await prisma.menu.findUnique({ where: { id } })
            categoryId = current?.categoryId!
        }

        // A missing price on update keeps the item's current price rather
        // than silently zeroing it out — unlike category/isAvailable above,
        // a dropped price is a real financial change, not just a fallback.
        let resolvedPrice: number
        if (price !== undefined && price !== null) {
            resolvedPrice = parseFloat(price.toString())
        } else {
            const current = await prisma.menu.findUnique({ where: { id }, select: { price: true } })
            resolvedPrice = current?.price ?? 0
        }

        await prisma.menu.update({
            where: { id },
            data: {
                name,
                localName,
                description,
                categoryId,
                image: image || '/placeholder.svg',
                isAvailable: isAvailable ?? true,
                price: resolvedPrice
            }
        })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error(error)
        return NextResponse.json({ error: 'Failed to update menu' }, { status: 500 })
    }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params

        const existing = await prisma.menu.findUnique({ where: { id } })
        if (!existing) {
            return NextResponse.json({ error: 'Menu not found' }, { status: 404 })
        }

        // Recipes cascade from Menu; OrderItem.variationSizeId is SetNull so
        // historical orders keep their name/price snapshots after menu deletion.
        await prisma.$transaction(async (tx) => {
            await tx.recipe.deleteMany({ where: { menuId: id } })
            await tx.menu.delete({ where: { id } })
        })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error(error)
        return NextResponse.json({ error: 'Failed to delete menu' }, { status: 500 })
    }
}
