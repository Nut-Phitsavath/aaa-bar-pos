import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
    console.log("🚀 Starting POS Logic Verification...")

    // 1. Setup Test Data
    const category = await prisma.category.create({ data: { name: "Test Drinks" } })
    const menu = await prisma.menu.create({ 
        data: { name: "Test Latte", categoryId: category.id } 
    })
    const variationHot = await prisma.menuVariation.create({ 
        data: { menuId: menu.id, type: "HOT" } 
    })
    const sizeM = await prisma.variationSize.create({ 
        data: { variationId: variationHot.id, size: "M", price: 30000 } 
    })
    const ingred = await prisma.ingredient.create({ 
        data: { 
            name: "Milk", 
            unit: "ml", 
            mainStock: 1000, 
            subStock: 1000, 
            minStock: 10, 
            maxStock: 5000, 
            cost: 10 
        } 
    })

    // 2. Setup Recipes (2-Tier Test)
    // Tier 1: Base (100ml)
    const baseRecipe = await prisma.recipe.create({ 
        data: { menuId: menu.id, ingredientId: ingred.id, quantity: 100 } 
    })
    // Tier 2: Size Specific (50ml for Size M) 
    const sizeRecipe = await prisma.recipe.create({ 
        data: { menuId: menu.id, variationSizeId: sizeM.id, ingredientId: ingred.id, quantity: 50 } 
    })

    console.log("✅ 2-Tier Test Data Initialized. Expected Deduction: 100 + 50 = 150ml")

    // 3. Open Shift
    const shift = await prisma.shift.create({ data: { startCash: 100000, status: 'OPEN' } })
    console.log(`✅ Shift Opened. Expected Cash in Drawer: 100000`)

    // 4. Simulate Checkout (M)
    // We expect 150ml (100 + 50) deduction
    console.log("🛒 Checking out 1x Test Latte (M)...")
    
    // Simulating the logic in app/api/orders/route.ts
    await prisma.$transaction(async (tx) => {
        // Find ALL recipes for this item in one query
        const applicableRecipes = await tx.recipe.findMany({
            where: {
                menuId: menu.id,
                OR: [
                    { variationSizeId: null }, // Base
                    { variationSizeId: sizeM.id } // Specific Choice
                ]
            }
        })

        // 150ml should be deducted
        for (const r of applicableRecipes) {
            await tx.ingredient.update({
                where: { id: r.ingredientId },
                data: { subStock: { decrement: r.quantity } }
            })
        }

        // Update shift cash
        await tx.shift.update({
            where: { id: shift.id },
            data: { cashPayments: { increment: sizeM.price } }
        })

        // Create order
        await tx.order.create({
            data: {
                orderNumber: "TEST-001",
                total: sizeM.price,
                subtotal: sizeM.price,
                tax: 0,
                status: "COMPLETED",
                items: {
                    create: {
                        variationSizeId: sizeM.id,
                        name: "Test Latte (M)",
                        price: sizeM.price,
                        quantity: 1,
                        total: sizeM.price
                    }
                }
            }
        })
    })

    // 5. Verify Results
    const finalIngred = await prisma.ingredient.findUnique({ where: { id: ingred.id } })
    const finalShift = await prisma.shift.findUnique({ where: { id: shift.id } })

    console.log(`📊 Stock Verification: Before (1000) -> After (${finalIngred?.subStock})`)
    if (finalIngred?.subStock === 850) {
        console.log("✅ SUCCESS: 2-Tier Recipe Summation (100+50) correctly deducted 150ml.")
    } else {
        console.log("❌ FAILURE: Incorrect stock deduction.")
    }

    console.log(`💰 Shift Verification: Expected (100k + 30k) -> Actual (${(finalShift?.startCash || 0) + (finalShift?.cashPayments || 0)})`)
    if ((finalShift?.cashPayments || 0) === 30000) {
        console.log("✅ SUCCESS: Cash drawer incremented correctly.")
    } else {
        console.log("❌ FAILURE: Incorrect cash tracking.")
    }

    // 6. Cleanup
    await prisma.recipe.deleteMany({ where: { menuId: menu.id } })
    await prisma.variationSize.delete({ where: { id: sizeM.id } })
    await prisma.menuVariation.delete({ where: { id: variationHot.id } })
    await prisma.orderItem.deleteMany({ where: { name: "Test Latte (M)" } })
    await prisma.order.deleteMany({ where: { orderNumber: "TEST-001" } })
    await prisma.menu.delete({ where: { id: menu.id } })
    await prisma.category.delete({ where: { id: category.id } })
    await prisma.ingredient.delete({ where: { id: ingred.id } })
    await prisma.shift.delete({ where: { id: shift.id } })

    console.log("🧹 Cleanup Complete.")
}

main()
    .catch((e) => {
        console.error(e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
