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

// --- Stock ----------------------------------------------------------------
//
// Costs are placeholders like the prices, but they are not arbitrary: each one
// is set so the resulting pour cost lands in a defensible band. The trade's
// published targets - spirits 18-22%, beer 20-25%, soft 12-18% - are Western
// ones; imported spirit carries heavy duty here while menu prices are set
// against the bar next door, so the bands in checkPourCost.js are wider and
// say why. Replace these with the owner's invoices and run
// `npm run check:pourcost`, which fails on anything selling at or below cost.
//
// Spirits are counted in BOTTLES, not millilitres, and poured as a fraction of
// one. A shelf can be counted in bottles - "20,020 ml of Hongthong" cannot be
// walked down and ticked off - and a part-bottle is exactly how bar stock
// really sits. The fraction is the honest arithmetic: a 30 ml single out of a
// 700 ml bottle is 0.043 of it, not the 0.1 this seed used to claim, which was
// a 70 ml pour and quietly overstated every spirit variance.
const ML_PER_BOTTLE = 700
const SINGLE = 30 / ML_PER_BOTTLE   // 0.0429 - spirit served over ice
const COCKTAIL = 45 / ML_PER_BOTTLE // 0.0643 - the larger measure a mixed drink takes

const INGREDIENTS = [
    // Beer, sold whole. Local beer carries a higher pour cost than the Western
    // benchmark because it is cheap on the shelf here and priced against other
    // bars, not against its cost.
    { cat: "Beer", name: "Beer Lao (bottle)", unit: "bottle", cost: 13, min: 48, max: 600 },
    { cat: "Beer", name: "Beer Lao Dark (bottle)", unit: "bottle", cost: 15, min: 24, max: 300 },
    { cat: "Beer", name: "Heineken (bottle)", unit: "bottle", cost: 18, min: 48, max: 600 },
    { cat: "Beer", name: "Tiger (bottle)", unit: "bottle", cost: 17, min: 24, max: 300 },

    // Spirits, 700ml. Sold both by the glass and as a whole-bottle set.
    { cat: "Spirits", name: "Chivas 12 (bottle)", unit: "bottle", cost: 1150, min: 3, max: 24 },
    { cat: "Spirits", name: "Johnnie Walker Black (bottle)", unit: "bottle", cost: 1080, min: 3, max: 24 },
    { cat: "Spirits", name: "Hongthong (bottle)", unit: "bottle", cost: 240, min: 6, max: 60 },
    { cat: "Spirits", name: "Vodka (bottle)", unit: "bottle", cost: 520, min: 3, max: 24 },
    // A mojito needs rum and a gin tonic needs gin. Both cocktails used to be
    // built from vodka because neither bottle existed on the shelf.
    { cat: "Spirits", name: "White Rum (bottle)", unit: "bottle", cost: 480, min: 3, max: 24 },
    { cat: "Spirits", name: "Gin (bottle)", unit: "bottle", cost: 520, min: 3, max: 24 },
    // Sold both by the bottle and inside the VIP set, which is what makes it
    // swappable: a package component can only be priced and put back on the
    // shelf if the menu also sells exactly one of it.
    { cat: "Spirits", name: "Wine (bottle)", unit: "bottle", cost: 220, min: 6, max: 60 },

    { cat: "Mixers", name: "Soda water (bottle)", unit: "bottle", cost: 10, min: 48, max: 480 },
    // Tonic is not soda. A gin tonic poured from the soda crate is a different
    // drink, and the one the customer sent back.
    { cat: "Mixers", name: "Tonic water (bottle)", unit: "bottle", cost: 12, min: 24, max: 240 },
    { cat: "Mixers", name: "Coke (can)", unit: "can", cost: 12, min: 48, max: 480 },
    { cat: "Mixers", name: "Drinking water (bottle)", unit: "bottle", cost: 5, min: 48, max: 480 },
    { cat: "Mixers", name: "Red Bull (can)", unit: "can", cost: 16, min: 24, max: 240 },

    // Ice is bought and counted by weight; a "bucket" is how it is served, not
    // how it arrives, so a bucket is 2 kg of this rather than its own unit.
    { cat: "Bar", name: "Ice (kg)", unit: "kg", cost: 3, min: 40, max: 400 },
    { cat: "Bar", name: "Lime", unit: "piece", cost: 3, min: 30, max: 300 },
    { cat: "Bar", name: "Mint", unit: "bunch", cost: 12, min: 5, max: 40 },
    { cat: "Bar", name: "Sugar syrup (litre)", unit: "litre", cost: 60, min: 2, max: 20 },

    // Kitchen goods in the unit they are purchased and weighed in, so a recipe
    // deducts 0.15 kg of squid rather than one abstract "portion".
    { cat: "Food", name: "Squid (kg)", unit: "kg", cost: 180, min: 3, max: 30 },
    { cat: "Food", name: "Potatoes (kg)", unit: "kg", cost: 40, min: 5, max: 50 },
    { cat: "Food", name: "Mixed nuts (kg)", unit: "kg", cost: 240, min: 2, max: 20 },
    { cat: "Food", name: "Cooking oil (litre)", unit: "litre", cost: 55, min: 4, max: 40 },
]

