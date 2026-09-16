import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { barHour, tradingDay, tradingHours } from '@/lib/trading-day'
import { recipeCost, pourCost, verdictFor, bandFor } from '@/lib/pour-cost'
import { sessionTotal } from '@/lib/sessions'
import { billTotalOf } from '@/lib/payments'
// One definition of a countable sale, shared with the export and the Z-report
// rather than re-decided here. See lib/reporting.ts for what drifted.
import { COUNTED_ORDER, COUNTED_LINE, periodDiscounts } from '@/lib/reporting'
import { startOfDay, endOfDay } from 'date-fns'

/** Movement types whose `reason` column holds a reason a person chose. */
const REASONED_TYPES = new Set(['SHOP_ADJUST', 'WITHDRAW'])

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url)
        const startDateStr = searchParams.get('startDate')
        const endDateStr = searchParams.get('endDate')

        let startDate: Date
        let endDate: Date

        if (startDateStr) {
            startDate = new Date(startDateStr)
            if (isNaN(startDate.getTime())) {
                const [y, m, d] = startDateStr.split('-').map(Number)
                startDate = new Date(y, m - 1, d, 0, 0, 0, 0)
            } else if (!startDateStr.includes('T')) {
                startDate.setHours(0, 0, 0, 0)
            }
        } else {
            startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
            startDate.setHours(0, 0, 0, 0)
        }

        if (endDateStr) {
            endDate = new Date(endDateStr)
            if (isNaN(endDate.getTime())) {
                const [y, m, d] = endDateStr.split('-').map(Number)
                endDate = new Date(y, m - 1, d, 23, 59, 59, 999)
            } else if (!endDateStr.includes('T')) {
                endDate.setHours(23, 59, 59, 999)
            }
        } else {
            endDate = new Date()
        }

        // 1. Daily Trend
        const orders = await prisma.order.findMany({
            where: {
                createdAt: {
                    gte: startDate,
                    lte: endDate
                },
                ...COUNTED_ORDER
            },
            select: {
                total: true,
                createdAt: true,
                discount: true,
                sessionId: true,
                user: { select: { name: true } },
                // Who served it. In a bar this is the person who sold the round;
                // the one at the till keyed it in afterwards.
                waiter: { select: { name: true } }
            }
        })

        console.log(`Analytics: Found ${orders.length} orders between ${startDate.toISOString()} and ${endDate.toISOString()}`)

        const trendMap = new Map()
        orders.forEach(o => {
            // The night it belonged to, not the calendar date. Friday's
            // takings run past midnight and stay Friday's.
            const date = tradingDay(o.createdAt)
            if (!trendMap.has(date)) trendMap.set(date, { date, revenue: 0, orders: 0 })
            const entry = trendMap.get(date)
            entry.revenue += o.total
            entry.orders += 1
        })
        const dailyTrend = Array.from(trendMap.values()).sort((a, b) => a.date.localeCompare(b.date))

        // Who sold it.
        //
        // This credited `o.user` - whoever was standing at the till - which in a
        // bar is not the person who sold anything. Three staff taking turns on
        // the POS produced three near-identical bars: a chart of the roster, not
        // of performance. The waiter who worked the table is whose revenue this
        // is, and measured that way the same sales show a 2.7x spread between
        // the best server and the weakest.
        //
        // A counter sale has no waiter and is nobody's performance, so it is
        // left out rather than lumped under "Unknown".
        const serverMap = new Map()
        orders.forEach(o => {
            const name = o.waiter?.name
            if (!name) return
            if (!serverMap.has(name)) serverMap.set(name, { name, revenue: 0, orders: 0 })
            const entry = serverMap.get(name)
            entry.revenue += o.total
            entry.orders += 1
        })
        const serverSales = Array.from(serverMap.values()).sort((a, b) => b.revenue - a.revenue)

        // Table service vs the walk-in counter. For a bar this is the split
        // that matters; takeaway vs dine-in is a cafe question - a bar is dine
        // in by definition, so that chart always read 100/0.
        const tableOrders = orders.filter((o) => o.sessionId)
        const walkInOrders = orders.filter((o) => !o.sessionId)
        const serviceStats = [
            { name: 'Tables', revenue: tableOrders.reduce((s, o) => s + o.total, 0), count: tableOrders.length },
            { name: 'Walk-in', revenue: walkInOrders.reduce((s, o) => s + o.total, 0), count: walkInOrders.length },
        ]

        // 1b. Where in the room the money came from.
        //
        // `Table.area` has carried INDOOR / OUTDOOR / VIP and this bar's own
        // named floors since the floor plan was built, and no report has ever
        // grouped by it. For a bar with VIP rooms that is the first question an
        // owner asks and the page could not answer it.
        //
        // Priced off the closed bill rather than the rounds, so a discounted
        // VIP table is compared on what it actually paid. Keyed on closedAt for
        // the same reason the Z-report is: a bill belongs to the night it was
        // settled, and only a settled bill has a length.
        //
        // The figure worth reading here is revenuePerHour. Takings alone reward
        // a table for sitting there all night; a VIP room that turns ฿8,000 in
        // two hours and one that turns ฿9,000 in six are not the same table,
        // and only the per-hour column says so.
        const areaSessions = await prisma.tableSession.findMany({
            where: { closedAt: { gte: startDate, lte: endDate } },
            select: {
                openedAt: true,
                closedAt: true,
                discountType: true,
                discountValue: true,
                table: { select: { area: true } },
                orders: { select: { status: true, total: true } },
            }
        })

        const areaMap = new Map()
        areaSessions.forEach(s => {
            const area = s.table?.area || 'Unknown'
            if (!areaMap.has(area)) areaMap.set(area, { area, revenue: 0, bills: 0, minutes: 0 })
            const entry = areaMap.get(area)
            entry.revenue += billTotalOf(sessionTotal(s.orders), s.discountType, s.discountValue)
            entry.bills += 1
            // Clamped at zero: two tills on a bar's wifi do not agree to the
            // second, and a negative length would drag an average sideways.
            entry.minutes += Math.max(0, ((s.closedAt?.getTime() ?? 0) - s.openedAt.getTime()) / 60000)
        })

        const areaStats = Array.from(areaMap.values()).map(a => ({
            area: a.area,
            revenue: Math.round(a.revenue),
            bills: a.bills,
            avgBill: a.bills > 0 ? Math.round(a.revenue / a.bills) : 0,
            avgMinutes: a.bills > 0 ? Math.round(a.minutes / a.bills) : 0,
            revenuePerHour: a.minutes > 0 ? Math.round(a.revenue / (a.minutes / 60)) : 0,
        })).sort((a, b) => b.revenue - a.revenue)

        // 2. Category Share
        //
        // Struck lines are not sales. Every per-item figure on this page reads
        // this one query - category share, best sellers, worst sellers and the
        // COGS that gross profit is built from - and none of them filtered the
        // void stamp, so a drink rung up and taken back off still counted as
        // sold and still charged the bar for its pour. The order's own total is
        // recomputed on void, which is why the headline revenue was right while
        // everything broken down by item was not.
        const orderItems = await prisma.orderItem.findMany({
            where: {
                ...COUNTED_LINE,
                order: {
                    createdAt: { gte: startDate, lte: endDate },
                    ...COUNTED_ORDER
                }
            },
            include: {
                menu: {
                    include: { category: true }
                }
            }
        })

        const categoryMap = new Map()
        orderItems.forEach(item => {
            const catName = item.menu?.category.name || "Other"

            if (!categoryMap.has(catName)) categoryMap.set(catName, { category: catName, revenue: 0, quantity: 0 })
            const entry = categoryMap.get(catName)
            entry.revenue += item.total
            entry.quantity += item.quantity
        })
        const categoryShare = Array.from(categoryMap.values()).sort((a, b) => b.revenue - a.revenue)

        // 3. Hourly Sales
        const hourMap = new Map()
        orders.forEach(o => {
            // The clock behind the bar, not the one the server is set to.
            const hour = barHour(o.createdAt).toString().padStart(2, '0')
            if (!hourMap.has(hour)) hourMap.set(hour, { hour, revenue: 0, orders: 0 })
            const entry = hourMap.get(hour)
            entry.revenue += o.total
            entry.orders += 1
        })
        // Ordered as the night runs, not 00 to 23.
        //
        // Sorting the hour as a string put this bar's busiest stretch - 21:00
        // through 02:00 - at opposite ends of the chart with its quietest hours
        // in the middle, so one continuous evening was drawn as two mountains
        // and a valley. Starting the axis at the trading-day boundary makes the
        // night one unbroken run.
        //
        // All 24 hours, always, including the empty ones. Two reasons: a quiet
        // hour reads as a gap rather than a column that silently closes up, and
        // the axis stays the same width whatever range is selected, so two
        // periods can be compared by eye. Trimming the dead hours was tried and
        // removed - it made the chart's width depend on its data, and the
        // afternoon being empty is itself worth seeing.
        const hourlySales = tradingHours().map(
            (hour) => hourMap.get(hour) ?? { hour, revenue: 0, orders: 0 }
        )

        // 4. Payment Methods
        // How bills were actually settled.
        //
        // Read from Payment rows for table sales, not order.paymentMethod: a
        // split-tendered bill has no single method, and the column on the order
        // only records whichever one closed it. Walk-in counter sales have no
        // Payment rows, so those still come from the order.
        //
        // Comps are left out. This chart answers "what did we take, and how",
        // and an Owner VIP bill is a bill nobody paid - the Z-report is where
        // it belongs, on its own line beside the takings.
        const payMap = new Map()
        const add = (method: string, amount: number) => {
            const m = method === 'BANK_NOTE' ? 'CASH' : method
            if (m === 'OWNER_VIP' || m === 'PAY_LATER') return
            if (!payMap.has(m)) payMap.set(m, { paymentMethod: m, revenue: 0, orders: 0 })
            const entry = payMap.get(m)
            entry.revenue += amount
            entry.orders += 1
        }

        const sessionPayments = await prisma.payment.findMany({
            where: { createdAt: { gte: startDate, lte: endDate } },
            select: { method: true, amount: true, paymentStatus: true }
        })
        sessionPayments.forEach(p => {
            // A scanned-but-unconfirmed QR is not money; same rule as everywhere.
            if (p.method === 'ONEPAY' && p.paymentStatus !== 'PAID') return
            add(p.method, p.amount)
        })

        const walkInOrdersPaid = await prisma.order.findMany({
            where: {
                createdAt: { gte: startDate, lte: endDate },
                ...COUNTED_ORDER,
                sessionId: null
            },
            select: { paymentMethod: true, total: true }
        })
        walkInOrdersPaid.forEach(o => add(o.paymentMethod || 'CASH', o.total))

        const paymentMethods = Array.from(payMap.values())

        // 5. Product Performance
        const bestSellerMap = new Map()
        const lowPerfMap = new Map()

        orderItems.forEach(item => {
            const menuName = item.menu?.name || item.name.split(' - ')[0]

            // Best Seller Key: menu name alone. There's one price per item now,
            // so there's nothing left to vary the key by.
            const bestSellerKey = menuName

            if (!bestSellerMap.has(bestSellerKey)) {
                bestSellerMap.set(bestSellerKey, { name: menuName, productName: menuName, sold: 0, revenue: 0 })
            }
            const bsEntry = bestSellerMap.get(bestSellerKey)
            bsEntry.sold += item.quantity
            bsEntry.revenue += item.total

            // Low Performance Key: Menu only (e.g., Latte)
            const lowPerfKey = menuName
            if (!lowPerfMap.has(lowPerfKey)) {
                lowPerfMap.set(lowPerfKey, { name: lowPerfKey, sold: 0, revenue: 0 })
            }
            const lpEntry = lowPerfMap.get(lowPerfKey)
            lpEntry.sold += item.quantity
            lpEntry.revenue += item.total
        })

        const productPerformance = Array.from(bestSellerMap.values())
            .sort((a, b) => b.sold - a.sold)

        const worstProducts = Array.from(lowPerfMap.values())
            .filter(p => p.sold > 0)
            .sort((a, b) => a.sold - b.sold)
            .slice(0, 10)

        // Zero Sales / Trash Items: Count by Menu (Only for ACTIVE/AVAILABLE menus)
        const allAvailableMenus = await prisma.menu.findMany({
            where: { isAvailable: true }
        })

        const soldMenuNames = new Set(Array.from(lowPerfMap.keys()))
        const trashItems = allAvailableMenus
            .filter(m => !soldMenuNames.has(m.name))
            .map(m => ({
                name: m.name,
                price: 0 // Price varies
            }))

        // Takeaway, sugar level and shot type used to be computed here. All
        // three were the cafe's questions and none of them has an answer in a
        // bar, measured across the whole database: 0 of 1,030 order lines were
        // takeaway, and sugar and shot each hold exactly one value on the 50
        // lines that carry them at all - "Normal Sweet" and "Normal Shot", the
        // defaults nobody chose. Takeaway vs dine-in could only ever draw
        // 100/0, which the route already said in a comment, and it was returned
        // to a page that never rendered it.
        //
        // The modifier axis they belong to is the one the menu flatten removed:
        // a cafe sells one drink four ways, a bar sells four drinks.

        // --- Advanced Analytics (Margin, COGS, Shrinkage) ---

        // 1. Margin Analysis
        // Get all menu items with recipes and ingredient costs
        const menuRecipes = await prisma.menu.findMany({
            include: {
                // Pour-cost bands are per category - what is healthy for a beer
                // is not what is healthy for a spirit - so the verdict needs it.
                category: { select: { name: true } },
                recipes: {
                    // purchaseMultiplier is not optional here: Ingredient.cost
                    // is per purchase unit and Recipe.quantity is in base units,
                    // so without the divisor a 30ml pour is priced as a whole
                    // bottle.
                    include: { ingredient: { select: { cost: true, purchaseMultiplier: true } } }
                }
            }
        })

        const marginData: any[] = []
        menuRecipes.forEach(menu => {
            // One recipe list per item now - no base/override split, since
            // there's no size axis left to override by.
            //
            // Through lib/pour-cost rather than multiplied by hand. This read
            // `quantity * cost` since before the base-units migration, which
            // was right when quantity was a fraction of a bottle and became
            // wrong the moment it became millilitres: a Chivas set costed at
            // 817,040 baht to sell for 3,500, and every margin figure in these
            // reports was overstated by the ingredient's purchase multiplier.
            // The recipe editor has been using the correct function all along.
            const itemCost = recipeCost(menu.recipes.map((r) => ({
                quantity: r.quantity,
                costPerPurchaseUnit: r.ingredient.cost,
                purchaseMultiplier: r.ingredient.purchaseMultiplier,
            })))

            const price = menu.price
            const margin = price - itemCost
            const marginPercent = price > 0 ? (margin / price) * 100 : 0
            const pourCostPct = pourCost(itemCost, price)

            marginData.push({
                menuName: menu.name,
                category: menu.category?.name ?? null,
                price,
                cost: itemCost,
                margin,
                marginPercent,
                // The bar's own measure, with the verdict the recipe editor
                // already shows: a spirit at 15% is underpoured or underpriced,
                // one at 45% is being given away.
                pourCostPct,
                band: bandFor(menu.category?.name),
                verdict: verdictFor(menu.category?.name, pourCostPct),
            })
        })

        const lowMarginItems = [...marginData]
            .filter(item => item.price > 0)
            .sort((a, b) => a.marginPercent - b.marginPercent)
            .slice(0, 10)

        // 2. Daily COGS (Cost of Goods Sold)
        // a. From Sales
        let salesCost = 0
        // Cost per category, accumulated in the same pass, so the category
        // chart can carry the bar's own measure beside the revenue. Beer at
        // 25% and spirits at 25% are not the same news, and a single
        // bar-wide number hides which one moved.
        const categoryCost = new Map<string, number>()
        orderItems.forEach(item => {
            const menuRecord = menuRecipes.find(m => m.id === item.menuId)

            if (menuRecord) {
                // Same correction as the margin table above: per base unit, not
                // per bottle. This figure feeds totalCOGS and grossProfit, so
                // while it was wrong the reports showed a bar losing money on
                // every round it poured.
                const itemCost = recipeCost(menuRecord.recipes.map((r) => ({
                    quantity: r.quantity,
                    costPerPurchaseUnit: r.ingredient.cost,
                    purchaseMultiplier: r.ingredient.purchaseMultiplier,
                })))

                salesCost += itemCost * item.quantity

                const catName = item.menu?.category.name || "Other"
                categoryCost.set(catName, (categoryCost.get(catName) || 0) + itemCost * item.quantity)
            }
        })

        // Pour cost per category, on the same rows the revenue came from.
        for (const row of categoryShare) {
            row.cost = Math.round(categoryCost.get(row.category) || 0)
            row.pourCostPct = row.revenue > 0
                ? Math.round((row.cost / row.revenue) * 1000) / 10
                : null
            row.band = bandFor(row.category)
            row.verdict = verdictFor(row.category, row.pourCostPct ?? 0)
        }

        // wastageCost will be calculated after inventoryTransactions is fetched below

        // 3. Inventory Shrinkage
        // Based on SHOP_ADJUST transactions (calculated after inventoryTransactions is fetched)
        let shrinkageCost = 0
        let shrinkageDetails: any[] = []

        // Promotion ROI used to be computed here. The promotions engine is the
        // cafe's and this bar has never run one: 0 promotions exist, and 0 of
        // 570 orders carry a promo id. A bar discounts a table, by hand, with a
        // manager's name against it - that is req #15, and it is reported as
        // totalDiscounts below. The tab this fed drew an empty grid.

        // 7. Summary

        // What the bar gave away at the table (req #15).
        //
        // This summed `Order.discount`, which is the cafe's per-order discount
        // and a column this bar has never written: measured across the whole
        // database it is 0 on all 570 orders, while 27 table bills carry a
        // PERCENT discount between them. So the KPI read "0 discounts" on a bar
        // that discounts a table most nights, and - worse - every revenue and
        // profit figure on the page stayed gross of money that was never taken,
        // which is why this page and the Z-report disagreed on the same night.
        //
        // Priced through the same helper the bill screen and the Z-report use,
        // so the three cannot drift apart again. The difference includes the
        // round-up, because that is what the customer was actually charged.
        const discountedSessions = await prisma.tableSession.findMany({
            where: {
                discountType: { not: null },
                orders: {
                    some: {
                        createdAt: { gte: startDate, lte: endDate },
                        ...COUNTED_ORDER
                    }
                }
            },
            select: {
                discountType: true,
                discountValue: true,
                // Priced over the same orders the revenue above is summed
                // from, not over everything on the table. The bill screen
                // counts a SENT round because the customer is going to pay for
                // it; this page counts revenue as COMPLETED only, so pricing
                // the discount on the wider set takes money off a base that
                // was never added. Four rounds are sitting SENT on closed bills
                // in this database and that alone moved the total by ฿297.
                orders: {
                    where: { status: 'COMPLETED', isReportable: true },
                    select: { status: true, total: true }
                }
            }
        })
        // A discount is given against a whole bill, so the bill is counted
        // whole rather than sliced at the range boundary. Table sessions here
        // run about two hours, so one straddling midnight on the last day of a
        // range is both rare and small next to the alternative, which is a
        // discount figure that does not match any bill anyone can look at.
        const totalDiscounts = periodDiscounts(discountedSessions)

        // Summary Stats (robustified)
        const summaryStats = await prisma.order.aggregate({
            where: {
                createdAt: { gte: startDate, lte: endDate },
                ...COUNTED_ORDER
            },
            _sum: { total: true, discount: true, tax: true },
            _count: true,
            _avg: { total: true }
        })

        const grossRevenue = summaryStats._sum?.total || 0
        const totalOrders = (summaryStats._count as any) || 0
        const netRevenue = grossRevenue - totalDiscounts

        // Final verification check for the user in logs
        if ((summaryStats._count as any) === 0) {
            const lastOrder = await prisma.order.findFirst({ orderBy: { createdAt: 'desc' } })
            console.log("Analytics Diagnostic: No orders in range. Last order in DB:", lastOrder?.createdAt)
        }

        // Owner VIP comps (req #16).
        //
        // This watched `isReportable: false` - the cafe's complimentary flag,
        // which hid the order from reports entirely and which this bar has
        // never set on a single row. A card built to show the owner what was
        // given away read zero on six comped tables.
        //
        // A bar comp is an OWNER_VIP payment settling the bill, which is how
        // the Z-report already reads it: the stock was poured, the sale was
        // rung, and nobody paid. Voided tenders are excluded for the same
        // reason they are everywhere else - a comp handed back is not a comp.
        const compPayments = await prisma.payment.findMany({
            where: {
                method: 'OWNER_VIP',
                voidedAt: null,
                createdAt: { gte: startDate, lte: endDate }
            },
            select: {
                amount: true,
                session: {
                    select: {
                        customer: { select: { name: true } },
                        table: { select: { name: true } }
                    }
                }
            }
        })

        const complimentaryStats = {
            _count: compPayments.length,
            _sum: { total: compPayments.reduce((sum, p) => sum + p.amount, 0) }
        }

        const complimentaryMap = new Map()
        compPayments.forEach(p => {
            // Most comped tables are not a named regular, so the table is the
            // next best answer to "who" - and it is the one staff remember.
            const name = p.session?.customer?.name || p.session?.table?.name || "Unknown"
            if (!complimentaryMap.has(name)) {
                complimentaryMap.set(name, { customerName: name, orderCount: 0, totalValue: 0 })
            }
            const entry = complimentaryMap.get(name)
            entry.orderCount += 1
            entry.totalValue += p.amount
        })
        const complimentaryDetails = Array.from(complimentaryMap.values()).sort((a, b) => b.totalValue - a.totalValue)

        // Member-vs-guest and the loyalty scheme used to be computed here and
        // fed a whole Customers tab. Both are the cafe's: 0 of 570 orders carry
        // a customer and 0 of 2 customers hold a point, so the pie drew 100%
        // guest and the loyalty panel drew three zeroes, every time.
        //
        // The bar does have customers - a TableSession names one when a regular
        // sits down - but that is for tabs and comps (req #16, #19), and both
        // are already reported where they belong: the Z-report's tab lines, and
        // the comp card above.

        // Inventory Transaction Stats
        const inventoryTransactions = await prisma.stockTransaction.findMany({
            where: {
                createdAt: { gte: startDate, lte: endDate }
            },
            include: { ingredient: true, user: { select: { name: true } } },
            orderBy: { createdAt: 'desc' }
        })

        // Most Added to Warehouse (DEPOSIT transactions)
        const addedMap = new Map()
        inventoryTransactions
            .filter(t => t.type === 'DEPOSIT')
            .forEach(t => {
                const name = t.ingredient.name
                if (!addedMap.has(name)) {
                    addedMap.set(name, { name, quantity: 0, unit: t.ingredient.unit, transactions: 0 })
                }
                const entry = addedMap.get(name)
                entry.quantity += t.quantity
                entry.transactions += 1
            })
        const mostAdded = Array.from(addedMap.values()).sort((a, b) => b.quantity - a.quantity).slice(0, 10)

        // What actually left the shelf.
        //
        // This was "Most Transferred to Shop", reading TRANSFER rows. The bar
        // has never written one - it does not run a warehouse-to-shop transfer
        // step - so the card was permanently empty while the movement that
        // matters, stock going out of the door as drinks, had no card at all.
        //
        // Valued at cost as well as counted, because "180 bottles" and "3,200
        // baht" are the same fact told to two different people and only one of
        // them orders stock. Cost is per purchase unit and quantity is in base
        // units, so the multiplier divides - the same correction the margin
        // table and the variance report already make.
        const depletionMap = new Map()
        inventoryTransactions
            .filter(t => t.type === 'SALE' && t.fromStore)
            .forEach(t => {
                const name = t.ingredient.name
                const multiplier = t.ingredient.purchaseMultiplier || 1
                if (!depletionMap.has(name)) {
                    depletionMap.set(name, {
                        name, quantity: 0,
                        // Quantity is in base units, so the card needs what it
                        // takes to render them: 700 of a 700ml bottle is one
                        // bottle, and printing "700 bottle" is how a report
                        // gets ignored.
                        measureType: t.ingredient.measureType,
                        purchaseUnit: t.ingredient.purchaseUnit,
                        purchaseMultiplier: multiplier,
                        valueAtCost: 0, transactions: 0,
                    })
                }
                const entry = depletionMap.get(name)
                entry.quantity += t.quantity
                entry.valueAtCost += t.quantity * ((t.ingredient.cost || 0) / multiplier)
                entry.transactions += 1
            })
        const depletion = Array.from(depletionMap.values())
            .map(d => ({ ...d, valueAtCost: Math.round(d.valueAtCost) }))
            .sort((a, b) => b.valueAtCost - a.valueAtCost)
            .slice(0, 10)

        // Unopened bottles carried back to the shelf at cleanup (req #14).
        // Every one of these is stock returned on a member of staff's word
        // with nobody checking it arrived, which is exactly what a short count
        // the next morning is asking about.
        const returnedMap = new Map()
        inventoryTransactions
            .filter(t => t.type === 'RETURN_UNOPENED' && t.toStore)
            .forEach(t => {
                const name = t.ingredient.name
                if (!returnedMap.has(name)) {
                    returnedMap.set(name, { name, quantity: 0, unit: t.ingredient.unit, transactions: 0 })
                }
                const entry = returnedMap.get(name)
                entry.quantity += t.quantity
                entry.transactions += 1
            })
        const returnedUnopened = Array.from(returnedMap.values()).sort((a, b) => b.quantity - a.quantity).slice(0, 10)

        // b. Wastage cost (WITHDRAW or SHOP_ADJUST transactions labelled as waste/spill)
        const wastageTransactions = inventoryTransactions.filter(t =>
            // Withdrawals are usually considered usage or waste depending on context, but let's keep WITHDRAW as intentional waste if it had those notes before, 
            // OR if it's a SHOP_ADJUST with specific dropdown reasons.
            // Dropdown reasons: SPILLAGE, THEFT, COUNTING_ERROR, SYSTEM_ERROR, EXPIRED, OTHER
            (t.type === 'SHOP_ADJUST' && (t.reason === 'SPILLAGE' || t.reason === 'EXPIRED')) ||
            (t.type === 'WITHDRAW' && (t.reason === 'DAMAGED' || t.reason === 'LOST')) // Assuming DAMAGED and LOST from withdrawal are waste
        )
        const wastageCost = wastageTransactions.reduce((sum, t) => {
            return sum + (Math.abs(t.quantity) * (t.ingredient.cost || 0))
        }, 0)

        // c. Shrinkage cost (SHOP_ADJUST transactions labelled as shrink or adjust)
        const shrinkageTransactions = inventoryTransactions.filter(t =>
            t.type === 'SHOP_ADJUST' &&
            (t.reason === 'THEFT' || t.reason === 'COUNTING_ERROR' || t.reason === 'SYSTEM_ERROR' || t.reason === 'OTHER')
        )

        shrinkageCost = shrinkageTransactions.reduce((sum, t) => {
            // Negative quantity means loss
            if (t.quantity < 0) {
                return sum + (Math.abs(t.quantity) * (t.ingredient.cost || 0))
            }
            return sum
        }, 0)

        shrinkageDetails = shrinkageTransactions.map(sc => ({
            id: sc.id,
            ingredientName: sc.ingredient.name,
            difference: sc.quantity,
            lossValue: sc.quantity < 0 ? Math.abs(sc.quantity) * (sc.ingredient.cost || 0) : 0,
            date: sc.createdAt,
            reason: sc.reason || 'Adjustment',
            notes: sc.notes || ''
        })).sort((a, b) => b.lossValue - a.lossValue)

        const totalCOGS = salesCost + wastageCost

        // Transaction type breakdown.
        //
        // Counted on the movement types this bar actually writes. Three of the
        // five it used to count - TRANSFER, WITHDRAW and USAGE - have never
        // appeared in the database, so the row read "0 / 0 / 0" beside two live
        // figures, while the movements that do happen (a sale depleting the
        // shelf, a package swapped, an unopened bottle carried back) had no
        // count at all.
        const countOf = (type: string) => inventoryTransactions.filter(t => t.type === type).length
        const transactionTypes = {
            sold: countOf('SALE'),
            received: countOf('DEPOSIT'),
            returned: countOf('RETURN_UNOPENED'),
            exchanged: countOf('EXCHANGE'),
            adjusted: countOf('SHOP_ADJUST'),
            // Stock put back when a round was struck. Its own count rather than
            // netted off `sold`, because a bar that voids a lot and a bar that
            // sells a little are different problems.
            voidedBack: countOf('SALE_VOID'),
        }

        return NextResponse.json({
            dailyTrend,
            categoryShare,
            hourlySales,
            paymentMethods,
            topProducts: productPerformance.slice(0, 10),
            productPerformance,
            worstProducts,
            zeroSales: trashItems,
            serviceStats,
            areaStats,
            serverSales,
            complimentaryDetails,
            inventoryStats: {
                mostAdded,
                depletion,
                returnedUnopened,
                transactionTypes,
                recentTransactions: inventoryTransactions.slice(0, 20).map(t => ({
                    id: t.id,
                    type: t.type,
                    ingredientName: t.ingredient.name,
                    quantity: t.quantity,
                    unit: t.ingredient.unit,
                    fromStore: t.fromStore,
                    toStore: t.toStore,
                    user: t.user?.name || null,
                    // `reason` only holds a reason on the movements a human
                    // typed one for. On a sale or a swap the column carries the
                    // menu or session id that caused it, and a "Reason" column
                    // showing staff a raw UUID is worse than showing them
                    // nothing - it reads as a fault in the system.
                    reason: REASONED_TYPES.has(t.type) ? t.reason : null,
                    notes: t.notes,
                    createdAt: t.createdAt
                }))
            },
            summary: {
                // Rung up before anything was taken off.
                grossRevenue,
                // What the bar actually billed. Same definition as the
                // Z-report's `net`, so the two documents agree on the night.
                // Comps stay inside it and are reported on their own line
                // below, exactly as the Z-report treats them - a comped bill
                // is a sale the house paid for, not a sale that never happened.
                totalRevenue: netRevenue,
                netSales: netRevenue - (summaryStats._sum?.tax || 0),
                taxCollected: summaryStats._sum?.tax || 0,
                totalOrders,
                // Average round, net of the table discount.
                aov: totalOrders > 0 ? netRevenue / totalOrders : 0,
                totalDiscounts,
                periodCount: dailyTrend.length,
                complimentaryOrders: (complimentaryStats._count as any) || 0,
                complimentaryValue: complimentaryStats._sum?.total || 0,
                totalCOGS,
                salesCost,
                wastageCost,
                shrinkageCost,
                grossProfit: netRevenue - totalCOGS,
                // The number a bar is run on: what the liquor in the glass cost
                // against what the glass sold for. Everything needed for it was
                // already being computed and it was never stated, so the one
                // figure an owner opens a report for had to be worked out from
                // two other cards.
                //
                // Against sales excluding VAT, because the tax was never the
                // bar's money. Wastage is deliberately out of it - this is the
                // cost of what was poured and sold; what was spilled is its own
                // line above and mixing them hides which one is moving.
                pourCostPct: netRevenue - (summaryStats._sum?.tax || 0) > 0
                    ? Math.round((salesCost / (netRevenue - (summaryStats._sum?.tax || 0))) * 1000) / 10
                    : null,
            },
            advanced: {
                lowMarginItems,
                shrinkageDetails
            }
        })

    } catch (e) {
        console.error(e)
        return NextResponse.json({ error: 'Failed to fetch analytics' }, { status: 500 })
    }
}
