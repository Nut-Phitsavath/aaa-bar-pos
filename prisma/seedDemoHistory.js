/**
 * Demo trading history for AAA.
 *
 * Separate from `db:seed` on purpose: that one leaves a clean venue you could
 * open with, this one bolts three weeks of invented trading onto it so every
 * report has something to show. Never run it on a real till.
 *
 * The numbers are fake but the SHAPES are real - it writes what the app itself
 * would write, so the reports are exercising the same joins they will in
 * service:
 *   - table sessions closed by payments that sum exactly to the bill, so the
 *     Z-report's identity holds instead of being papered over
 *   - orders credited to a waiter, keyed by a till operator: the two are
 *     different people, which is the whole point of the server report
 *   - Owner VIP comps and pay-later tabs, so "comped" and "owed" are non-zero
 *   - voids, so a manager report has something to find
 *   - stock movements, so COGS and shrinkage are not empty
 */
const { PrismaClient } = require("@prisma/client")
const crypto = require("node:crypto")

const prisma = new PrismaClient()

const DAYS = 21
const RATE_LAK = 680
const RATE_USD = 32

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]
const between = (a, b) => a + Math.floor(Math.random() * (b - a + 1))
const chance = (p) => Math.random() < p

/** Bar hours: nothing before 6pm, most of it late. */
function tradingTime(dayOffset) {
    const d = new Date()
    d.setDate(d.getDate() - dayOffset)
    // 18:00-01:00, weighted to 21:00-23:00 by averaging two draws.
    const hour = Math.min(25, Math.round((between(18, 25) + between(20, 24)) / 2))
    d.setHours(hour % 24, between(0, 59), between(0, 59), 0)
    if (hour >= 24) d.setDate(d.getDate() + 1)
    return d
}

