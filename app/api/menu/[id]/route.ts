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

        await prisma.menu.update({
            where: { id },
            data: {
                name,
                localName,
                description,
                categoryId,
                image: image || '/placeholder.svg',
                isAvailable: isAvailable ?? true,
                // A missing price keeps the item's current price rather than
                // silently zeroing it out — unlike category/isAvailable above,
                // a dropped price is a real financial change, not just a
                // fallback. `undefined` here is simply omitted from the SQL
                // UPDATE, so this is an atomic "leave price alone" with no
                // read-then-write race against a concurrent price update.
                // Explicit 0 is a real, settable price ("not priced yet"),
                // so this stays a strict undefined/null check, not truthy.
                price: price !== undefined && price !== null ? parseFloat(price.toString()) : undefined
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

        // Recipes are deleted explicitly because they are the menu item's own
        // rows. OrderItem is left alone: menuId carries no database-level
        // foreign key, so deleting a menu item leaves that column pointing at
        // an id that is gone rather than nulling it. Historical lines survive
        // either way -- name and price are snapshotted onto the row at sale
        // time, and every read site guards for a missing menu.
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
