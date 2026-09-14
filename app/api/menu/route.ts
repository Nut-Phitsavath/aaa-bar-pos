import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url)
    const availableOnly = searchParams.get('availableOnly') === 'true'

    try {
        // Fetch all menus
        const menus = await prisma.menu.findMany({
            where: availableOnly ? { isAvailable: true } : {},
            include: {
                category: true,
                // So a screen can say when an item sells but deducts no stock,
                // without pulling every recipe row to find out.
                _count: { select: { recipes: true } }
            },
            // Category order first, then the item's own place inside it: the
            // till renders its chips from the order menus arrive in, so both
            // levels of the staff's arrangement come out of this one sort.
            // Name is the tiebreaker, which is also what everything looked like
            // before anyone dragged anything.
            orderBy: [
                { category: { displayOrder: 'asc' } },
                { displayOrder: 'asc' },
                { name: 'asc' },
            ]
        })

        // Transform for frontend compatibility
        const transformed = menus.map(menu => ({
            id: menu.id,
            name: menu.name,
            localName: menu.localName,
            description: menu.description,
            image: menu.image?.startsWith('/uploads/') ? menu.image.replace('/uploads/', '/api/uploads/') : menu.image,
            isAvailable: menu.isAvailable,
            category: menu.category?.name || "Uncategorized",
            categoryName: menu.category?.name || "Uncategorized",
            categoryId: menu.categoryId,
            hasSugarLevel: menu.category?.hasSugarLevel ?? false,
            hasShotType: menu.category?.hasShotType ?? false,
            // Zero means this item sells but deducts no stock. The response is
            // flattened rather than passed through, so this has to be carried
            // explicitly or the screens never see it.
            _count: menu._count,
            price: menu.price,
        }))

        return NextResponse.json(transformed)
    } catch (error) {
        console.error(error)
        return NextResponse.json({ error: 'Failed to fetch menu' }, { status: 500 })
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json()
        const { name, localName, description, category, image, isAvailable, price } = body

        if (!name) {
            return NextResponse.json({ error: 'Name is required' }, { status: 400 })
        }

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
            const firstCat = await prisma.category.findFirst()
            if (!firstCat) throw new Error("No categories found. Create a category first.")
            categoryId = firstCat.id
        }

        // Create menu
        const menu = await prisma.menu.create({
            data: {
                name,
                localName,
                description,
                categoryId,
                image: image || '/placeholder.svg',
                isAvailable: isAvailable ?? true,
                // A missing price on create means "not priced yet" — same as
                // the column's own default — rather than silently rejecting
                // the request or coercing NaN into the database.
                price: price !== undefined && price !== null ? parseFloat(price.toString()) : 0
            }
        })

        return NextResponse.json(menu, { status: 201 })
    } catch (error) {
        console.error(error)
        return NextResponse.json({ error: 'Failed to create menu' }, { status: 500 })
    }
}