const INGREDIENT_CATEGORIES = {
    Beer: "Beer",
    Spirits: "Spirits",
    Mixers: "Mixers & Soft Drinks",
    Bar: "Bar Consumables",
    Food: "Kitchen",
}

// --- Menu. `recipe` is what one sale takes off the shelf. ------------------
const MENU = [
    { cat: "Beer", name: "Beer Lao", lao: "ເບຍລາວ", price: 45, recipe: { "Beer Lao (bottle)": 1 } },
    { cat: "Beer", name: "Beer Lao Dark", lao: "ເບຍລາວດຳ", price: 50, recipe: { "Beer Lao Dark (bottle)": 1 } },
    { cat: "Beer", name: "Heineken", lao: "ໄຮເນເກັນ", price: 60, recipe: { "Heineken (bottle)": 1 } },
    { cat: "Beer", name: "Tiger", lao: "ໄທເກີ", price: 55, recipe: { "Tiger (bottle)": 1 } },

    // Packages (req #21): one sale, several lines off the shelf.
    { cat: "Sets", name: "Heineken Bucket (5)", lao: "ຖັງໄຮເນເກັນ (5)", price: 280, recipe: { "Heineken (bottle)": 5, "Ice (kg)": 2 } },
    { cat: "Sets", name: "Beer Lao Bucket (5)", lao: "ຖັງເບຍລາວ (5)", price: 210, recipe: { "Beer Lao (bottle)": 5, "Ice (kg)": 2 } },
    { cat: "Sets", name: "Chivas 12 Set", lao: "ຊຸດຊີວາສ 12", price: 3500, recipe: { "Chivas 12 (bottle)": 1, "Soda water (bottle)": 4, "Ice (kg)": 4 } },
    { cat: "Sets", name: "Johnnie Black Set", lao: "ຊຸດຈອນນີ້ດຳ", price: 3200, recipe: { "Johnnie Walker Black (bottle)": 1, "Soda water (bottle)": 4, "Ice (kg)": 4 } },
    { cat: "Sets", name: "Hongthong Set", lao: "ຊຸດຫົງທອງ", price: 900, recipe: { "Hongthong (bottle)": 1, "Soda water (bottle)": 4, "Ice (kg)": 4 } },
    // The owner's own example, and the one to test an exchange against: its
    // contents are worth 610 on the menu and it sells for 550, so a customer
    // who trades down leaves that margin with the bar.
    { cat: "Sets", name: "VIP Set", lao: "ຊຸດ VIP", price: 850, recipe: { "Wine (bottle)": 1, "Beer Lao (bottle)": 2, "Heineken (bottle)": 2, "Ice (kg)": 2 } },

    { cat: "Spirits", name: "Whisky (glass)", lao: "ວິສກີ້ (ຈອກ)", price: 70, recipe: { "Hongthong (bottle)": SINGLE, "Ice (kg)": 0.15 } },
    { cat: "Spirits", name: "Vodka (glass)", lao: "ວອດກ້າ (ຈອກ)", price: 90, recipe: { "Vodka (bottle)": SINGLE, "Ice (kg)": 0.15 } },
    { cat: "Spirits", name: "Wine (bottle)", lao: "ເຫຼົ້າແວງ (ຂວດ)", price: 750, recipe: { "Wine (bottle)": 1 } },

    { cat: "Cocktails", name: "Mojito", lao: "ໂມຈິໂຕ້", price: 150, recipe: { "White Rum (bottle)": COCKTAIL, "Lime": 1, "Mint": 0.15, "Sugar syrup (litre)": 0.02, "Soda water (bottle)": 1, "Ice (kg)": 0.2 } },
    { cat: "Cocktails", name: "Gin Tonic", lao: "ຈິນໂທນິກ", price: 160, recipe: { "Gin (bottle)": COCKTAIL, "Tonic water (bottle)": 1, "Lime": 0.25, "Ice (kg)": 0.2 } },

    { cat: "Mixers", name: "Soda", lao: "ໂຊດາ", price: 30, recipe: { "Soda water (bottle)": 1 } },
    { cat: "Mixers", name: "Tonic", lao: "ໂທນິກ", price: 35, recipe: { "Tonic water (bottle)": 1 } },
    { cat: "Mixers", name: "Coke", lao: "ໂຄກ", price: 30, recipe: { "Coke (can)": 1 } },
    { cat: "Mixers", name: "Drinking Water", lao: "ນ້ຳດື່ມ", price: 20, recipe: { "Drinking water (bottle)": 1 } },
    { cat: "Mixers", name: "Red Bull", lao: "ກະທິງແດງ", price: 45, recipe: { "Red Bull (can)": 1 } },
    { cat: "Mixers", name: "Ice Bucket", lao: "ຖັງນ້ຳກ້ອນ", price: 20, recipe: { "Ice (kg)": 2 } },

    { cat: "Snacks", name: "Mixed Nuts", lao: "ຖົ່ວລວມ", price: 80, recipe: { "Mixed nuts (kg)": 0.08 } },
    { cat: "Snacks", name: "Fried Squid", lao: "ປາໝຶກທອດ", price: 120, recipe: { "Squid (kg)": 0.15, "Cooking oil (litre)": 0.03 } },
    { cat: "Snacks", name: "French Fries", lao: "ມັນຝະລັ່ງທອດ", price: 90, recipe: { "Potatoes (kg)": 0.25, "Cooking oil (litre)": 0.03 } },
]