async function main() {
    const waiters = await prisma.user.findMany({ where: { role: "WAITER" } })
    const tills = await prisma.user.findMany({ where: { role: { in: ["STAFF", "ADMIN"] } } })
    const tables = await prisma.table.findMany()
    const customers = await prisma.customer.findMany()
    const sizes = await prisma.variationSize.findMany({
        include: { variation: { include: { menu: true } } },
    })
    const recipes = await prisma.recipe.findMany()
    const ingredients = await prisma.ingredient.findMany()

    if (!waiters.length || !sizes.length || !tables.length) {
        console.error("Run `npm run db:seed` first - there is no menu or floor to trade against.")
        process.exit(1)
    }

    // One waiter is deliberately the star and one is quiet, so the ranking has
    // something to say rather than four identical bars.
    const weighted = [waiters[0], waiters[0], waiters[0], waiters[1], waiters[1], waiters[2], waiters[3]]

    console.log(`Generating ${DAYS} days of trading...`)
    let sessionCount = 0, orderCount = 0, voidCount = 0, compCount = 0, tabCount = 0
    let dayNo = 0

    for (let d = DAYS; d >= 1; d--) {
        const openedAt = tradingTime(d)
        openedAt.setHours(17, 30, 0, 0)

        const shift = await prisma.shift.create({
            data: {
                userId: pick(tills).id,
                startTime: openedAt,
                startCash: 2000,
                status: "CLOSED",
                responsiblePerson: pick(tills).name,
            },
        })

        let shiftCash = 0
        const busy = chance(0.3) ? between(10, 16) : between(4, 9)

        for (let s = 0; s < busy; s++) {
            const table = pick(tables)
            const start = tradingTime(d)
            const session = await prisma.tableSession.create({
                data: {
                    tableId: table.id,
                    status: "OPEN",
                    openedAt: start,
                    openedById: pick(tills).id,
                },
            })
            sessionCount++

            // A table drinks in rounds; a VIP room drinks in more of them.
            const rounds = table.area === "VIP" ? between(3, 6) : between(1, 4)
            let gross = 0
            const roundWaiters = []

            for (let r = 1; r <= rounds; r++) {
                const waiter = pick(weighted)
                roundWaiters.push(waiter)
                const till = pick(tills)
                const when = new Date(start.getTime() + r * between(8, 40) * 60000)

                const lines = []
                for (let n = 0; n < between(1, 3); n++) {
                    const vs = pick(sizes)
                    const qty = vs.price > 500 ? 1 : between(1, 6)
                    lines.push({ vs, qty })
                }
                const total = lines.reduce((sum, l) => sum + l.vs.price * l.qty, 0)

                // A round is occasionally rung up wrong and voided.
                const voided = chance(0.04)
                if (!voided) gross += total
                if (voided) voidCount++

                const dayCount = await prisma.order.count({ where: { createdAt: { gte: new Date(when.getFullYear(), when.getMonth(), when.getDate()) } } })

                await prisma.order.create({
                    data: {
                        orderNumber: `No. ${String(dayCount + 1).padStart(2, "0")}`,
                        tableOrderNumber: r,
                        status: voided ? "CANCELLED" : "COMPLETED",
                        cancellationReason: voided ? pick(["Wrong table", "Duplicate order", "Customer changed mind"]) : null,
                        total, subtotal: total, tax: Math.round(total - total / 1.1),
                        paymentMethod: "CASH",
                        createdAt: when, updatedAt: when,
                        sessionId: session.id,
                        waiterId: waiter.id,
                        userId: till.id,
                        shiftId: voided ? null : shift.id,
                        items: {
                            create: lines.map((l) => ({
                                variationSizeId: l.vs.id,
                                name: l.vs.variation.menu.name,
                                price: l.vs.price,
                                quantity: l.qty,
                                total: l.vs.price * l.qty,
                            })),
                        },
                    },
                })
                orderCount++

                // Stock leaves the shelf when the drink is served.
                if (!voided) {
                    for (const l of lines) {
                        for (const rec of recipes.filter((x) => x.menuId === l.vs.variation.menuId)) {
                            // Rounded in SQL for the same reason the till does
                            // it: 30ml out of a 700ml bottle is 0.042857... and
                            // subtracting that 500 times leaves fourteen
                            // decimals of noise on the count sheet.
                            await prisma.$executeRaw`
                                UPDATE "Ingredient"
                                SET "subStock" = ROUND("subStock" - ${rec.quantity * l.qty}, 3)
                                WHERE "id" = ${rec.ingredientId}
                            `.catch(() => { })
                        }
                    }
                }
            }

            // A discount on the odd big table.
            let discountType = null, discountValue = null, discount = 0
            if (gross > 1500 && chance(0.25)) {
                discountType = "PERCENT"; discountValue = pick([5, 10])
                discount = Math.floor(gross * (discountValue / 100))
            }
            const billTotal = Math.max(0, Math.ceil(gross - discount))
            const closedAt = new Date(start.getTime() + between(60, 240) * 60000)

            // How it ended: mostly paid, sometimes comped, occasionally a tab.
            const roll = Math.random()
            const payments = []

            if (billTotal === 0) {
                // nothing ordered; just close it
            } else if (roll < 0.06) {
                payments.push({ method: "OWNER_VIP", amount: billTotal, paymentStatus: "PAID" })
                compCount++
            } else if (roll < 0.11 && customers.length) {
                // Pay-later: closes owing, nothing collected tonight.
                tabCount++
            } else if (roll < 0.28) {
                // Split tender: some cash, the rest on the QR.
                const cash = Math.round(billTotal * pick([0.3, 0.5, 0.6]))
                payments.push({ method: "CASH", amount: cash, paymentStatus: "PAID" })
                payments.push({ method: "ONEPAY", amount: billTotal - cash, paymentStatus: "PAID" })
                shiftCash += cash
            } else if (roll < 0.45) {
                payments.push({ method: "ONEPAY", amount: billTotal, paymentStatus: "PAID" })
            } else {
                payments.push({ method: "CASH", amount: billTotal, paymentStatus: "PAID" })
                shiftCash += billTotal
            }

            for (const p of payments) {
                await prisma.payment.create({
                    data: {
                        sessionId: session.id,
                        method: p.method,
                        amount: p.amount,
                        paymentStatus: p.paymentStatus,
                        userId: pick(tills).id,
                        createdAt: closedAt,
                    },
                })
            }

            const isTab = roll >= 0.06 && roll < 0.11 && customers.length && billTotal > 0
            await prisma.tableSession.update({
                where: { id: session.id },
                data: {
                    status: "CLOSED",
                    closedAt,
                    fxRateLAK: RATE_LAK,
                    fxRateUSD: RATE_USD,
                    discountType, discountValue,
                    isOwnerVip: roll < 0.06 && billTotal > 0,
                    customerId: isTab ? pick(customers).id : null,
                },
            })
        }

        // A few walk-in counter sales, so the service split is not 100% tables.
        for (let w = 0; w < between(0, 4); w++) {
            const when = tradingTime(d)
            const vs = pick(sizes)
            const qty = between(1, 3)
            const total = vs.price * qty
            await prisma.order.create({
                data: {
                    orderNumber: `No. W${w + 1}`,
                    status: "COMPLETED",
                    total, subtotal: total, tax: Math.round(total - total / 1.1),
                    paymentMethod: chance(0.7) ? "CASH" : "ONEPAY",
                    createdAt: when, updatedAt: when,
                    userId: pick(tills).id,
                    shiftId: shift.id,
                    cashReceived: total,
                    items: { create: [{ variationSizeId: vs.id, name: vs.variation.menu.name, price: vs.price, quantity: qty, total }] },
                },
            })
            orderCount++
            shiftCash += total
        }

        // Deliveries in, and the occasional loss the shrinkage report exists for.
        //
        // These used to write a StockTransaction row and stop, so every delivery
        // was cosmetic: sales took stock off the shelf for 21 days and nothing
        // ever put any back, which is how Beer Lao reached -656 bottles. A bar
        // reorders what has fallen below its par level, so that is what happens
        // here - the transaction and the stock move together.
        for (const ing of ingredients) {
            const current = await prisma.ingredient.findUnique({
                where: { id: ing.id },
                select: { subStock: true, minStockSub: true, maxStockSub: true },
            })
            if (!current || current.subStock >= current.minStockSub) continue

            const quantity = Math.ceil(current.maxStockSub - current.subStock)
            await prisma.stockTransaction.create({
                data: {
                    ingredientId: ing.id, type: "DEPOSIT",
                    quantity, cost: ing.cost,
                    notes: "Delivery", userId: pick(tills).id,
                    createdAt: tradingTime(d),
                },
            })
            await prisma.$executeRaw`
                UPDATE "Ingredient"
                SET "subStock" = ROUND("subStock" + ${quantity}, 3)
                WHERE "id" = ${ing.id}
            `
        }
        if (chance(0.35)) {
            const ing = pick(ingredients)
            await prisma.stockTransaction.create({
                data: {
                    ingredientId: ing.id, type: "SHOP_ADJUST",
                    quantity: -between(1, 6), cost: ing.cost,
                    reason: pick(["THEFT", "COUNTING_ERROR", "OTHER"]),
                    notes: "Stock count variance", userId: pick(tills).id,
                    createdAt: tradingTime(d),
                },
            })
        }

        const counted = shiftCash + 2000 - (chance(0.25) ? between(1, 60) : 0)
        await prisma.shift.update({
            where: { id: shift.id },
            data: {
                endTime: new Date(openedAt.getTime() + 9 * 3600000),
                cashPayments: shiftCash,
                endCash: shiftCash + 2000,
                actualCash: counted,
                difference: counted - (shiftCash + 2000),
            },
        })

        dayNo++
        if (dayNo % 7 === 0) console.log(`  ...${dayNo} days`)
    }

    console.log(`
Demo history generated:
  ${sessionCount} table sessions, ${orderCount} orders
  ${voidCount} voided rounds, ${compCount} Owner VIP comps, ${tabCount} pay-later tabs
  ${DAYS} shifts with cash counts and variances

  Every report tab now has data. Re-run \`npm run db:seed\` to wipe it back
  to a clean venue.
`)
}

main()
    .catch((e) => { console.error(e); process.exit(1) })
    .finally(async () => { await prisma.$disconnect() })
