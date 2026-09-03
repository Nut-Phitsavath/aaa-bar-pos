/**
 * Seed for the AAA bar.
 *
 * PLACEHOLDER PRODUCTS AND PRICES. Everything below is a plausible bar list in
 * Thai baht so the till can be worked end to end - it is not the venue's real
 * menu. Replace the arrays with the owner's price list before opening; the
 * structure is what matters here, not the numbers.
 *
 * What the structure demonstrates, because these are the parts that are easy to
 * get wrong later:
 *   - a package deducting many units of stock (req #21): one Heineken Bucket
 *     takes 5 bottles off the shelf, one Chivas Set takes a bottle plus mixers
 *   - stock kept in the unit it is counted in, so an audit sheet can be walked
 *     down a shelf
 *   - waiters as staff who are picked from a list and never log in (req #6)
 */
const { PrismaClient } = require("@prisma/client")
const bcrypt = require("bcryptjs")
const crypto = require("node:crypto")

const prisma = new PrismaClient()

// --- Stock, in the unit it is counted in -----------------------------------
const INGREDIENTS = [
    { name: "Beer Lao (bottle)", unit: "bottle", cost: 28, min: 48, max: 600 },
    { name: "Beer Lao Dark (bottle)", unit: "bottle", cost: 32, min: 24, max: 300 },
    { name: "Heineken (bottle)", unit: "bottle", cost: 42, min: 48, max: 600 },
    { name: "Tiger (bottle)", unit: "bottle", cost: 36, min: 24, max: 300 },
    { name: "Chivas 12 (bottle)", unit: "bottle", cost: 1900, min: 3, max: 24 },
    { name: "Johnnie Walker Black (bottle)", unit: "bottle", cost: 1750, min: 3, max: 24 },
    { name: "Hongthong (bottle)", unit: "bottle", cost: 420, min: 6, max: 60 },
    { name: "Vodka (bottle)", unit: "bottle", cost: 650, min: 3, max: 24 },
    { name: "Soda (bottle)", unit: "bottle", cost: 12, min: 48, max: 480 },
    { name: "Coke (can)", unit: "can", cost: 14, min: 48, max: 480 },
    { name: "Drinking water (bottle)", unit: "bottle", cost: 6, min: 48, max: 480 },
    { name: "Red Bull (can)", unit: "can", cost: 18, min: 24, max: 240 },
    { name: "Ice (bucket)", unit: "bucket", cost: 8, min: 20, max: 200 },
    { name: "Lime", unit: "piece", cost: 3, min: 30, max: 300 },
    { name: "Mint", unit: "bunch", cost: 10, min: 5, max: 40 },
    { name: "Mixed nuts", unit: "pack", cost: 30, min: 10, max: 100 },
    { name: "Squid", unit: "portion", cost: 45, min: 10, max: 80 },
    { name: "Potato fries", unit: "portion", cost: 25, min: 10, max: 100 },
]

