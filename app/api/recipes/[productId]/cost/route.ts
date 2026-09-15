import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { recipeCost, pourCost, bandFor, verdictFor } from '@/lib/pour-cost'

export const dynamic = 'force-dynamic'

/**
 * What one serving costs, and whether the price makes sense.
 *
 * Computed per request rather than stored, so a change to an ingredient's cost
 * shows up the next time anyone opens the recipe - a stored figure would be
 * wrong from the first delivery at a new price and nothing would say so.
 */
export async function GET(
    request: Request,
    { params }: { params: Promise<{ productId: string }> }
) {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    try {
        const { productId } = await params

        const menu = await prisma.menu.findUnique({
            where: { id: productId },
            include: {
                category: { select: { name: true } },
            },
        })
        if (!menu) return NextResponse.json({ error: 'Not found' }, { status: 404 })

        // The same rule the order path deducts by, so the cost shown is the
        // cost of what actually leaves the shelf.
        const recipes = await prisma.recipe.findMany({
            where: { menuId: productId },
            include: {
                ingredient: { select: { name: true, cost: true, purchaseMultiplier: true, baseUnit: true } },
            },
        })

        const lines = recipes.map((r) => ({
            name: r.ingredient.name,
            quantity: r.quantity,
            baseUnit: r.ingredient.baseUnit,
            costPerPurchaseUnit: r.ingredient.cost,
            purchaseMultiplier: r.ingredient.purchaseMultiplier,
            // Per-row cost, so the screen can show where the money goes rather
            // than only a total the manager has to take on trust.
            cost: recipeCost([{
                quantity: r.quantity,
                costPerPurchaseUnit: r.ingredient.cost,
                purchaseMultiplier: r.ingredient.purchaseMultiplier,
            }]),
        }))

        const cost = recipeCost(lines)

        const price = menu.price
        const pct = pourCost(cost, price)

        return NextResponse.json({
            cost,
            price,
            margin: Math.round((price - cost) * 100) / 100,
            pourCostPct: pct,
            band: bandFor(menu.category?.name),
            verdict: verdictFor(menu.category?.name, pct),
            // Empty when the item deducts no stock at all, which is the
            // "no recipe" case the menu list flags.
            lines,
        })
    } catch (error) {
        console.error('[recipe cost] GET failed', error)
        return NextResponse.json({ error: 'Failed to compute cost' }, { status: 500 })
    }
}
