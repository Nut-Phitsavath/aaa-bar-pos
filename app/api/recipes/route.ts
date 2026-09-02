import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: Request) {
    try {
        const recipes = await prisma.recipe.findMany({
            include: {
                menu: { select: { name: true } },
                ingredient: { select: { name: true, unit: true } }
            },
            orderBy: [
                { menu: { name: 'asc' } },
                { ingredient: { name: 'asc' } }
            ]
        })

        const formattedRecipes = recipes.map(r => ({
            ...r,
            productName: r.menu.name,
            ingredientName: r.ingredient.name,
            unit: r.ingredient.unit
        }))

        return NextResponse.json(formattedRecipes)
    } catch (error) {
        console.error(error)
        return NextResponse.json({ error: 'Failed to fetch recipes' }, { status: 500 })
    }
}
