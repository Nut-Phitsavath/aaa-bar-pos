import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(
    request: Request,
    { params }: { params: Promise<{ productId: string }> }
) {
    try {
        const { productId } = await params
        const recipes = await prisma.recipe.findMany({
            where: { menuId: productId },
            include: {
                ingredient: {
                    select: {
                        name: true,
                        unit: true,
                        baseUnit: true
                    }
                }
            }
        })

        const formatted = recipes.map(r => ({
            ...r,
            ingredientName: r.ingredient.name,
            // Recipe.quantity is in BASE units, so this is the unit that
            // describes it. Returning the legacy purchase unit made the screen
            // read "30 bottle" for a 30ml pour.
            unit: r.ingredient.baseUnit,
            purchaseUnit: r.ingredient.unit
        }))

        return NextResponse.json(formatted)
    } catch (error) {
        console.error(error)
        return NextResponse.json({ error: 'Failed to fetch recipe' }, { status: 500 })
    }
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ productId: string }> }
) {
    try {
        const { productId } = await params
        const { ingredientId, quantity } = await request.json()

        if (!ingredientId || !quantity) {
            return NextResponse.json({ error: 'Ingredient and quantity are required' }, { status: 400 })
        }

        // Look up any existing row for this item/ingredient pair, then update
        // or create - simpler than an upsert against a compound unique key.
        const existing = await prisma.recipe.findFirst({
            where: {
                menuId: productId,
                ingredientId
            }
        })

        let recipe;
        if (existing) {
            recipe = await prisma.recipe.update({
                where: { id: existing.id },
                data: { quantity: parseFloat(quantity.toString()) }
            })
        } else {
            recipe = await prisma.recipe.create({
                data: {
                    menuId: productId,
                    ingredientId,
                    quantity: parseFloat(quantity.toString())
                }
            })
        }

        return NextResponse.json({ success: true, recipe })
    } catch (error) {
        console.error(error)
        return NextResponse.json({ error: 'Failed to update recipe' }, { status: 500 })
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ productId: string }> }
) {
    try {
        const { productId } = await params
        const { searchParams } = new URL(request.url)
        const ingredientId = searchParams.get('ingredientId')

        if (!ingredientId) {
            return NextResponse.json({ error: 'Ingredient ID is required' }, { status: 400 })
        }

        await prisma.recipe.deleteMany({
            where: {
                menuId: productId,
                ingredientId
            }
        })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error(error)
        return NextResponse.json({ error: 'Failed to remove ingredient from recipe' }, { status: 500 })
    }
}