const CATEGORIES = ["Beer", "Sets", "Spirits", "Cocktails", "Mixers", "Snacks"]
/** Made in the kitchen, so its dockets print there. Everything else: the bar. */
const KITCHEN_CATEGORIES = ["Snacks"]

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
    await prisma.menu.deleteMany({})
    await prisma.category.deleteMany({})
    await prisma.ingredient.deleteMany({})
    await prisma.ingredientCategory.deleteMany({})
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
    // The schema has always had ingredient categories; nothing ever filled them,
    // so the inventory screen was one flat list of everything the bar owns.
    // Beer and cooking oil are not reordered by the same person on the same day.
    const ingCategoryId = {}
    for (const [key, name] of Object.entries(INGREDIENT_CATEGORIES)) {
        const row = await prisma.ingredientCategory.create({ data: { name } })
        ingCategoryId[key] = row.id
    }

    const ingredientId = {}
    for (const ing of INGREDIENTS) {
        const row = await prisma.ingredient.create({
            data: {
                name: ing.name, unit: ing.unit, cost: ing.cost,
                categoryId: ingCategoryId[ing.cat],
                // Opening stock at roughly half of max, so low-stock alerts and
                // the audit sheet have something meaningful to show. Not rounded:
                // sugar syrup has a max of 20 litres and rounding its sub-stock
                // would quietly invent or destroy litres of it.
                mainStock: ing.max / 2,
                subStock: ing.max / 4,
                minStock: ing.min, maxStock: ing.max,
                minStockSub: ing.min / 2, maxStockSub: ing.max / 4,
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
        const row = await prisma.category.create({
            data: { name, station: KITCHEN_CATEGORIES.includes(name) ? "KITCHEN" : "BAR" },
        })
        categoryId[name] = row.id
    }

    for (const item of MENU) {
        const menu = await prisma.menu.create({
            data: { name: item.name, localName: item.lao, categoryId: categoryId[item.cat], price: item.price },
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
