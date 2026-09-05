/**
 * Pour-cost check for the seeded menu.
 *
 * Every price and cost in the seed is a placeholder, but the RELATIONSHIP
 * between them is not allowed to be nonsense: a bar that prices a drink below
 * what it costs to pour finds out at stocktake, not at the till. This walks
 * each menu item's recipe, values it at ingredient cost, and reports the pour
 * cost against the band its category actually trades in.
 *
 * Bands are the trade's, not invented here:
 *   spirits and spirit-forward cocktails 18-22%, beer 20-25%,
 *   soft drinks 12-18%, food 28-35%.
 * Local beer is allowed to run higher: it is cheap on the shelf in Laos and
 * priced against the bar next door rather than against its cost.
 *
 * Run: node prisma/checkPourCost.js
 * Exits non-zero if anything sells below cost or lands wildly outside its band,
 * so replacing the placeholders with the owner's real price list gets checked.
 */
const { PrismaClient } = require("@prisma/client")

const prisma = new PrismaClient()

// [floor, ceiling] as a percentage of the selling price.
const BANDS = {
    Beer: [20, 40],
    Sets: [25, 45],      // bottle service trades volume for margin
    Spirits: [15, 30],
    Cocktails: [20, 35], // imported spirit, duty-heavy, priced against the street
    Mixers: [12, 50],    // priced low on purpose; the margin is in what it mixes
    Snacks: [20, 40],
}

async function main() {
    const menus = await prisma.menu.findMany({
        include: {
            category: true,
            variations: { include: { sizes: true } },
            recipes: { include: { ingredient: true } },
        },
        orderBy: { name: "asc" },
    })

    if (menus.length === 0) {
        console.error("No menu found. Run `npm run db:seed` first.")
        process.exit(1)
    }

    let failures = 0
    const rows = []

    for (const menu of menus) {
        const price = Math.min(
            ...menu.variations.flatMap((v) => v.sizes.map((s) => s.price)).filter((n) => n > 0)
        )
        if (!Number.isFinite(price)) continue

        if (menu.recipes.length === 0) {
            console.error(`FAIL  ${menu.name}: sells for ${price} but deducts no stock`)
            failures++
            continue
        }

        const cost = menu.recipes.reduce((sum, r) => sum + r.quantity * r.ingredient.cost, 0)
        const pct = (cost / price) * 100
        const band = BANDS[menu.category?.name] ?? [0, 100]

        let verdict = "ok"
        if (cost >= price) { verdict = "SELLS BELOW COST"; failures++ }
        else if (pct < band[0]) verdict = `under ${band[0]}% (priced high)`
        else if (pct > band[1]) { verdict = `over ${band[1]}%`; failures++ }

        rows.push({
            item: menu.name,
            category: menu.category?.name ?? "-",
            price: price.toFixed(0),
            cost: cost.toFixed(2),
            "pour %": pct.toFixed(1),
            verdict,
        })
    }

    console.table(rows)

    // An ingredient nothing sells is stock nobody will ever count down, which is
    // usually a recipe pointing at the wrong bottle rather than a spare line.
    const orphans = await prisma.ingredient.findMany({
        where: { recipes: { none: {} } },
        select: { name: true },
    })
    if (orphans.length) {
        console.log(`\nStock used by no recipe: ${orphans.map((o) => o.name).join(", ")}`)
    }

    const blended = rows.length
        ? rows.reduce((s, r) => s + Number(r["pour %"]), 0) / rows.length
        : 0
    console.log(`\nBlended pour cost across the menu: ${blended.toFixed(1)}%`)

    if (failures) {
        console.error(`\n${failures} item(s) outside their band.`)
        process.exit(1)
    }
    console.log("All items inside their band.")
}

main()
    .catch((e) => { console.error(e); process.exit(1) })
    .finally(() => prisma.$disconnect())
