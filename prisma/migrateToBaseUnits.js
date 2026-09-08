/**
 * One-off: move stock and recipe quantities onto real base units.
 *
 * Run a dry run first. It reports what it would change and, more importantly,
 * every row it cannot convert - the script never guesses.
 *
 *   node prisma/migrateToBaseUnits.js            # dry run, writes nothing
 *   node prisma/migrateToBaseUnits.js --commit   # applies it
 *
 * Reversible: the pre-migration values are written into a StockTransaction row
 * per ingredient, so the conversion is itself auditable.
 */
const { PrismaClient } = require("@prisma/client")

const prisma = new PrismaClient()
const COMMIT = process.argv.includes("--commit")

/**
 * Spirit bottles, in ml.
 *
 * CONFIRM AGAINST THE OWNER'S ACTUAL BOTTLES BEFORE RUNNING WITH --commit.
 * 700 is used because it makes the existing pours land on exactly 30ml and
 * 45ml, which is what a jigger measures - but it is four rows of real stock
 * and worth a look at the shelf.
 */
const BOTTLE_ML = {
    "Hongthong (bottle)": 700,
    "Vodka (bottle)": 700,
    "White Rum (bottle)": 700,
    "Gin (bottle)": 700,
    "Chivas 12 (bottle)": 700,
    "Johnnie Walker Black (bottle)": 700,
}

const LEGACY = {
    kg: { measureType: "WEIGHT", baseUnit: "g", multiplier: 1000 },
    litre: { measureType: "VOLUME", baseUnit: "ml", multiplier: 1000 },
    can: { measureType: "EACH", baseUnit: "each", multiplier: 1 },
    piece: { measureType: "EACH", baseUnit: "each", multiplier: 1 },
    bunch: { measureType: "EACH", baseUnit: "each", multiplier: 1 },
}

/** How one ingredient should be read after the migration. */
function planFor(ingredient) {
    const ml = BOTTLE_ML[ingredient.name]
    if (ml) {
        // A spirit: bought by the bottle, poured by the millilitre.
        return { measureType: "VOLUME", baseUnit: "ml", purchaseUnit: "bottle", purchaseMultiplier: ml }
    }
    if (ingredient.unit === "bottle") {
        // A beer or a mixer: the bottle IS the unit, you never pour half.
        return { measureType: "EACH", baseUnit: "each", purchaseUnit: "bottle", purchaseMultiplier: 1 }
    }
    const legacy = LEGACY[ingredient.unit]
    if (!legacy) return null
    return {
        measureType: legacy.measureType,
        baseUnit: legacy.baseUnit,
        purchaseUnit: ingredient.unit,
        purchaseMultiplier: legacy.multiplier,
    }
}

function toBase(quantity, multiplier) {
    return Math.round(quantity * multiplier * 1e6) / 1e6
}

async function main() {
    const ingredients = await prisma.ingredient.findMany({ orderBy: { name: "asc" } })
    const recipes = await prisma.recipe.findMany({ include: { ingredient: true, menu: true } })

    // Refuse to run twice. A second pass would multiply already-converted
    // quantities by the multiplier again, turning 8,400 ml into 5,880,000.
    const alreadyRun = await prisma.stockTransaction.count({ where: { type: "UNIT_MIGRATION" } })
    if (alreadyRun > 0) {
        console.log(`Already migrated: ${alreadyRun} UNIT_MIGRATION rows exist. Refusing to run again.`)
        process.exit(1)
    }

    const plans = new Map()
    const unconvertible = []

    for (const ing of ingredients) {
        const plan = planFor(ing)
        if (!plan) { unconvertible.push(`ingredient "${ing.name}" has unit "${ing.unit}" — no rule`); continue }
        plans.set(ing.id, plan)
    }

    console.log(COMMIT ? "APPLYING\n" : "DRY RUN — nothing will be written\n")
    console.log("INGREDIENTS")
    for (const ing of ingredients) {
        const p = plans.get(ing.id)
        if (!p) continue
        console.log(
            `  ${ing.name.padEnd(30)} ${ing.unit.padEnd(7)} -> ${p.measureType.padEnd(6)} ` +
            `1 ${p.purchaseUnit} = ${String(p.purchaseMultiplier).padEnd(5)} ${p.baseUnit.padEnd(5)} | ` +
            `sub ${ing.subStock} -> ${toBase(ing.subStock, p.purchaseMultiplier)}`
        )
    }

    console.log("\nRECIPES")
    for (const r of recipes) {
        const p = plans.get(r.ingredientId)
        if (!p) { unconvertible.push(`recipe "${r.menu.name} / ${r.ingredient.name}" — ingredient has no rule`); continue }
        console.log(
            `  ${(r.menu.name + " / " + r.ingredient.name).padEnd(46)} ` +
            `${String(r.quantity).padEnd(22)} -> ${toBase(r.quantity, p.purchaseMultiplier)} ${p.baseUnit}`
        )
    }

    if (unconvertible.length) {
        console.log("\nCANNOT CONVERT — fix these before committing:")
        for (const u of unconvertible) console.log("  " + u)
        if (COMMIT) { console.log("\nRefusing to write a partial migration."); process.exit(1) }
    }

    if (!COMMIT) {
        console.log("\nRe-run with --commit to apply.")
        return
    }

    await prisma.$transaction(async (tx) => {
        for (const ing of ingredients) {
            const p = plans.get(ing.id)
            if (!p) continue
            await tx.stockTransaction.create({
                data: {
                    ingredientId: ing.id,
                    type: "UNIT_MIGRATION",
                    quantity: 0,
                    reason: ing.unit,
                    notes: `pre-migration main=${ing.mainStock} sub=${ing.subStock} unit=${ing.unit} multiplier=${p.purchaseMultiplier}`,
                },
            })
            await tx.ingredient.update({
                where: { id: ing.id },
                data: {
                    ...p,
                    mainStock: toBase(ing.mainStock, p.purchaseMultiplier),
                    subStock: toBase(ing.subStock, p.purchaseMultiplier),
                    minStock: toBase(ing.minStock, p.purchaseMultiplier),
                    maxStock: toBase(ing.maxStock, p.purchaseMultiplier),
                    minStockSub: toBase(ing.minStockSub, p.purchaseMultiplier),
                    maxStockSub: toBase(ing.maxStockSub, p.purchaseMultiplier),
                    // Cost stays per purchase unit, which is what the invoice
                    // says. Cost per base unit is derived, never stored, so a
                    // price change cannot leave two figures disagreeing.
                },
            })
        }
        for (const r of recipes) {
            const p = plans.get(r.ingredientId)
            if (!p) continue
            await tx.recipe.update({
                where: { id: r.id },
                data: { quantity: toBase(r.quantity, p.purchaseMultiplier) },
            })
        }
    })

    console.log("\nDone.")
}

main()
    .catch((e) => { console.error(e); process.exit(1) })
    .finally(() => prisma.$disconnect())
