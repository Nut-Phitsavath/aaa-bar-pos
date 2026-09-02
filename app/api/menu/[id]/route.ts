import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const body = await request.json()
        const { name, localName, description, category, image, isAvailable, variations } = body

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

        await prisma.$transaction(async (tx) => {
            // 1. Update Menu
            await tx.menu.update({
                where: { id },
                data: {
                    name,
                    localName,
                    description,
                    categoryId,
                    image: image || '/placeholder.svg',
                    isAvailable: isAvailable ?? true
                }
            })

            // 2. Handle Variations
            if (variations && Array.isArray(variations)) {
                for (const v of variations) {
                    let variationId = v.id

                    if (variationId) {
                        // Update existing variation
                        await tx.menuVariation.update({
                            where: { id: variationId },
                            data: {
                                isEnabled: v.isEnabled,
                                displayOrder: parseInt(v.displayOrder?.toString() || "0")
                            }
                        })
                    } else {
                        // Create new variation
                        const newVar = await tx.menuVariation.create({
                            data: {
                                menuId: id,
                                type: v.type,
                                isEnabled: v.isEnabled,
                                displayOrder: parseInt(v.displayOrder?.toString() || "0")
                            }
                        })
                        variationId = newVar.id
                    }

                    // 3. Handle Sizes
                    if (v.sizes && Array.isArray(v.sizes)) {
                        // Get current IDs to identify deletions
                        const currentSizes = await tx.variationSize.findMany({
                            where: { variationId },
                            select: { id: true }
                        })
                        const currentSizeIds = currentSizes.map(s => s.id)
                        const payloadSizeIds = v.sizes.filter((s: any) => s.id).map((s: any) => s.id)

                        // Delete removed sizes
                        const toDelete = currentSizeIds.filter(cid => !payloadSizeIds.includes(cid))
                        if (toDelete.length > 0) {
                            try {
                                await tx.variationSize.deleteMany({
                                    where: { id: { in: toDelete } }
                                })
                            } catch (e) {
                                console.warn(`Could not delete sizes ${toDelete}: maybe used in orders?`, e)
                                // Optional: mark as unavailable instead?
                                // await tx.variationSize.updateMany({ where: { id: { in: toDelete } }, data: { isAvailable: false } })
                            }
                        }

                        // Upsert sizes
                        for (const s of v.sizes) {
                            if (s.id) {
                                await tx.variationSize.update({
                                    where: { id: s.id },
                                    data: {
                                        size: s.size,
                                        price: parseFloat(s.price.toString()),
                                        isAvailable: s.isAvailable ?? true,
                                        displayOrder: parseInt(s.displayOrder?.toString() || "0")
                                    }
                                })
                            } else {
                                await tx.variationSize.create({
                                    data: {
                                        variationId,
                                        size: s.size,
                                        price: parseFloat(s.price.toString()),
                                        isAvailable: s.isAvailable ?? true,
                                        displayOrder: parseInt(s.displayOrder?.toString() || "0")
                                    }
                                })
                            }
                        }
                    }
                }
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
