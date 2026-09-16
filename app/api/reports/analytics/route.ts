import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { barHour, tradingDay, tradingHours } from '@/lib/trading-day'
import { recipeCost, pourCost, verdictFor, bandFor } from '@/lib/pour-cost'
import { startOfDay, endOfDay } from 'date-fns'

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
                status: 'COMPLETED',
                isReportable: true
            },
            select: {
                total: true,
                createdAt: true,
                discount: true,
                sessionId: true,
                user: { select: { name: true } }
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

        // Staff Sales Performance
        const staffMap = new Map()
        orders.forEach(o => {
            const staffName = o.user?.name || "Unknown Staff"
            if (!staffMap.has(staffName)) staffMap.set(staffName, { name: staffName, revenue: 0, orders: 0 })
            const entry = staffMap.get(staffName)
            entry.revenue += o.total
            entry.orders += 1
        })
        const staffSales = Array.from(staffMap.values()).sort((a, b) => b.revenue - a.revenue)

        // Table service vs the walk-in counter. For a bar this is the split
        // that matters; takeaway vs dine-in is a cafe question - a bar is dine
        // in by definition, so that chart always read 100/0.
        const tableOrders = orders.filter((o) => o.sessionId)
        const walkInOrders = orders.filter((o) => !o.sessionId)
        const serviceStats = [
            { name: 'Tables', revenue: tableOrders.reduce((s, o) => s + o.total, 0), count: tableOrders.length },
            { name: 'Walk-in', revenue: walkInOrders.reduce((s, o) => s + o.total, 0), count: walkInOrders.length },
        ]

        // 2. Category Share
        const orderItems = await prisma.orderItem.findMany({
            where: {
                order: {
                    createdAt: { gte: startDate, lte: endDate },
                    status: 'COMPLETED',
                    isReportable: true
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
                status: 'COMPLETED',
                isReportable: true,
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

        // 7. Takeaway vs Dine-in
        const takeawayMap = new Map()
        takeawayMap.set("Take Away", { name: "Take Away", sold: 0, revenue: 0 })
        takeawayMap.set("Dine In", { name: "Dine In", sold: 0, revenue: 0 })

        orderItems.forEach(item => {
            const key = (item as any).isTakeaway ? "Take Away" : "Dine In"
            const entry = takeawayMap.get(key)
            entry.sold += item.quantity
            entry.revenue += item.total
        })
        const takeawayStats = Array.from(takeawayMap.values())

        // 8. Sugar & Shot Stats
        const sugarMap = new Map()
        const shotMap = new Map()

        orderItems.forEach(item => {
            if (item.sugarLevel) {
                const key = item.sugarLevel.trim().toUpperCase()
                if (!sugarMap.has(key)) sugarMap.set(key, { name: item.sugarLevel, count: 0 })
                sugarMap.get(key).count += item.quantity
            }
            if (item.shotType) {
                const key = item.shotType.trim().toUpperCase()
                if (!shotMap.has(key)) shotMap.set(key, { name: item.shotType, count: 0 })
                shotMap.get(key).count += item.quantity
            }
        })
        const sugarStats = Array.from(sugarMap.values()).sort((a, b) => b.count - a.count)
        const shotStats = Array.from(shotMap.values()).sort((a, b) => b.count - a.count)

        // --- NEW: Advanced Analytics (Margin, COGS, Shrinkage) ---

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
            }
        })
        // wastageCost will be calculated after inventoryTransactions is fetched below

        // 3. Inventory Shrinkage
        // Based on SHOP_ADJUST transactions (calculated after inventoryTransactions is fetched)
        let shrinkageCost = 0
        let shrinkageDetails: any[] = []

        // 6. Promo Impact
        const promoOrders = await prisma.order.findMany({
            where: {
                createdAt: { gte: startDate, lte: endDate },
                status: 'COMPLETED',
                isReportable: true,
                promoId: { not: null }
            },
            include: { promotion: true }
        })
        const promoMap = new Map()
        promoOrders.forEach(o => {
            const name = o.promotion?.name || "Unknown"
            if (!promoMap.has(name)) promoMap.set(name, { name, usageCount: 0, totalDiscount: 0, totalRevenue: 0 })
            const entry = promoMap.get(name)
            entry.usageCount += 1
            entry.totalDiscount += o.discount
            entry.totalRevenue += o.total
        })
        const promoImpact = Array.from(promoMap.values())

        // 7. Summary
        const totalRevenue = orders.reduce((sum, o) => sum + o.total, 0)
        const totalOrders = orders.length
        const aov = totalOrders > 0 ? totalRevenue / totalOrders : 0
        // Uses the same order set as every other figure above rather than its
        // own query. The old form was `sum + o.discount || 0`, which parses as
        // `(sum + o.discount) || 0` - it happened to work only because the
        // running total was never zero after the first discounted order.
        const totalDiscounts = orders.reduce((sum, o) => sum + (o.discount || 0), 0)

        // Summary Stats (robustified)
        const summaryStats = await prisma.order.aggregate({
            where: {
                createdAt: { gte: startDate, lte: endDate },
                status: 'COMPLETED',
                isReportable: true
            },
            _sum: { total: true, discount: true, tax: true },
            _count: true,
            _avg: { total: true }
        })

        // Final verification check for the user in logs
        if ((summaryStats._count as any) === 0) {
            const lastOrder = await prisma.order.findFirst({ orderBy: { createdAt: 'desc' } })
            console.log("Analytics Diagnostic: No orders in range. Last order in DB:", lastOrder?.createdAt)
        }

        // Complimentary Orders Stats
        const complimentaryStats = await prisma.order.aggregate({
            where: {
                createdAt: { gte: startDate, lte: endDate },
                status: 'COMPLETED',
                isReportable: false
            },
            _sum: { total: true },
            _count: true
        })

        // Complimentary Orders by Customer
        const complimentaryOrders = await prisma.order.findMany({
            where: {
                createdAt: { gte: startDate, lte: endDate },
                status: 'COMPLETED',
                isReportable: false,
                customerId: { not: null }
            },
            include: { customer: true }
        })

        const complimentaryMap = new Map()
        complimentaryOrders.forEach(o => {
            const name = o.customer?.name || "Unknown"
            if (!complimentaryMap.has(name)) {
                complimentaryMap.set(name, { customerName: name, orderCount: 0, totalValue: 0 })
            }
            const entry = complimentaryMap.get(name)
            entry.orderCount += 1
            entry.totalValue += o.total
        })
        const complimentaryDetails = Array.from(complimentaryMap.values()).sort((a, b) => b.totalValue - a.totalValue)

        // Customer Statistics
        const memberOrders = await prisma.order.findMany({
            where: {
                createdAt: { gte: startDate, lte: endDate },
                status: 'COMPLETED',
                isReportable: true,
                customerId: { not: null }
            },
            select: { total: true, pointsRedeemed: true }
        })

        const guestOrders = await prisma.order.findMany({
            where: {
                createdAt: { gte: startDate, lte: endDate },
                status: 'COMPLETED',
                isReportable: true,
                customerId: null
            },
            select: { total: true }
        })

        const memberVsGuest = [
            {
                type: "Member",
                count: memberOrders.length,
                revenue: memberOrders.reduce((sum, o) => sum + o.total, 0)
            },
            {
                type: "Guest",
                count: guestOrders.length,
                revenue: guestOrders.reduce((sum, o) => sum + o.total, 0)
            }
        ]

        // Top Loyalty Customers
        const topLoyalty = await prisma.customer.findMany({
            orderBy: { loyaltyPoints: 'desc' },
            take: 10,
            select: {
                name: true,
                loyaltyPoints: true,
                totalSpent: true,
                visitCount: true
            }
        })

        // Loyalty Points Stats
        const allCustomers = await prisma.customer.findMany({
            select: { loyaltyPoints: true }
        })
        const totalPointsEarned = allCustomers.reduce((sum, c) => sum + c.loyaltyPoints, 0)
        const totalPointsRedeemed = memberOrders.reduce((sum, o) => sum + (o.pointsRedeemed || 0), 0)
        const activeMembers = allCustomers.filter(c => c.loyaltyPoints > 0).length

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

        // Most Transferred to Shop
        const transferMap = new Map()
        inventoryTransactions
            .filter(t => t.type === 'TRANSFER')
            .forEach(t => {
                const name = t.ingredient.name
                if (!transferMap.has(name)) {
                    transferMap.set(name, { name, quantity: 0, unit: t.ingredient.unit, transactions: 0 })
                }
                const entry = transferMap.get(name)
                entry.quantity += t.quantity
                entry.transactions += 1
            })
        const mostTransferred = Array.from(transferMap.values()).sort((a, b) => b.quantity - a.quantity).slice(0, 10)

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

        // Transaction type breakdown
        const transactionTypes = {
            transfers: inventoryTransactions.filter(t => t.type === 'TRANSFER').length,
            deposits: inventoryTransactions.filter(t => t.type === 'DEPOSIT').length,
            withdrawals: inventoryTransactions.filter(t => t.type === 'WITHDRAW').length,
            shopAdjustments: inventoryTransactions.filter(t => t.type === 'SHOP_ADJUST').length,
            usage: inventoryTransactions.filter(t => t.type === 'USAGE').length
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
            takeawayStats,
            serviceStats,
            sugarStats,
            shotStats,
            promoImpact,
            staffSales,
            complimentaryDetails,
            customerStats: {
                memberVsGuest,
                topLoyalty,
                totalPointsEarned,
                totalPointsRedeemed,
                activeMembers
            },
            inventoryStats: {
                mostAdded,
                mostTransferred,
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
                    reason: t.reason,
                    notes: t.notes,
                    createdAt: t.createdAt
                }))
            },
            summary: {
                totalRevenue: summaryStats._sum?.total || 0,
                netSales: (summaryStats._sum?.total || 0) - (summaryStats._sum?.tax || 0),
                taxCollected: summaryStats._sum?.tax || 0,
                totalOrders: (summaryStats._count as any) || 0,
                aov: summaryStats._avg?.total || 0,
                totalDiscounts: summaryStats._sum?.discount || 0,
                periodCount: dailyTrend.length,
                complimentaryOrders: (complimentaryStats._count as any) || 0,
                complimentaryValue: complimentaryStats._sum?.total || 0,
                totalCOGS,
                salesCost,
                wastageCost,
                shrinkageCost,
                grossProfit: (summaryStats._sum?.total || 0) - totalCOGS
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
