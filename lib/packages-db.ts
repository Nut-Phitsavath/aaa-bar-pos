import { prisma } from '@/lib/prisma'
import type { SellableMenu } from '@/lib/packages'
import type { MeasureType } from '@/lib/units'

/**
 * Every menu item, with the one price and the recipe a package swap needs.
 *
 * Kept out of lib/packages.ts so the arithmetic there stays pure and testable
 * without a database. The menu is a few dozen rows in this bar, so this is one
 * query each time rather than a cached index that goes stale the moment
 * somebody edits a price.
 */
export async function sellableMenus(): Promise<SellableMenu[]> {
    const menus = await prisma.menu.findMany({
        where: { isAvailable: true },
        include: {
            recipes: {
                select: {
                    ingredientId: true,
                    quantity: true,
                    ingredient: { select: { measureType: true } },
                },
            },
        },
        orderBy: { name: 'asc' },
    })

    return menus.map((m) => ({
        menuId: m.id,
        name: m.name,
        localName: m.localName,
        unitPrice: m.price,
        recipe: m.recipes.map((r) => ({
            ingredientId: r.ingredientId,
            quantity: r.quantity,
            measureType: r.ingredient.measureType as MeasureType,
        })),
    }))
}
