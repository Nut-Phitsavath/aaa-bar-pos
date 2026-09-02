
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
    console.log("Starting update...")

    // Update Variation Types
    // HOT -> 1, ICE -> 2, FRAPPE -> 3
    await prisma.menuVariation.updateMany({ where: { type: 'HOT' }, data: { displayOrder: 1 } })
    await prisma.menuVariation.updateMany({ where: { type: 'ICE' }, data: { displayOrder: 2, type: 'ICED' } })
    await prisma.menuVariation.updateMany({ where: { type: 'ICED' }, data: { displayOrder: 2 } })
    await prisma.menuVariation.updateMany({ where: { type: 'COLD' }, data: { displayOrder: 2 } })
    await prisma.menuVariation.updateMany({ where: { type: 'FRAPPE' }, data: { displayOrder: 3 } })
    await prisma.menuVariation.updateMany({ where: { type: 'SMOOTHIE' }, data: { displayOrder: 4 } })

    // Update Sizes
    // S -> 1, M -> 2, L -> 3
    await prisma.variationSize.updateMany({ where: { size: 'S' }, data: { displayOrder: 1 } })
    await prisma.variationSize.updateMany({ where: { size: 'M' }, data: { displayOrder: 2 } })
    await prisma.variationSize.updateMany({ where: { size: 'L' }, data: { displayOrder: 3 } })

    console.log("Updated display orders.")

    console.log("Checking ALL menu variations...")
    const vars = await prisma.menuVariation.findMany({ select: { type: true, displayOrder: true } })
    console.log(vars)

    // Check Categories
    const menus = await prisma.menu.findMany({ include: { category: true } })
    console.log(`Found ${menus.length} menus.`)
    for (const menu of menus) {
        if (!menu.category) {
            console.log(`Menu ${menu.name} has no category!`)
        }
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect())