// --- Menu. `recipe` is what one sale takes off the shelf. ------------------
const MENU = [
    { cat: "Beer", name: "Beer Lao", lao: "ເບຍລາວ", price: 45, recipe: { "Beer Lao (bottle)": 1 } },
    { cat: "Beer", name: "Beer Lao Dark", lao: "ເບຍລາວດຳ", price: 50, recipe: { "Beer Lao Dark (bottle)": 1 } },
    { cat: "Beer", name: "Heineken", lao: "ໄຮເນເກັນ", price: 60, recipe: { "Heineken (bottle)": 1 } },
    { cat: "Beer", name: "Tiger", lao: "ໄທເກີ", price: 55, recipe: { "Tiger (bottle)": 1 } },

    // The requirement's own example: one sale, many bottles deducted.
    { cat: "Sets", name: "Heineken Bucket (5)", lao: "ຖັງໄຮເນເກັນ (5)", price: 280, recipe: { "Heineken (bottle)": 5, "Ice (bucket)": 1 } },
    { cat: "Sets", name: "Beer Lao Bucket (5)", lao: "ຖັງເບຍລາວ (5)", price: 210, recipe: { "Beer Lao (bottle)": 5, "Ice (bucket)": 1 } },
    { cat: "Sets", name: "Chivas 12 Set", lao: "ຊຸດຊີວາສ 12", price: 3500, recipe: { "Chivas 12 (bottle)": 1, "Soda (bottle)": 4, "Ice (bucket)": 2 } },
    { cat: "Sets", name: "Johnnie Black Set", lao: "ຊຸດຈອນນີ້ດຳ", price: 3200, recipe: { "Johnnie Walker Black (bottle)": 1, "Soda (bottle)": 4, "Ice (bucket)": 2 } },
    { cat: "Sets", name: "Hongthong Set", lao: "ຊຸດຫົງທອງ", price: 900, recipe: { "Hongthong (bottle)": 1, "Soda (bottle)": 4, "Ice (bucket)": 2 } },

    { cat: "Spirits", name: "Whisky (glass)", lao: "ວິສກີ້ (ຈອກ)", price: 90, recipe: { "Hongthong (bottle)": 0.1 } },
    { cat: "Spirits", name: "Vodka (glass)", lao: "ວອດກ້າ (ຈອກ)", price: 90, recipe: { "Vodka (bottle)": 0.1 } },

    { cat: "Cocktails", name: "Mojito", lao: "ໂມຈິໂຕ້", price: 150, recipe: { "Vodka (bottle)": 0.08, "Lime": 1, "Mint": 0.2, "Soda (bottle)": 1 } },
    { cat: "Cocktails", name: "Gin Tonic", lao: "ຈິນໂທນິກ", price: 140, recipe: { "Vodka (bottle)": 0.08, "Lime": 1, "Soda (bottle)": 1 } },

    { cat: "Mixers", name: "Soda", lao: "ໂຊດາ", price: 30, recipe: { "Soda (bottle)": 1 } },
    { cat: "Mixers", name: "Coke", lao: "ໂຄກ", price: 30, recipe: { "Coke (can)": 1 } },
    { cat: "Mixers", name: "Drinking Water", lao: "ນ້ຳດື່ມ", price: 20, recipe: { "Drinking water (bottle)": 1 } },
    { cat: "Mixers", name: "Red Bull", lao: "ກະທິງແດງ", price: 45, recipe: { "Red Bull (can)": 1 } },
    { cat: "Mixers", name: "Ice Bucket", lao: "ຖັງນ້ຳກ້ອນ", price: 20, recipe: { "Ice (bucket)": 1 } },

    { cat: "Snacks", name: "Mixed Nuts", lao: "ຖົ່ວລວມ", price: 80, recipe: { "Mixed nuts": 1 } },
    { cat: "Snacks", name: "Fried Squid", lao: "ປາໝຶກທອດ", price: 120, recipe: { "Squid": 1 } },
    { cat: "Snacks", name: "French Fries", lao: "ມັນຝະລັ່ງທອດ", price: 90, recipe: { "Potato fries": 1 } },
]

const CATEGORIES = ["Beer", "Sets", "Spirits", "Cocktails", "Mixers", "Snacks"]

const TABLES = [
    { name: "T1", area: "INDOOR", seats: 4 }, { name: "T2", area: "INDOOR", seats: 4 },
    { name: "T3", area: "INDOOR", seats: 6 }, { name: "T4", area: "INDOOR", seats: 6 },
    { name: "T5", area: "INDOOR", seats: 8 }, { name: "T6", area: "INDOOR", seats: 8 },
    { name: "O1", area: "OUTDOOR", seats: 4 }, { name: "O2", area: "OUTDOOR", seats: 4 },
    { name: "O3", area: "OUTDOOR", seats: 6 }, { name: "O4", area: "OUTDOOR", seats: 6 },
    { name: "VIP 1", area: "VIP", seats: 10 }, { name: "VIP 2", area: "VIP", seats: 10 },
    { name: "VIP 3", area: "VIP", seats: 12 },
]

