/**
 * Adds the wine and the VIP set to a database that already has data.
 *
 * The same rows are in seedBarData.js, so a fresh seed produces them too. This
 * script exists because a reseed wipes every bill, shift and table, and the
 * point of adding one package is not worth losing a night of history for.
 *
 * Safe to run twice: everything is looked up by name first.
 *
 *   node prisma/addVipSet.js
 */
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const WINE = 'Wine (bottle)'

async function ensureIngredient() {
    const found = await prisma.ingredient.findFirst({ where: { name: WINE } })
    if (found) return found
    const category = await prisma.ingredientCategory.findFirst({ where: { name: 'Spirits' } })
    return prisma.ingredient.create({
        data: {
            name: WINE, unit: 'bottle', cost: 220,
            categoryId: category?.id ?? null,
            mainStock: 30, subStock: 15,
            minStock: 6, maxStock: 60,
            minStockSub: 3, maxStockSub: 15,
        },
    })
}

/** A menu item with one STANDARD size, which is what the till and a swap read. */
async function ensureMenu({ name, lao, categoryName, price, recipe }, ingredients) {
    const existing = await prisma.menu.findFirst({ where: { name } })
    if (existing) return existing

    const category = await prisma.category.findFirst({ where: { name: categoryName } })
    if (!category) throw new Error(`No category named ${categoryName}`)

    const menu = await prisma.menu.create({
        data: { name, localName: lao, categoryId: category.id, price },
    })
    for (const [ingredientName, quantity] of Object.entries(recipe)) {
        const ingredientId = ingredients[ingredientName]
        if (!ingredientId) throw new Error(`No ingredient named ${ingredientName}`)
        await prisma.recipe.create({ data: { menuId: menu.id, ingredientId, quantity } })
    }
    return menu
}

async function main() {
    await ensureIngredient()

    const rows = await prisma.ingredient.findMany({ select: { id: true, name: true } })
    const ingredients = Object.fromEntries(rows.map((r) => [r.name, r.id]))

    // Sold singly, which is the only reason wine can be swapped out of a set.
    await ensureMenu({
        name: WINE, lao: 'ເຫຼົ້າແວງ (ຂວດ)', categoryName: 'Spirits', price: 750,
        recipe: { [WINE]: 1 },
    }, ingredients)

    // Placeholder prices: they clear the pour-cost bands this project checks,
    // but the owner has the real wine cost and should replace both. Contents
    // are worth 960 on the menu and the set sells for 850, so trading down
    // leaves that margin with the bar.
    await ensureMenu({
        name: 'VIP Set', lao: 'ຊຸດ VIP', categoryName: 'Sets', price: 850,
        recipe: { [WINE]: 1, 'Beer Lao (bottle)': 2, 'Heineken (bottle)': 2, 'Ice (kg)': 2 },
    }, ingredients)

    const set = await prisma.menu.findFirst({
        where: { name: 'VIP Set' },
        include: { recipes: { include: { ingredient: true } } },
    })
    console.log('VIP Set', set.price, 'contains:')
    for (const r of set.recipes) console.log('  ', r.quantity, 'x', r.ingredient.name)
}

main()
    .catch((e) => { console.error(e); process.exit(1) })
    .finally(() => prisma.$disconnect())
