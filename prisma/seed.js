const { PrismaClient } = require("@prisma/client")
const { subDays, startOfDay, addMinutes, addHours } = require("date-fns")
const bcrypt = require("bcryptjs")

const prisma = new PrismaClient()

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getRandomItem(array) {
    return array[Math.floor(Math.random() * array.length)];
}

async function main() {
    console.log("Emptying database...")
    await prisma.orderItem.deleteMany({})
    await prisma.order.deleteMany({})
    await prisma.shift.deleteMany({})
    await prisma.variationSize.deleteMany({})
    await prisma.menuVariation.deleteMany({})
    await prisma.recipe.deleteMany({})
    await prisma.menu.deleteMany({})
    await prisma.category.deleteMany({})
    await prisma.ingredient.deleteMany({})
    await prisma.customer.deleteMany({})
    await prisma.promotion.deleteMany({})
    await prisma.user.deleteMany({})

    // ========== SEED USERS ==========
    console.log("Seeding users...")
    const adminPin = await bcrypt.hash("1234", 10)
    const cashierPin = await bcrypt.hash("5678", 10)
    const staffPin = await bcrypt.hash("0000", 10)

    await prisma.user.createMany({
        data: [
            { name: "Admin", role: "ADMIN", pin: adminPin },
            { name: "Cashier", role: "CASHIER", pin: cashierPin },
            { name: "Staff", role: "STAFF", pin: staffPin }
        ]
    })

    console.log("Seeding categories...")
    const coffee = await prisma.category.create({ data: { name: "Coffee" } })
    const nonCoffee = await prisma.category.create({ data: { name: "Non-Coffee" } })
    const pastries = await prisma.category.create({ data: { name: "Pastries" } })
    const food = await prisma.category.create({ data: { name: "Food" } })

    console.log("Seeding ingredients...")
    const ingredientsData = [
        { name: "Coffee Beans", unit: "kg", mainStock: 100, subStock: 50, minStock: 5, maxStock: 200, cost: 150000 },
        { name: "Fresh Milk", unit: "L", mainStock: 200, subStock: 100, minStock: 10, maxStock: 400, cost: 25000 },
        { name: "Sugar Syrup", unit: "L", mainStock: 50, subStock: 20, minStock: 2, maxStock: 100, cost: 35000 },
        { name: "Matcha Powder", unit: "kg", mainStock: 10, subStock: 5, minStock: 1, maxStock: 20, cost: 450000 },
        { name: "Flour", unit: "kg", mainStock: 100, subStock: 50, minStock: 10, maxStock: 200, cost: 20000 },
        { name: "Butter", unit: "kg", mainStock: 40, subStock: 20, minStock: 5, maxStock: 80, cost: 180000 },
        { name: "Cocoa Powder", unit: "kg", mainStock: 20, subStock: 10, minStock: 2, maxStock: 40, cost: 200000 },
        { name: "Orange Juice", unit: "L", mainStock: 60, subStock: 30, minStock: 5, maxStock: 120, cost: 30000 }
    ]

    const ingredients = {}
    for (const data of ingredientsData) {
        ingredients[data.name] = await prisma.ingredient.create({ data })
    }

    // ========== SEED MENUS WITH HIERARCHICAL PRICING ==========
    console.log("Seeding menus with variations and sizes...")

    // Helper function to create menu with variations and sizes
    async function createMenu(name, categoryId, image, variations) {
        const menu = await prisma.menu.create({
            data: {
                name,
                categoryId,
                image
            }
        })

        for (const varData of variations) {
            const variation = await prisma.menuVariation.create({
                data: {
                    menuId: menu.id,
                    type: varData.type,
                    isEnabled: varData.isEnabled !== false,
                    displayOrder: varData.displayOrder || 0
                }
            })

            // Create sizes for this variation
            for (const sizeData of varData.sizes) {
                await prisma.variationSize.create({
                    data: {
                        variationId: variation.id,
                        size: sizeData.size,
                        price: sizeData.price,
                        displayOrder: sizeData.displayOrder || 0
                    }
                })
            }
        }

        return menu
    }

    // Latte - All variations enabled
    const latte = await createMenu("Latte", coffee.id, "https://images.unsplash.com/photo-1536939459926-301728717817?w=400", [
        {
            type: "HOT",
            sizes: [
                { size: "S", price: 28000, displayOrder: 1 },
                { size: "M", price: 35000, displayOrder: 2 },
                { size: "L", price: 42000, displayOrder: 3 }
            ],
            displayOrder: 1
        },
        {
            type: "COLD",
            sizes: [
                { size: "S", price: 30000, displayOrder: 1 },
                { size: "M", price: 38000, displayOrder: 2 },
                { size: "L", price: 46000, displayOrder: 3 }
            ],
            displayOrder: 2
        },
        {
            type: "FRAPPE",
            sizes: [
                { size: "S", price: 35000, displayOrder: 1 },
                { size: "M", price: 45000, displayOrder: 2 },
                { size: "L", price: 55000, displayOrder: 3 }
            ],
            displayOrder: 3
        }
    ])

    // Cappuccino - Only Hot and Cold
    const cappuccino = await createMenu("Cappuccino", coffee.id, "https://images.unsplash.com/photo-1572442388796-11668a67e53d?w=400", [
        {
            type: "HOT",
            sizes: [
                { size: "S", price: 28000, displayOrder: 1 },
                { size: "M", price: 35000, displayOrder: 2 },
                { size: "L", price: 42000, displayOrder: 3 }
            ],
            displayOrder: 1
        },
        {
            type: "COLD",
            sizes: [
                { size: "S", price: 30000, displayOrder: 1 },
                { size: "M", price: 38000, displayOrder: 2 },
                { size: "L", price: 46000, displayOrder: 3 }
            ],
            displayOrder: 2
        }
    ])

    // Mocha - All variations
    const mocha = await createMenu("Mocha", coffee.id, "https://images.unsplash.com/photo-1572442388796-11668a67e53d?w=400", [
        {
            type: "HOT",
            sizes: [
                { size: "S", price: 32000, displayOrder: 1 },
                { size: "M", price: 40000, displayOrder: 2 },
                { size: "L", price: 48000, displayOrder: 3 }
            ],
            displayOrder: 1
        },
        {
            type: "COLD",
            sizes: [
                { size: "S", price: 35000, displayOrder: 1 },
                { size: "M", price: 44000, displayOrder: 2 },
                { size: "L", price: 53000, displayOrder: 3 }
            ],
            displayOrder: 2
        },
        {
            type: "FRAPPE",
            sizes: [
                { size: "S", price: 40000, displayOrder: 1 },
                { size: "M", price: 52000, displayOrder: 2 },
                { size: "L", price: 64000, displayOrder: 3 }
            ],
            displayOrder: 3
        }
    ])

    // Cocoa - All variations
    const cocoa = await createMenu("Cocoa", nonCoffee.id, "https://images.unsplash.com/photo-1544787210-2211d7c929c7?w=400", [
        {
            type: "HOT",
            sizes: [
                { size: "S", price: 30000, displayOrder: 1 },
                { size: "M", price: 38000, displayOrder: 2 },
                { size: "L", price: 46000, displayOrder: 3 }
            ],
            displayOrder: 1
        },
        {
            type: "COLD",
            sizes: [
                { size: "S", price: 33000, displayOrder: 1 },
                { size: "M", price: 42000, displayOrder: 2 },
                { size: "L", price: 51000, displayOrder: 3 }
            ],
            displayOrder: 2
        },
        {
            type: "FRAPPE",
            sizes: [
                { size: "S", price: 38000, displayOrder: 1 },
                { size: "M", price: 50000, displayOrder: 2 },
                { size: "L", price: 62000, displayOrder: 3 }
            ],
            displayOrder: 3
        }
    ])

    // Matcha Latte - All variations
    const matcha = await createMenu("Matcha Latte", nonCoffee.id, "https://images.unsplash.com/photo-1515823064-d6e0c04616a7?w=400", [
        {
            type: "HOT",
            sizes: [
                { size: "S", price: 35000, displayOrder: 1 },
                { size: "M", price: 45000, displayOrder: 2 },
                { size: "L", price: 55000, displayOrder: 3 }
            ],
            displayOrder: 1
        },
        {
            type: "COLD",
            sizes: [
                { size: "S", price: 38000, displayOrder: 1 },
                { size: "M", price: 50000, displayOrder: 2 },
                { size: "L", price: 62000, displayOrder: 3 }
            ],
            displayOrder: 2
        },
        {
            type: "FRAPPE",
            sizes: [
                { size: "S", price: 43000, displayOrder: 1 },
                { size: "M", price: 58000, displayOrder: 2 },
                { size: "L", price: 73000, displayOrder: 3 }
            ],
            displayOrder: 3
        }
    ])

    // Americano - Only Hot and Cold (no Frappe)
    const americano = await createMenu("Americano", coffee.id, "https://images.unsplash.com/photo-1551030173-122adba81f3a?w=400", [
        {
            type: "HOT",
            sizes: [
                { size: "S", price: 24000, displayOrder: 1 },
                { size: "M", price: 30000, displayOrder: 2 },
                { size: "L", price: 36000, displayOrder: 3 }
            ],
            displayOrder: 1
        },
        {
            type: "COLD",
            sizes: [
                { size: "S", price: 26000, displayOrder: 1 },
                { size: "M", price: 33000, displayOrder: 2 },
                { size: "L", price: 40000, displayOrder: 3 }
            ],
            displayOrder: 2
        }
    ])

    // Espresso - Only Hot (single size)
    const espresso = await createMenu("Espresso", coffee.id, "https://images.unsplash.com/photo-1510591509098-f4fdc6d0ff04?w=400", [
        {
            type: "HOT",
            sizes: [
                { size: "S", price: 20000, displayOrder: 1 },
                { size: "M", price: 25000, displayOrder: 2 }
            ],
            displayOrder: 1
        }
    ])

    // Croissant - No variations (food item)
    const croissant = await createMenu("Butter Croissant", pastries.id, "https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=400", [
        {
            type: "HOT",
            sizes: [
                { size: "M", price: 25000, displayOrder: 1 }
            ],
            displayOrder: 1
        }
    ])

    // Sandwich - No variations (food item)
    const sandwich = await createMenu("Club Sandwich", food.id, "https://images.unsplash.com/photo-1528735602780-2552fd46c7af?w=400", [
        {
            type: "HOT",
            sizes: [
                { size: "M", price: 55000, displayOrder: 1 }
            ],
            displayOrder: 1
        }
    ])

    console.log("Seeding recipes...")
    const recipes = [
        { menuName: "Espresso", ingredient: "Coffee Beans", quantity: 0.02 },
        { menuName: "Latte", ingredient: "Coffee Beans", quantity: 0.02 },
        { menuName: "Latte", ingredient: "Fresh Milk", quantity: 0.2 },
        { menuName: "Matcha Latte", ingredient: "Matcha Powder", quantity: 0.015 },
        { menuName: "Matcha Latte", ingredient: "Fresh Milk", quantity: 0.2 },
        { menuName: "Butter Croissant", ingredient: "Flour", quantity: 0.1 },
        { menuName: "Butter Croissant", ingredient: "Butter", quantity: 0.05 },
        { menuName: "Mocha", ingredient: "Coffee Beans", quantity: 0.02 },
        { menuName: "Mocha", ingredient: "Cocoa Powder", quantity: 0.01 },
        { menuName: "Mocha", ingredient: "Fresh Milk", quantity: 0.15 }
    ]

    const menus = { "Latte": latte, "Mocha": mocha, "Cocoa": cocoa, "Matcha Latte": matcha, "Americano": americano, "Espresso": espresso, "Butter Croissant": croissant, "Cappuccino": cappuccino }

    for (const r of recipes) {
        const menu = menus[r.menuName]
        const ingredient = ingredients[r.ingredient]
        if (menu && ingredient) {
            await prisma.recipe.create({
                data: {
                    menuId: menu.id,
                    ingredientId: ingredient.id,
                    quantity: r.quantity
                }
            })
        }
    }

    console.log("Seeding customers...")
    const customersData = [
        { name: "John Doe", phone: "020 5555 1234", email: "john@example.com", loyaltyPoints: 150, totalSpent: 450000, visitCount: 15, type: "NORMAL" },
        { name: "Jane Smith", phone: "020 5555 5678", loyaltyPoints: 80, totalSpent: 240000, visitCount: 8, type: "NORMAL" },
        { name: "Bob Wilson", phone: "020 5555 9012", loyaltyPoints: 200, totalSpent: 600000, visitCount: 20, type: "NORMAL" },
        { name: "Owner VIP", phone: "000 000 0000", loyaltyPoints: 0, totalSpent: 0, visitCount: 0, type: "COMPLIMENTARY" }
    ]

    const customers = []
    for (const data of customersData) {
        customers.push(await prisma.customer.create({ data }))
    }

    console.log("Seeding promotions...")
    const now = new Date()
    const promos = [
        {
            name: "New Year Sale",
            code: "NY2024",
            description: "10% off all orders",
            discountType: "percentage",
            discountValue: 10,
            startDate: subDays(now, 30),
            endDate: new Date(now.getFullYear(), 11, 31),
            isActive: true
        },
        {
            name: "Loyalty Bonus",
            code: "LOYAL50",
            description: "50,000 LAK off",
            discountType: "fixed",
            discountValue: 50000,
            startDate: subDays(now, 60),
            endDate: new Date(now.getFullYear() + 1, 5, 30),
            isActive: true
        }
    ]

    for (const p of promos) {
        await prisma.promotion.create({ data: p })
    }

    // ========== SEED ORDERS ==========
    console.log("Seeding ~400 orders for the last 90 days...")
    const allSizes = await prisma.variationSize.findMany({
        include: {
            variation: {
                include: { menu: true }
            }
        }
    })

    const ordersData = []

    for (let i = 0; i < 400; i++) {
        // Random date in last 90 days
        const orderDate = subDays(now, getRandomInt(0, 90))
        const hour = getRandomInt(8, 20)
        const minute = getRandomInt(0, 59)
        const finalDate = addMinutes(addHours(startOfDay(orderDate), hour), minute)

        const itemCount = getRandomInt(1, 4)
        let subtotal = 0
        const itemsToCreate = []

        for (let j = 0; j < itemCount; j++) {
            const size = getRandomItem(allSizes)
            const qty = getRandomInt(1, 2)
            const itemTotal = size.price * qty
            subtotal += itemTotal

            itemsToCreate.push({
                variationSizeId: size.id,
                name: `${size.variation.menu.name} (${size.variation.type}) - ${size.size}`,
                price: size.price,
                quantity: qty,
                total: itemTotal,
                sugarLevel: getRandomItem(["Normal", "Less Sweet", "No Sweet", "Extra Sweet"]),
                shotType: getRandomItem(["Normal", "Double", "Reduced"])
            })
        }

        const tax = Math.round(subtotal * 0.1)
        const total = subtotal + tax

        ordersData.push({
            finalDate,
            subtotal,
            tax,
            total,
            itemsToCreate
        })
    }

    // Sort by date to assign sequential numbers correctly
    ordersData.sort((a, b) => a.finalDate - b.finalDate)

    const dailyCounters = {}

    for (const order of ordersData) {
        const dayKey = order.finalDate.toISOString().split('T')[0]
        if (!dailyCounters[dayKey]) dailyCounters[dayKey] = 0
        dailyCounters[dayKey]++

        const orderNum = `No. ${dailyCounters[dayKey]}`

        await prisma.order.create({
            data: {
                orderNumber: orderNum,
                status: 'COMPLETED',
                subtotal: order.subtotal,
                tax: order.tax,
                total: order.total,
                taxAmount: order.tax,
                createdAt: order.finalDate,
                updatedAt: order.finalDate,
                isReportable: true,
                paymentMethod: getRandomItem(['CASH', 'TRANSFER']),
                items: {
                    create: order.itemsToCreate
                }
            }
        })
    }

    console.log("Seeding completed successfully!")
}

main()
    .catch(e => {
        console.error(e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