async function main() {
    console.log("Clearing previous data...")
    // Order matters: children before parents.
    await prisma.payment.deleteMany({})
    await prisma.orderItem.deleteMany({})
    await prisma.order.deleteMany({})
    await prisma.tableSession.deleteMany({})
    await prisma.table.deleteMany({})
    await prisma.recipe.deleteMany({})
    await prisma.stockCount.deleteMany({})
    await prisma.stockTransaction.deleteMany({})
    await prisma.variationSize.deleteMany({})
    await prisma.menuVariation.deleteMany({})
    await prisma.menu.deleteMany({})
    await prisma.category.deleteMany({})
    await prisma.ingredient.deleteMany({})
    await prisma.customer.deleteMany({})
    await prisma.promotion.deleteMany({})
    await prisma.shift.deleteMany({})
    await prisma.user.deleteMany({})
    await prisma.setting.deleteMany({})

    // --- Staff -------------------------------------------------------------
    console.log("Seeding staff...")
    await prisma.user.create({
        data: { name: "Owner", username: "admin", role: "ADMIN", pin: await bcrypt.hash("1675", 10) },
    })
    await prisma.user.create({
        data: { name: "Manager", username: "manager", role: "MANAGER", pin: await bcrypt.hash("2468", 10) },
    })
    for (const [name, username, pin] of [["Kee", "staff1", "3978"], ["Johnny", "staff2", "2267"]]) {
        await prisma.user.create({
            data: { name, username, role: "STAFF", pin: await bcrypt.hash(pin, 10) },
        })
    }
    // Waiters are picked from a list on the order panel and never log in, so
    // their PIN is an unguessable hash rather than a shared one (req #6).
    for (const name of ["Nok", "Mai", "Ting", "Bee"]) {
        await prisma.user.create({
            data: {
                name, username: name.toLowerCase(), role: "WAITER",
                pin: await bcrypt.hash(crypto.randomUUID(), 10),
            },
        })
    }

    // --- Stock -------------------------------------------------------------
    console.log("Seeding stock...")
    const ingredientId = {}
    for (const ing of INGREDIENTS) {
        const row = await prisma.ingredient.create({
            data: {
                name: ing.name, unit: ing.unit, cost: ing.cost,
                // Opening stock at roughly half of max, so low-stock alerts and
                // the audit sheet have something meaningful to show.
                mainStock: Math.round(ing.max / 2),
                subStock: Math.round(ing.max / 4),
                minStock: ing.min, maxStock: ing.max,
                minStockSub: Math.round(ing.min / 2), maxStockSub: Math.round(ing.max / 4),
            },
        })
        ingredientId[ing.name] = row.id
    }

    // --- Menu --------------------------------------------------------------
    console.log("Seeding menu...")
    const categoryId = {}
    for (const name of CATEGORIES) {
        // hasSugarLevel / hasShotType stay off: they are the inherited cafe
        // modifiers and a bar has no use for them.
        const row = await prisma.category.create({ data: { name } })
        categoryId[name] = row.id
    }

    for (const item of MENU) {
        const menu = await prisma.menu.create({
            data: { name: item.name, localName: item.lao, categoryId: categoryId[item.cat] },
        })
        const variation = await prisma.menuVariation.create({
            data: { menuId: menu.id, type: "STANDARD", displayOrder: 1 },
        })
        await prisma.variationSize.create({
            data: { variationId: variation.id, size: "Standard", price: item.price, displayOrder: 1 },
        })
        for (const [ing, qty] of Object.entries(item.recipe)) {
            await prisma.recipe.create({
                data: { menuId: menu.id, ingredientId: ingredientId[ing], quantity: qty },
            })
        }
    }

    // --- Floor -------------------------------------------------------------
    console.log("Seeding floor...")
    for (const [i, t] of TABLES.entries()) {
        await prisma.table.create({ data: { ...t, displayOrder: i + 1 } })
    }

    // --- House accounts, for pay-later tabs (req #19) -----------------------
    for (const [name, phone] of [["Mr Somsak", "020 5555 1234"], ["Khun Nok", "020 5555 5678"]]) {
        await prisma.customer.create({ data: { name, phone, type: "VIP" } })
    }

    // --- Settings ----------------------------------------------------------
    console.log("Seeding settings...")
    await prisma.setting.createMany({
        data: [
            { key: "shopName", value: "AAA" },
            { key: "shopAddress", value: "" },
            { key: "shopPhone", value: "" },
            { key: "taxRate", value: "10" },
            { key: "loyaltyRate", value: "2" },
            { key: "language", value: "lo" },
            { key: "shopLogo", value: "" },
            { key: "boldReceipt", value: "true" },
            { key: "receiptFooter", value: "Thank you for visiting!" },
            // 1 THB = this many LAK / 1 USD = this many THB. Owner sets the
            // counter rate; a settled bill keeps the rate it closed at.
            { key: "rate_lak", value: "680" },
            { key: "rate_usd", value: "32" },
            { key: "show_usd", value: "false" },
        ],
    })

    console.log(`
Seeded AAA:
  ${INGREDIENTS.length} stock items, ${MENU.length} menu items, ${CATEGORIES.length} categories
  ${TABLES.length} tables, 4 waiters, 2 house accounts
  No sales history - the till starts on an empty day.

  Logins:  admin/1675   manager/2468   staff1/3978   staff2/2267

  Prices are PLACEHOLDERS. Replace MENU and INGREDIENTS in this file with
  the owner's real list before opening.
`)
}

main()
    .catch((e) => { console.error(e); process.exit(1) })
    .finally(async () => { await prisma.$disconnect() })
