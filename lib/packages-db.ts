import { prisma } from '@/lib/prisma'
import type { SellableMenu } from '@/lib/packages'

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
            recipes: { select: { ingredientId: true, quantity: true } },
            variations: {
                include: { sizes: { where: { isAvailable: true }, orderBy: { displayOrder: 'asc' } } },
            },
        },
        orderBy: { name: 'asc' },
    })

    return menus.map((m) => {
        const size = m.variations.flatMap((v) => v.sizes)[0]
        return {
            menuId: m.id,
            variationSizeId: size?.id ?? null,
            name: m.name,
            localName: m.localName,
            unitPrice: size?.price ?? 0,
            recipe: m.recipes.map((r) => ({ ingredientId: r.ingredientId, quantity: r.quantity })),
        }
    })
}
