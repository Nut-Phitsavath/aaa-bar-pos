// ============================================================
// seedDeployData.js — Clean seed for PRODUCTION DEPLOYMENT
// No mock orders, no fake stock transactions.
// Run once on a fresh database on the POS machine.
// ============================================================
const { PrismaClient } = require("@prisma/client")
const { subDays } = require("date-fns")
const bcrypt = require("bcryptjs")

const prisma = new PrismaClient()

async function main() {
    const now = new Date()
    console.log("Emptying database...")
    await prisma.orderItem.deleteMany({})
    await prisma.order.deleteMany({})
    await prisma.shift.deleteMany({})
    await prisma.variationSize.deleteMany({})
    await prisma.menuVariation.deleteMany({})
    await prisma.recipe.deleteMany({})
    await prisma.menu.deleteMany({})
    await prisma.category.deleteMany({})
    await prisma.stockCount.deleteMany({})
    await prisma.stockTransaction.deleteMany({})
    await prisma.ingredient.deleteMany({})
    await prisma.customer.deleteMany({})
    await prisma.promotion.deleteMany({})
    await prisma.setting.deleteMany({})
    await prisma.user.deleteMany({})

    // ========== SEED USERS ==========
    console.log("Seeding users...")
    const nguyenPin = await bcrypt.hash("1675", 10)
    const keePin = await bcrypt.hash("3978", 10)
    const johnyPin = await bcrypt.hash("2267", 10)
    const mousePin = await bcrypt.hash("9852", 10)
    const ouiPin = await bcrypt.hash("1067", 10)

    await prisma.user.createMany({
        data: [
            { name: "ແມ່ອ໋ຽນ", username: "admin", role: "ADMIN", pin: nguyenPin },
            { name: "ກີ້", username: "staff1", role: "STAFF", pin: keePin },
            { name: "ຈອນນີ້", username: "staff2", role: "STAFF", pin: johnyPin },
            { name: "ເມົ້າ", username: "staff3", role: "STAFF", pin: mousePin },
            { name: "ອຸ້ຍ", username: "staff4", role: "STAFF", pin: ouiPin }
        ]
    })

    // ========== CATEGORIES ==========
    console.log("Seeding categories...")
    const categories = {
        Coffee: await prisma.category.create({ data: { name: "Coffee (ກາແຟ)", hasSugarLevel: true, hasShotType: true } }),
        NonCoffee: await prisma.category.create({ data: { name: "Non-coffee (ບໍ່ມີກາແຟອີນ)", hasSugarLevel: true, hasShotType: false } }),
        Fruity: await prisma.category.create({ data: { name: "ນ້ຳໝາກໄມ້ຢີ່ປຸ່ນ", hasSugarLevel: true, hasShotType: false } }),
        Smoothie: await prisma.category.create({ data: { name: "ສະມູດຕີ້", hasSugarLevel: true, hasShotType: false } }),
        Premium: await prisma.category.create({ data: { name: "ພຣີມ້ຽມ", hasSugarLevel: true, hasShotType: true } }),
        ZeroCal: await prisma.category.create({ data: { name: "ນ້ຳຕານ 0 ແຄລ", hasSugarLevel: true, hasShotType: true } }),
        Cake: await prisma.category.create({ data: { name: "ເຄັກ", hasSugarLevel: false, hasShotType: false } }),
        Eclair: await prisma.category.create({ data: { name: "ເອແຄຣ", hasSugarLevel: false, hasShotType: false } }),
        Bakery: await prisma.category.create({ data: { name: "Bakery (ເບເກີຣີ້)", hasSugarLevel: false, hasShotType: false } }),
        InShelf: await prisma.category.create({ data: { name: "In-shelf (ສິນຄ້າວາງຂາຍ)", hasSugarLevel: false, hasShotType: false } }),
        Snack: await prisma.category.create({ data: { name: "ຂະໜົມ", hasSugarLevel: false, hasShotType: false } }),
    }

    // ========== INVENTORY (INGREDIENTS) ==========
    console.log("Seeding inventory items...")

    const rawMaterials = [
        { name: "Hot Cup (Go Home) 802", nameLaos: "ຈອກກາແຟຮ້ອນກັບບ້ານ (802)", unit: "cup", stock: 625 },
        { name: "Hot Cup (Go Home) 6502", nameLaos: "ຈອກກາແຟຮ້ອນ ກັບບ້ານ (6,502)", unit: "cup", stock: 200 },
        { name: "Hot Cup Lid 802 (Blue)", nameLaos: "ຝາຈອກກາແຟຮ້ອນ (802 ເຈ້ຍຟ້າ)", unit: "lid", stock: 250 },
        { name: "Hot Cup Lid 802 (Orange)", nameLaos: "ຝາຈອກກາແຟຮ້ອນ (802 ເຈ້ຍສົ້ມ)", unit: "lid", stock: 100 },
        { name: "Straw 6mm (MyItems Brown)", nameLaos: "ຫຼອດດູດ 6 mm (ສີນ້ຳຕານກາ MyItems)", unit: "pcs", stock: 300 },
        { name: "Straw 6mm (Bio Green)", nameLaos: "ຫຼອດດູດ 6 mm (ກາ Bio ເຈ້ຍຂຽວ)", unit: "pcs", stock: 960 },
        { name: "Straw 6mm (Aro)", nameLaos: "ຫຼອດດູດ 6 mm (ກາ Aro)", unit: "pcs", stock: 1000 },
        { name: "Coffee Bean", nameLaos: "ເມັດກາແຟມາດຕະຖານ", unit: "g", stock: 5000 },
        { name: "Premium Coffee Bean", nameLaos: "ເມັດກາແຟພຣີມ້ຽມ", unit: "g", stock: 2000 },
        { name: "Fresh Milk", nameLaos: "ນົມສົດ", unit: "ml", stock: 10000 },
        { name: "Sugar Syrup", nameLaos: "ນ້ຳເຊື່ອມ", unit: "ml", stock: 5000 },
        { name: "0 Cal Syrup", nameLaos: "ນ້ຳເຊື່ອມ 0 ແຄລ", unit: "ml", stock: 2000 },
        { name: "Matcha Powder", nameLaos: "ຜົງມັດຊະ", unit: "g", stock: 1000 }
    ]

    for (const item of rawMaterials) {
        await prisma.ingredient.create({
            data: {
                name: item.nameLaos,
                unit: item.unit,
                mainStock: item.stock,
                subStock: 0,
                minStock: 50,
                maxStock: 2000,
                minStockSub: 20,
                maxStockSub: 500,
                cost: 0
            }
        })
    }

    const foodItems = [
        { name: "Eclair Custard", nameLaos: "ເອແຄຣຄັສຕາສ", category: "Eclair", image: "/uploads/eclair-custard.jpg", priceStart: 60000, unit: "box" },
        { name: "Eclair Chocolate", nameLaos: "ເອແຄຣຊັອກໂກ້ແລັດ", category: "Eclair", image: "/uploads/eclair-choc.jpg", priceStart: 65000, unit: "box" },
        { name: "Sourdough Quinoa + Sesame", nameLaos: "ຊາວໂດຄີນົວ + ງາຂາວ + ງາດຳ", category: "Bakery", image: "/uploads/sourdough-quinoa-sesame.jpg", priceStart: 110000 },
        { name: "Sourdough Cranberry + Walnut", nameLaos: "ຊາວໂດ ແຄນເບີຮີ້ + ວໍນັດ", category: "Bakery", image: "/uploads/sourdough-cranberry-walnut.jpg", priceStart: 110000 },
        { name: "Sourdough Cranberry", nameLaos: "ຊາວໂດ ແຄນເບີຮີ້", category: "Bakery", image: "/uploads/sourdough-cranberry-walnut.jpg", priceStart: 110000 },
        { name: "Sourdough Whole Wheat", nameLaos: "ຊາວໂດ ໂຮລວີທ", category: "Bakery", image: "/uploads/sourdough-whole-wheat.jpg", priceStart: 90000 },
        { name: "Traditional Sandwich", nameLaos: "ແຊນວິດສູດບູຮານ", category: "Bakery", image: "/uploads/traditional-sandwich.jpg" },
        { name: "Egg White Sandwich", nameLaos: "ເຂົ້າຈີ່ໄຂ່ຂາວ", category: "Bakery", image: "/uploads/Egg-White-Sandwich.jpg" },
        { name: "Minced Pork Steamed Bun", nameLaos: "ຊາລາເປົາ ໝູສັບ", category: "Bakery", image: "/uploads/micned-pork-steamed-bun.jpg" },
        { name: "Cream Steamed Bun", nameLaos: "ຊາລາເປົາ ຄຣີມ", category: "Bakery", image: "/uploads/cream-steamed-bun.jpg" },
        { name: "Steamed Bun", nameLaos: "ຊາລາເປົາ", category: "Bakery", image: "/uploads/steamed-bun.jpg" },
        { name: "Pork Seaweed Bun", nameLaos: "ປັງຫມູຝອຍສາລ່າຍ", category: "Bakery", image: "/uploads/pork-seaweed-bun.jpg", priceStart: 35000 },
        { name: "Fresh Milk Cream Bun", nameLaos: "ປັງກຽວຣົດນົມສົດ", category: "Bakery", image: "/uploads/fresh-milk-cream-bun.jpg", priceStart: 40000 },
        { name: "Chocolate Cream Bun", nameLaos: "ປັງກຽວຣົດຊັອກໂກ້ແລັດ", category: "Bakery", image: "/uploads/chocolate-cream-bun.jpg", priceStart: 45000 },
        { name: "Raisin Bun", nameLaos: "ປັງລູກເກດ", category: "Bakery", image: "/uploads/raisin-bun.jpg", priceStart: 135000 },
        { name: "Pineapple Pie", nameLaos: "ພາຍຝະລັ່ງໃຈໝາກນັດ", category: "Bakery", image: "/uploads/pineapple-pie.jpg", priceStart: 35000 },
        { name: "Mushroom & Black Pepper Pie", nameLaos: "ພາຍຝະລັ່ງໃຈເຫັດຫອມພິກໄທດຳ", category: "Bakery", image: "/uploads/mushroom-black-pepper-pie.jpeg", priceStart: 35000 },
        { name: "Chicken Curry Pie", nameLaos: "ພາຍຝະລັ່ງກະຫຼີ່ໄກ່", category: "Bakery", image: "/uploads/chicken-currey-pie.jpg", priceStart: 35000 },
        { name: "Chicken Puff", nameLaos: "ປັ້ນສິບໃຈໄກ່", category: "Bakery", image: "/uploads/chicken-curry-puff.jpg", priceStart: 15000 },
        { name: "Pineapple Puff", nameLaos: "ປັ້ນສິບໃຈໝາກນັດ", category: "Bakery", image: "/uploads/pineapple-curry-puff.jpg", priceStart: 15000 },
        { name: "Mung Bean Puff", nameLaos: "ປັ້ນສິບໃຈຖົ່ວເຫຼືອງ", category: "Bakery", image: "/uploads/mung-bean-puff.png", priceStart: 15000 },
    ]

    const inShelfItems = [
        { name: "Natural Pomegranate Juice 100%", nameLaos: "ນ້ຳໝາກທັບທິມ 100%", category: "InShelf", image: "/uploads/pomegranate-juice.jpg", priceStart: 45000 },
        { name: "Natural Mulberry Juice 98.7%", nameLaos: "ນ້ຳໝາກມອນ 98.7%", category: "InShelf", image: "/uploads/mulberry-juice.jpg", priceStart: 45000 },
        { name: "Mixed Berry Spread KHAOKHO", nameLaos: "ແຍມເບີຣີ້ລວມ ເຂົາຄໍ້", category: "InShelf", image: "/uploads/mixed-berry-spread.jpg", priceStart: 115000 },
        { name: "Orange Spread KHAOKHO", nameLaos: "ແຍມໝາກ້ຽງ ເຂົາຄໍ້", category: "InShelf", image: "/uploads/orange-spread.jpg", priceStart: 115000 },
    ]

    const cakeItems = [
        { name: "Matcha Banoffee", nameLaos: "ເຄັກມັດຊະ ບານັອບຟີ່", category: "Cake", image: "/uploads/matcha-banoffee.jpeg" },
        { name: "Matcha Oreo Cake", nameLaos: "ເຄັກມັດຊະ ໂອຣີໂອ້", category: "Cake", image: "/uploads/matcha-oreo-cake.jpg" },
        { name: "Chocolate Cake", nameLaos: "ເຄັກຊັອກໂກແລັດໜ້ານິ້ມ", category: "Cake", image: "/uploads/chocolate-cake.jpg", priceStart: 47000 },
        { name: "Banana Caramel Cake", nameLaos: "ເຄັກກ້ວຍ ຄາຣາເມວ", category: "Cake", image: "/uploads/banana-caramel-cake.jpeg", priceStart: 50000 },
        { name: "Orange Cake", nameLaos: "ເຄັກສົ້ມໜ້ານິ້ມ", category: "Cake", image: "/uploads/orange-cake.jpg", priceStart: 45000 },
        { name: "Red Velvet cake", nameLaos: "ເຄັກພົມແດງ", category: "Cake", image: "/uploads/Red-Velvet-Cake.jpg" },
        { name: "Lemon Cheese Cake", nameLaos: "ເລມ້ອນຊີສເຄັກ", category: "Cake", image: "/uploads/lemon-cheesecake.jpg" },
        { name: "Fresh Chocolate – Milk", nameLaos: "ຊັອກໂກແລັດສົດ ຣົດນົມ", category: "Snack", image: "/uploads/milk-choc.png", priceStart: 175000 },
        { name: "Fresh Chocolate – Grape", nameLaos: "ຊັອກໂກແລັດສົດ ປະສົມໝາກເລີແຊງ", category: "Snack", image: "/uploads/chco-raisin.png", priceStart: 185000 },
        { name: "Fresh Chocolate – Dark 70%", nameLaos: "ຊັອກໂກແລັດສົດ ເຂັ້ມ 70%", category: "Snack", image: "/uploads/dark-choc-70.png", priceStart: 185000 },
        { name: "Fresh Chocolate – Dark 100%", nameLaos: "ຊັອກໂກແລັດສົດ ເຂັ້ມ 100%", category: "Snack", image: "/uploads/dark-choc-100.png", priceStart: 185000 },
        { name: "Fresh Chocolate – Macadamia", nameLaos: "ຊັອກໂກແລັດສົດ ປະສົມແມັກຄາດີເມຍ", category: "Snack", image: "/uploads/dark-choc-mac.png", priceStart: 185000 },
        { name: "Chocolate tart", nameLaos: "ຊັອກໂກແລັດທ໊າສ", category: "Cake", image: "/uploads/chocolate-tart.jpg", priceStart: 47000 },
        { name: "Carrot cake", nameLaos: "ເຄັກແຄລັອດ", category: "Cake", image: "/uploads/carrot-cake.jpg", priceStart: 47000 },
        { name: "Coconut cake", nameLaos: "ເຄັກໝາກພ້າວ", category: "Cake", image: "/uploads/coconut-cake.jpg", priceStart: 47000 },
        { name: "Strawberry shortcake", nameLaos: "ເຄັກສະຕໍເບີລີ້", category: "Cake", image: "/uploads/Strawberry-shortcake.jpg", priceStart: 47000 },
        { name: "Banoffee", nameLaos: "ບານັອບຟີ້ກ້ວຍຫອມ", category: "Cake", image: "/uploads/banoffee.jpg", priceStart: 45000 },
        { name: "Basque brunt cheesecake", nameLaos: "ຊີສເຄັກໜ້າໄໝ້", category: "Cake", image: "/uploads/basque-brunt-cheesecake.jpg", priceStart: 50000 },
        { name: "Blueberry cheesepie", nameLaos: "ບລູເບີລີ້ຊີສພາຍ", category: "Cake", image: "/uploads/blueberry-cheesepie.jpg", priceStart: 50000 }
    ]

    const allInventoryMenuLinks = [...foodItems, ...cakeItems, ...inShelfItems]

    for (const item of allInventoryMenuLinks) {
        const ingredient = await prisma.ingredient.create({
            data: {
                name: item.nameLaos,
                unit: item.unit || "pcs",
                mainStock: 100,
                subStock: 50,
                minStock: 10,
                maxStock: 200,
                minStockSub: 5,
                maxStockSub: 50,
                cost: 15000
            }
        })
        item.ingredientId = ingredient.id
    }

    // ========== MENUS ==========
    console.log("Seeding menu items...")

    const allIngs = await prisma.ingredient.findMany()

    async function seedMenu(name, nameLaos, categoryKey, variants, imageKeyword, hasZeroCal = false, priceStart = 25000, recipeIngredients = []) {
        let imageUrl = imageKeyword
        if (!imageUrl || !imageUrl.startsWith('/')) {
            imageUrl = `https://source.unsplash.com/400x400/?${imageKeyword || name}`.replace(/\s+/g, '-')
        }

        const menu = await prisma.menu.create({
            data: {
                name: hasZeroCal ? `${name} (Zero Calorie Sweetener)` : name,
                localName: hasZeroCal ? `${nameLaos} (ນ້ຳຕານ 0 ແຄລ)` : nameLaos,
                categoryId: categories[categoryKey].id,
                image: imageUrl
            }
        })

        if (!variants || variants.length === 0) {
            variants = [{ type: "Standard", sizes: [{ size: "Standard" }] }]
        }

        let displayOrder = 1
        for (const vType of variants) {
            const typeName = typeof vType === 'string' ? vType : vType.type

            const variation = await prisma.menuVariation.create({
                data: {
                    menuId: menu.id,
                    type: typeName.toUpperCase() === 'ICED' ? 'ICE' : typeName.toUpperCase() === 'BLENDED' ? 'BLEND' : typeName,
                    isEnabled: true,
                    displayOrder: displayOrder++
                }
            })

            let basePrice = priceStart
            if (typeof vType === 'object' && vType.price !== undefined) {
                basePrice = vType.price
            } else {
                if (typeName === 'Iced') basePrice += 5000
                if (typeName === 'Blended') basePrice += 10000
            }

            await prisma.variationSize.create({
                data: {
                    variationId: variation.id,
                    size: "Standard",
                    price: basePrice,
                    displayOrder: 1
                }
            })
        }

        for (const ingName of recipeIngredients) {
            const foundIng = allIngs.find(i => i.name === ingName)
            if (foundIng) {
                await prisma.recipe.create({
                    data: {
                        menuId: menu.id,
                        ingredientId: foundIng.id,
                        quantity: ingName.includes("ເມັດກາແຟ") || ingName.includes("ຜົງມັດຊະ") ? 18 :
                            ingName.includes("ນົມສົດ") ? 150 :
                                ingName.includes("ນ້ຳເຊື່ອມ") ? 30 : 1
                    }
                })
            }
        }

        return menu
    }

    // 1. Coffee
    const coffeeList = [
        { name: "Americano", local: "ອາເມຣິກາໂນ້", vars: [{ type: "Hot", price: 30000 }, { type: "Iced", price: 35000 }], img: "/uploads/Americano.jpeg", recipe: ["ເມັດກາແຟມາດຕະຖານ", "ຈອກກາແຟຮ້ອນກັບບ້ານ (802)"] },
        { name: "Espresso", local: "ເອສເພຣສໂຊ່", vars: [{ type: "Iced", price: 38000 }], img: "/uploads/espresso.jpg", recipe: ["ເມັດກາແຟມາດຕະຖານ", "ຈອກກາແຟຮ້ອນກັບບ້ານ (802)"] },
        { name: "Cappuccino", local: "ຄາປູຊີໂນ້", vars: [{ type: "Hot", price: 35000 }, { type: "Iced", price: 38000 }], img: "/uploads/cappuccino.jpg", recipe: ["ເມັດກາແຟມາດຕະຖານ", "ນົມສົດ", "ຈອກກາແຟຮ້ອນກັບບ້ານ (802)"] },
        { name: "Latte", local: "ລາເຕ້", vars: [{ type: "Hot", price: 35000 }, { type: "Iced", price: 38000 }], img: "/uploads/latte.jpg", recipe: ["ເມັດກາແຟມາດຕະຖານ", "ນົມສົດ", "ຈອກກາແຟຮ້ອນກັບບ້ານ (802)"] },
        { name: "Mocha", local: "ມັອກຄ່າ", vars: [{ type: "Hot", price: 37000 }, { type: "Iced", price: 40000 }, { type: "Blended", price: 45000 }], img: "/uploads/mocha.jpg", recipe: ["ເມັດກາແຟມາດຕະຖານ", "ນົມສົດ", "ນ້ຳເຊື່ອມ", "ຈອກກາແຟຮ້ອນກັບບ້ານ (802)"] },

    ]
    for (const m of coffeeList) {
        await seedMenu(m.name, m.local, "Coffee", m.vars, m.img, false, 25000, m.recipe)
    }

    // 2. Non-Coffee
    const nonCoffeeList = [
        { name: "Cacao", local: "ໂກໂກ້", vars: [{ type: "Hot", price: 35000 }, { type: "Iced", price: 38000 }, { type: "Blended", price: 45000 }], img: "/uploads/cacao.jpg" },
        { name: "Green Tea", local: "ຊາຂຽວ", vars: [{ type: "Iced", price: 38000 }, { type: "Blended", price: 45000 }], img: "/uploads/green-tea.jpg" },
        { name: "Thai Tea", local: "ຊາໄທ", vars: [{ type: "Iced", price: 35000 }], img: "/uploads/thai-tea.jpg" },
        { name: "Red Tea Latte", local: "ຊາແດງລາເຕ້", vars: [{ type: "Iced", price: 35000 }], img: "/uploads/Rose-Latte.jpg" },
    ]
    for (const m of nonCoffeeList) {
        await seedMenu(m.name, m.local, "NonCoffee", m.vars, m.img, false, 30000)
    }

    // 3. Matcha
    const matchaList = [
        { name: "Pure Matcha", local: "ພຽວມັດຊະ", vars: [{ type: "Iced", price: 50000 }], img: "/uploads/pure-matcha.png" },
        { name: "Matcha Latte", local: "ມັດຊະລາເຕ້", vars: [{ type: "Iced", price: 60000 }], img: "/uploads/matcha-latte.jpg" },
        { name: "Matcha Latte (Zero Calorie Sweetener)", local: "ມັດຊະລາເຕ້ (ນ້ຳຕານ 0 ແຄລ)", vars: [{ type: "Iced", price: 67000 }], img: "/uploads/matcha-latte.jpg" },
        { name: "Coconut Matcha", local: "ມັດຊະ ນ້ຳໝາກພ້າວ", vars: [{ type: "Iced", price: 65000 }], img: "/uploads/coconut-matcha.jpg" },
        { name: "Orange Matcha", local: "ມັດຊະ ນ້ຳໝາກກ້ຽງ", vars: [{ type: "Iced", price: 65000 }], img: "/uploads/orange-matcha.jpg" },
        { name: "Strawberry Matcha Latte", local: "ມັດຊະ ສະຕໍເບີຣີ້ນົມສົດ", vars: [{ type: "Iced", price: 70000 }], img: "/uploads/Strawberry-Matcha-LatteI.jpg" },
        { name: "Honey Lemon Matcha", local: "ມັດຊະ ຮັນນີ້ເລມ້ອນ", vars: [{ type: "Iced", price: 65000 }], img: "/uploads/honey-lemon-matcha.jpg" },
    ]
    for (const m of matchaList) {
        await seedMenu(m.name, m.local, "NonCoffee", m.vars, m.img, false, 35000)
    }

    // 4. Fruity
    const fruityList = [
        { name: "Yuzu Honey Lemon", local: "ຢູຊຸຮັນນີ້ ເລມ່ອນ", vars: ["Iced"], img: "/uploads/yuzu-honey-lemon.jpg" },
        { name: "Americano Yuzu", local: "ອາເມຣິກາໂນ້ ຢູຊຸ", vars: ["Iced"], img: "/uploads/yuzu-americano.png" },
        { name: "Yuzu Soda", local: "ຢູຊຸໂຊດາ", vars: ["Iced"], img: "/uploads/Yuzu-Soda.jpeg" },
        { name: "Honey Lemon", local: "ນ້ຳເຜິ້ງໝາກນາວ", vars: ["Iced"], img: "/uploads/honey-lemon.jpg" },
        { name: "Apple Soda", local: "ແອັບເປິ້ນ ໂຊດາ", vars: ["Iced"], img: "/uploads/apple-soda.jpg" },
        { name: "Peach Soda", local: "ພີດ ໂຊດາ", vars: ["Iced"], img: "/uploads/peach-lemon-soda.jpeg" },
    ]
    for (const m of fruityList) {
        await seedMenu(m.name, m.local, "Fruity", m.vars, m.img, false, 70000)
    }

    // 5. Smoothie
    const smoothieList = [
        { name: "Hokkaido Oreo Smoothie", local: "ຮັອກໄກໂດ ໂອຣິໂອ້ ສະມູດຕີ້", vars: [{ type: "BLEND", price: 50000 }], img: "/uploads/Oreo-smoothie.jpg" },
        { name: "Mixed Berry Smoothie", local: "ເບີຣີ້ລວມ ສະມູດຕິ້", vars: [{ type: "BLEND", price: 45000 }], img: "/uploads/mixed-berry-smoothie.jpg" },
        { name: "Blueberry Smoothie", local: "ບລູເບີຣີ້ ສະມູດຕີ້", vars: [{ type: "BLEND", price: 45000 }], img: "/uploads/Blueberry-Smoothie.jpg" },
        { name: "Strawberry Smoothie", local: "ສະຕໍເບີຣີ້ ສະມູດຕີ້", vars: [{ type: "BLEND", price: 45000 }], img: "/uploads/Strawberry-smoothie.jpg" },
        { name: "Avocado Banana Smoothie", local: "ອາໂວຄາໂດ້ ກ້ວຍ ສະມູດຕີ້", vars: [{ type: "BLEND", price: 45000 }], img: "/uploads/avocado-banana-smoothie.jpg" },
        { name: "Avocado Smoothie", local: "ອາໂວຄາໂດ້ ສະມູດຕີ້", vars: [{ type: "BLEND", price: 45000 }], img: "/uploads/avocado-blend.jpg" },
        { name: "Blue Sky Smoothie", local: "ບລູສະກາຍ ສະມູດຕີ້", vars: ["Blended"], img: "/uploads/blue-sky-smoothie.jpg" },
        { name: "Açaí Berry Smoothie", local: "ອາຊາອິເບີຣີ້ ສະມູດຕີ້", vars: ["Blended"], img: "/uploads/Acai-berry-Smoothie.jpg" },
        { name: "Cranberry Smoothie", local: "ແຄນເບຣີ້ ສະມູດຕີ້", vars: ["Blended"], img: "/uploads/cranberry-smoothie.jpg" },
        { name: "Apple + Kale Smoothie", local: "ແອັບເປິ້ນ + ເຄວ ສະມູດຕີ້", vars: ["Blended"], img: "/uploads/Apple-Kale-Smoothie.jpg" },
        { name: "Apple + Green Mixed Smoothie", local: "ແອັບເປິ້ນ + ຜັກລວມ ສະມູດຕີ້", vars: ["Blended"], img: "/uploads/apple-green-mixed-smoothie.jpg" },
    ]
    for (const m of smoothieList) {
        await seedMenu(m.name, m.local, "Smoothie", m.vars, m.img, false, 40000)
    }

    // 5.5 Zero Calorie Sweetener Menus
    const zeroCalList = [
        { name: "Espresso (Zero Calorie Sweetener)", local: "ເອສເພຣສໂຊ່ (ນ້ຳຕານ 0 ແຄລ)", vars: [{ type: "Iced", price: 45000 }], img: "/uploads/espresso.jpg" },
        { name: "Cappuccino (Zero Calorie Sweetener)", local: "ຄາປູຊີໂນ້ (ນ້ຳຕານ 0 ແຄລ)", vars: [{ type: "Hot", price: 40000 }, { type: "Iced", price: 45000 }], img: "/uploads/cappuccino.jpg" },
        { name: "Latte (Zero Calorie Sweetener)", local: "ລາເຕ້ (ນ້ຳຕານ 0 ແຄລ)", vars: [{ type: "Hot", price: 40000 }, { type: "Iced", price: 45000 }], img: "/uploads/latte.jpg" },
        { name: "Cacao (Zero Calorie Sweetener)", local: "ໂກໂກ້ (ນ້ຳຕານ 0 ແຄລ)", vars: [{ type: "Hot", price: 40000 }, { type: "Iced", price: 45000 }], img: "/uploads/cacao.jpg" },
        { name: "Green Tea (Zero Calorie Sweetener)", local: "ຊາຂຽວ (ນ້ຳຕານ 0 ແຄລ)", vars: [{ type: "Iced", price: 45000 }], img: "/uploads/green-tea.jpg" },
        { name: "Red Tea (Zero Calorie Sweetener)", local: "ຊາແດງ (ນ້ຳຕານ 0 ແຄລ)", vars: [{ type: "Iced", price: 40000 }], img: "/uploads/Rose-Latte.jpg" },
        { name: "Thai Tea (Zero Calorie Sweetener)", local: "ຊາໄທ (ນ້ຳຕານ 0 ແຄລ)", vars: [{ type: "Iced", price: 40000 }], img: "/uploads/thai-tea.jpg" },
        { name: "Mocha (Zero Calorie Sweetener)", local: "ມັອກຄ່າ (ນ້ຳຕານ 0 ແຄລ)", vars: [{ type: "Hot", price: 40000 }, { type: "Iced", price: 45000 }], img: "/uploads/mocha.jpg" }
    ]
    for (const m of zeroCalList) {
        await seedMenu(m.name, m.local, "ZeroCal", m.vars, m.img, false, 30000)
    }

    // 6. Premium
    const premiumList = [
        { name: "Premium Americano", local: "ພຣີມ້ຽມອາເມຣິກາໂນ້", vars: [{ type: "Hot", price: 40000 }, { type: "Iced", price: 45000 }], img: "/uploads/Americano.jpeg", recipe: ["ເມັດກາແຟພຣີມ້ຽມ", "ຈອກກາແຟຮ້ອນກັບບ້ານ (802)"] },
        { name: "Premium Honey Americano", local: "ພຣີມ້ຽມອາເມຣິກາໂນ້ນ້ຳເຜິ້ງ", vars: [{ type: "Iced", price: 45000 }], img: "/uploads/honey-americano.jpg", recipe: ["ເມັດກາແຟພຣີມ້ຽມ", "ຈອກກາແຟຮ້ອນກັບບ້ານ (802)"] },
        { name: "Premium Coconut Americano", local: "ພຣີມ້ຽມອາເມຣິກາໂນ້ນ້ຳໝາກພ້າວ", vars: [{ type: "Iced", price: 50000 }], img: "/uploads/coconut-americano.jpg", recipe: ["ເມັດກາແຟພຣີມ້ຽມ", "ຈອກກາແຟຮ້ອນກັບບ້ານ (802)"] },
        { name: "Premium Orange Americano", local: "ພຣີມ້ຽມອາເມຣິກາໂນ້ນ້ຳໝາກກ້ຽງ", vars: [{ type: "Iced", price: 50000 }], img: "/uploads/orange-americano.png", recipe: ["ເມັດກາແຟພຣີມ້ຽມ", "ຈອກກາແຟຮ້ອນກັບບ້ານ (802)"] },
        { name: "Premium Espresso", local: "ພຣີມ້ຽມເອສເພຣສໂຊ່", vars: [{ type: "Iced", price: 50000 }], img: "/uploads/espresso.jpg", recipe: ["ເມັດກາແຟພຣີມ້ຽມ", "ຈອກກາແຟຮ້ອນກັບບ້ານ (802)"] },
        { name: "Premium Cappuccino", local: "ພຣີມ້ຽມຄາປູຊີໂນ້", vars: [{ type: "Hot", price: 45000 }, { type: "Iced", price: 50000 }], img: "/uploads/cappuccino.jpg", recipe: ["ເມັດກາແຟພຣີມ້ຽມ", "ນົມສົດ", "ຈອກກາແຟຮ້ອນກັບບ້ານ (802)"] },
        { name: "Premium Latte", local: "ພຣີມ້ຽມລາເຕ້", vars: [{ type: "Hot", price: 45000 }, { type: "Iced", price: 50000 }], img: "/uploads/latte.jpg", recipe: ["ເມັດກາແຟພຣີມ້ຽມ", "ນົມສົດ", "ຈອກກາແຟຮ້ອນກັບບ້ານ (802)"] },
        { name: "Premium Pure Matcha", local: "ພຣີມ້ຽມພຽວມັດຊະ", vars: [{ type: "Iced", price: 60000 }], img: "/uploads/pure-matcha.png", recipe: ["ຜົງມັດຊະ", "ຈອກກາແຟຮ້ອນກັບບ້ານ (802)"] },
        { name: "Premium Matcha Latte", local: "ພຣີມ້ຽມມັດຊະລາເຕ້", vars: [{ type: "Iced", price: 75000 }], img: "/uploads/matcha-latte.jpg", recipe: ["ຜົງມັດຊະ", "ນົມສົດ", "ຈອກກາແຟຮ້ອນກັບບ້ານ (802)"] },
        { name: "Premium Matcha Latte Oat Milk / Pistachio Milk (Zero Calorie Sweetener)", local: "ພຣີມ້ຽມມັດຊະລາເຕ້ ນົມໂອ້ດ, ນົມພິດທາຊິໂອ້ (ນ້ຳຕານ 0 ແຄລ)", vars: [{ type: "Iced", price: 85000 }], img: "/uploads/Iced-Oat-Milk-Latte.png", recipe: ["ຜົງມັດຊະ", "ນົມສົດ", "ຈອກກາແຟຮ້ອນກັບບ້ານ (802)"] },
        { name: "Premium Espresso Almond Milk (Zero Calorie Sweetener)", local: "ພຣີມ້ຽມເອສເພຣສໂຊ່ ນົມອາວມ້ອນ (ນ້ຳຕານ 0 ແຄລ)", vars: [{ type: "Iced", price: 65000 }], img: "/uploads/espresso-almond-milk.jpg", recipe: ["ເມັດກາແຟພຣີມ້ຽມ", "ນົມສົດ", "ຈອກກາແຟຮ້ອນກັບບ້ານ (802)"] },
        { name: "Premium Latte Almond Milk (Zero Calorie Sweetener)", local: "ພຣີມ້ຽມລາເຕ້ ນົມອາວມ້ອນ (ນ້ຳຕານ 0 ແຄລ)", vars: [{ type: "Iced", price: 65000 }], img: "/uploads/premium-latte-almond-milk.jpg", recipe: ["ເມັດກາແຟພຣີມ້ຽມ", "ນົມສົດ", "ຈອກກາແຟຮ້ອນກັບບ້ານ (802)"] },
        { name: "Premium Cappuccino Almond Milk (Zero Calorie Sweetener)", local: "ພຣີມ້ຽມຄາປູຊີໂນ້ ນົມອາວມ້ອນ (ນ້ຳຕານ 0 ແຄລ)", vars: [{ type: "Iced", price: 65000 }], img: "/uploads/cappuccino.jpg", recipe: ["ເມັດກາແຟພຣີມ້ຽມ", "ນົມສົດ", "ຈອກກາແຟຮ້ອນກັບບ້ານ (802)"] },
    ]
    for (const m of premiumList) {
        await seedMenu(m.name, m.local, "Premium", m.vars, m.img, false, 45000, m.recipe)
    }

    // 7. Inventory Linked Menus (Cakes, Pastries, etc.)
    for (const item of allInventoryMenuLinks) {
        const menu = await seedMenu(item.name, item.nameLaos, item.category, ["Standard"], item.image, false, item.priceStart || 35000)
        if (item.ingredientId) {
            await prisma.recipe.create({
                data: {
                    menuId: menu.id,
                    ingredientId: item.ingredientId,
                    quantity: 1
                }
            })
        }
    }

    // ========== OWNER VIP CUSTOMER ONLY ==========
    console.log("Seeding owner customer...")
    await prisma.customer.create({
        data: { name: "Owner VIP", phone: "000 000 0000", loyaltyPoints: 0, totalSpent: 0, visitCount: 0, type: "COMPLIMENTARY" }
    })

    // ========== SETTINGS ==========
    console.log("Seeding settings...")
    await prisma.setting.createMany({
        data: [
            { key: "shopName", value: "Memories Lane" },
            { key: "shopAddress", value: "Savannakhet, Kaysone Phomvihane" },
            { key: "shopPhone", value: "" },
            { key: "taxRate", value: "10" },
            { key: "loyaltyRate", value: "1000" },
            { key: "language", value: "lo" },
            { key: "shopLogo", value: "/CAFE LOGO.jpg" },
            { key: "boldReceipt", value: "true" },
            { key: "receiptFooter", value: "Thank you for visiting!" },
            { key: "transfer_qr_url", value: "/memory-lane-static-qr.png" }
        ]
    })

    console.log("✅ Deploy seed completed! No mock data.")
}

main()
    .catch(e => {
        console.error(e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
