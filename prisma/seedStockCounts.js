/**
 * Example stock counts, so the Variance report has something to show.
 *
 * The Variance tab is empty on this database for a structural reason, not
 * because nobody has bothered: `POST /api/inventory/stock-count` exists and
 * writes StockCount rows, but no screen in the app calls it. The audit sheet
 * prints, somebody walks the shelf with it, and there is nowhere to type the
 * numbers back in. Until that screen exists this seed is the only way to see
 * what the report does with real-shaped data.
 *
 * Deliberately writes StockCount rows ONLY.
 *
 * The real endpoint also books a SHOP_ADJUST transaction and moves subStock, so
 * that a count corrects the shelf. Doing that here would quietly rewrite your
 * actual stock levels for the sake of a demo, and you would be chasing the
 * difference at the next real count. The variance report reads StockCount and
 * nothing else, so the rows alone are enough to populate it.
 *
 * Counts are written against the ingredient's CURRENT subStock as theoretical,
 * with a plausible discrepancy on top - shrinkage on the spirits where it
 * usually is, a small overage on a mixer, and a couple of exact counts, because
 * a report where every line is wrong teaches you nothing about reading it.
 *
 *   node prisma/seedStockCounts.js          add the example counts
 *   node prisma/seedStockCounts.js --clear  remove every count this wrote
 *
 * Everything it writes is tagged in `notes`, so --clear removes exactly these
 * rows and never a real one.
 */
const { PrismaClient } = require("@prisma/client")

const prisma = new PrismaClient()

const TAG = "[demo]"

/**
 * Discrepancies in PURCHASE units - bottles, cans - because that is what a
 * person counts. Converted to base units on the way in, the same way the
 * inventory screen does it.
 *
 * Negative is short: the shelf holds less than the till thinks.
 */
const PATTERN = [
    { match: /vodka/i, off: -1.5, note: "heavy pours on the late shift" },
    { match: /chivas/i, off: -0.5, note: "half a bottle unaccounted" },
    { match: /gin/i, off: -1, note: "" },
    { match: /beer lao/i, off: -4, note: "crate count disagreed with the fridge" },
    { match: /heineken/i, off: 3, note: "found a case behind the door" },
    { match: /soda water/i, off: -6, note: "" },
    { match: /red bull/i, off: 0, note: "counted twice, agreed" },
    { match: /lime/i, off: 0, note: "" },
]

async function clear() {
    const { count } = await prisma.stockCount.deleteMany({
        where: { notes: { startsWith: TAG } },
    })
    console.log(`Removed ${count} demo stock count(s).`)
    if (count === 0) console.log("Nothing tagged " + TAG + " was in the table.")
}

async function seed() {
    const existing = await prisma.stockCount.count({ where: { notes: { startsWith: TAG } } })
    if (existing > 0) {
        console.log(`${existing} demo count(s) already present. Run with --clear first to reseed.`)
        return
    }

    // Whoever holds the clipboard. The report's "counted by" column is the
    // question a manager actually has, so it must not be a dash.
    const counter =
        (await prisma.user.findFirst({ where: { role: "MANAGER" } })) ??
        (await prisma.user.findFirst({ where: { role: "ADMIN" } }))

    const ingredients = await prisma.ingredient.findMany({
        select: {
            id: true, name: true, subStock: true,
            purchaseUnit: true, purchaseMultiplier: true, cost: true,
        },
    })

    // One count sheet, walked this evening. All rows share a timestamp because
    // that is what a stocktake is - one pass of the shelf, not eight events.
    const countedAt = new Date()

    const rows = []
    const skipped = []
    for (const p of PATTERN) {
        const ing = ingredients.find((i) => p.match.test(i.name))
        if (!ing) continue

        const multiplier = ing.purchaseMultiplier || 1
        const theoretical = ing.subStock

        // A shelf that already holds less than nothing cannot be counted
        // against. Chivas sits at -700 on this database - one bottle sold that
        // was never transferred to the shop - and clamping that at zero turned
        // a bottle SHORT into a +1,150 baht overage, which is the exact
        // opposite of the truth. Refuse the row and say so: demo data that
        // lies about the direction of a variance is worse than a missing line.
        if (theoretical < 0) {
            skipped.push(`${ing.name}: shelf is ${theoretical} - fix the stock level first`)
            continue
        }
        // Same reason, less dramatic: an offset bigger than the shelf would be
        // silently trimmed and the row would not mean what it says.
        if (theoretical + p.off * multiplier < 0) {
            skipped.push(`${ing.name}: only ${theoretical / multiplier} ${ing.purchaseUnit} on the shelf`)
            continue
        }

        const actual = theoretical + p.off * multiplier
        const difference = actual - theoretical

        rows.push({
            ingredientId: ing.id,
            theoreticalStock: theoretical,
            actualStock: actual,
            difference,
            notes: [TAG, p.note].filter(Boolean).join(" "),
            userId: counter?.id ?? null,
            createdAt: countedAt,
            _name: ing.name,
            _value: difference * (ing.cost / multiplier),
            _unit: ing.purchaseUnit,
            _multiplier: multiplier,
            _off: p.off,
        })
    }

    if (rows.length === 0) {
        console.log("No matching ingredients found - nothing seeded.")
        return
    }

    await prisma.stockCount.createMany({
        data: rows.map(({ _name, _value, _unit, _off, _multiplier, ...row }) => row),
    })

    console.log(`Wrote ${rows.length} stock counts, all at ${countedAt.toISOString()}.\n`)
    for (const r of rows) {
        // The difference actually stored, not the offset that was asked for.
        // Printing the intent is how the clamped Chivas row came out reading
        // "-0.5 bottle" beside "+1,150 baht" without anything looking wrong.
        const inPurchase = r.difference / (r._multiplier || 1)
        const off = inPurchase === 0 ? "exact" : `${inPurchase > 0 ? "+" : ""}${inPurchase} ${r._unit}`
        console.log(`  ${r._name.padEnd(24)} ${off.padEnd(16)} ${r._value ? `฿${Math.round(r._value)}` : ""}`)
    }
    if (skipped.length) {
        console.log("\nSkipped:")
        for (const s of skipped) console.log(`  ${s}`)
    }

    const shrinkage = rows.filter((r) => r._value < 0).reduce((n, r) => n + r._value, 0)
    const overage = rows.filter((r) => r._value > 0).reduce((n, r) => n + r._value, 0)
    // Reported apart, never netted: a night that lost 5,000 and found 5,000 is
    // not a night that balanced, it is two problems.
    console.log(`\n  Shrinkage ฿${Math.abs(Math.round(shrinkage))}   Overage ฿${Math.round(overage)}`)
    console.log("\nReports -> Variance. Set the range to include today.")
    console.log("Stock levels were NOT touched. Undo with: node prisma/seedStockCounts.js --clear")
}

const main = process.argv.includes("--clear") ? clear : seed

main()
    .catch((e) => { console.error(e); process.exitCode = 1 })
    .finally(() => prisma.$disconnect())
