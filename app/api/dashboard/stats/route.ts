import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
    try {
        const now = new Date()

        // Use local dates for Today and Yesterday to match user's physical day
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
        const endOfYesterday = startOfToday

        // 2. Today's Stats
        const todayStats = await prisma.order.aggregate({
            _sum: { total: true },
            _count: { id: true },
            where: {
                createdAt: { gte: startOfToday },
                status: 'COMPLETED',
                isReportable: true
            }
        })

        // 3. Yesterday's Stats
        const yesterdayStats = await prisma.order.aggregate({
            _sum: { total: true },
            _count: { id: true },
            where: {
                createdAt: {
                    gte: startOfYesterday,
                    lt: endOfYesterday
                },
                status: 'COMPLETED',
                isReportable: true
            }
        })

        // 4. Low Stock items detailed
        const allIngredients = await prisma.ingredient.findMany()
        const lowStockItemsDetailed = allIngredients.filter(i => i.subStock <= i.minStock)
        const lowStockCountNum = lowStockItemsDetailed.length

        // 5. Active Orders
        const activeOrders = await prisma.order.findMany({
            where: {
                status: {
                    in: ['PENDING', 'PREPARING', 'READY', 'HOLD']
                }
            },
            orderBy: { createdAt: 'desc' },
            take: 5
        })

        // 6. Top Selling Items (Grouped by Menu)
        const topItemsRaw = await prisma.orderItem.findMany({
            where: {
                order: {
                    createdAt: { gte: startOfToday },
                    status: 'COMPLETED'
                }
            },
            include: {
                menu: true
            }
        })

        const itemMap = new Map()
        topItemsRaw.forEach(item => {
            const groupKey = item.menu?.name || item.name.split(' - ')[0]

            if (!itemMap.has(groupKey)) {
                itemMap.set(groupKey, { name: groupKey, sold: 0, revenue: 0 })
            }
            const entry = itemMap.get(groupKey)
            entry.sold += item.quantity
            entry.revenue += item.total
        })

        const formattedTopItems = Array.from(itemMap.values())
            .sort((a, b) => b.sold - a.sold)
            .slice(0, 5)

        // Calculate changes
        const todayRevenue = todayStats._sum.total || 0
        const yesterdayRevenue = yesterdayStats._sum.total || 0

        // Fixed growth logic: If yesterday was 0, we use (current * 100) as the change % to show high growth.
        const calculateChange = (current: number, previous: number) => {
            if (previous === 0) return current > 0 ? (current * 100) : 0
            return ((current - previous) / previous * 100)
        }

        const revChangeNum = calculateChange(todayRevenue, yesterdayRevenue)
        const todayCount = todayStats._count.id || 0
        const yesterdayCount = yesterdayStats._count.id || 0
        const countChangeNum = calculateChange(todayCount, yesterdayCount)

        const aovToday = todayCount > 0 ? (todayRevenue / todayCount) : 0
        const aovYesterday = yesterdayCount > 0 ? (yesterdayRevenue / yesterdayCount) : 0
        const aovChangeNum = calculateChange(aovToday, aovYesterday)

        return NextResponse.json({
            summary: [
                {
                    title: "Today's Sales",
                    value: todayRevenue,
                    change: `${revChangeNum > 0 ? '+' : ''}${revChangeNum.toFixed(1)}%`,
                    type: "currency"
                },
                {
                    title: "Orders",
                    value: todayCount,
                    change: `${countChangeNum > 0 ? '+' : ''}${countChangeNum.toFixed(1)}%`,
                    type: "number"
                },
                {
                    title: "Avg Order Value",
                    value: aovToday,
                    change: `${aovChangeNum > 0 ? '+' : ''}${aovChangeNum.toFixed(1)}%`,
                    type: "currency"
                },
                {
                    title: "Low Stock Items",
                    value: lowStockCountNum,
                    change: "Alert",
                    type: "number"
                }
            ],
            activeOrders,
            topItems: formattedTopItems,
            lowStockAlerts: lowStockItemsDetailed.slice(0, 10).map(i => ({
                name: i.name,
                current: i.subStock,
                unit: i.unit,
                min: i.minStock
            }))
        })
    } catch (error) {
        console.error("Dashboard API Error:", error)
        return NextResponse.json({ error: 'Failed to fetch dashboard stats' }, { status: 500 })
    }
}
