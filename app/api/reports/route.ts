import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: Request) {
    try {
        const now = new Date()
        const todayStr = now.toISOString().split('T')[0]
        const todayStart = new Date(todayStr)
        const sevenDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7)

        // Total Sales Today
        const todaySales = await prisma.order.aggregate({
            _sum: { total: true },
            _count: { id: true },
            where: {
                createdAt: { gte: todayStart },
                status: 'COMPLETED'
            }
        })

        // Sales by Day (Chart) - Last 7 days
        // Prisma doesn't support grouping by date part easily in all flavors without raw.
        // But for small datasets (last 7 days), we can fetch and group in JS.
        const last7DaysOrders = await prisma.order.findMany({
            where: {
                createdAt: { gte: sevenDaysAgo },
                status: 'COMPLETED'
            },
            select: {
                createdAt: true,
                total: true
            }
        })

        const salesByDayMap: Record<string, number> = {}
        last7DaysOrders.forEach(order => {
            const date = order.createdAt.toISOString().split('T')[0]
            salesByDayMap[date] = (salesByDayMap[date] || 0) + order.total
        })

        const dailySales = Object.keys(salesByDayMap).sort().map(date => ({
            date,
            total: salesByDayMap[date]
        }))

        // All Products performance with Variant Aggregation
        // 1. Group by productId and name
        const rawStats = await prisma.orderItem.groupBy({
            by: ['productId', 'name'],
            _sum: { quantity: true, total: true },
        })

        // 2. Fetch parent details for products
        const productIds = rawStats
            .map(s => s.productId)
            .filter(id => id !== null) as string[]

        const products = await prisma.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, parentId: true, name: true, parent: { select: { name: true } } }
        })

        const productMap = new Map(products.map(p => [p.id, p]))

        // 3. Aggregate in memory
        const aggregatedStats = new Map<string, { name: string, quantity: number, revenue: number }>()

        for (const stat of rawStats) {
            let name = stat.name
            let key = stat.name // Default grouping key

            if (stat.productId) {
                const prod = productMap.get(stat.productId)
                if (prod && prod.parentId && prod.parent) {
                    // It's a variant, use Parent Name
                    name = prod.parent.name
                    // We group by Parent Name to merge all variants of "Cocoa"
                    key = prod.parent.name
                } else if (prod) {
                    // Regular product, check if it IS a parent?
                    // If it is a parent, its stats are here.
                    // If we have variants, they will be mapped to this name too.
                    name = prod.name
                    key = prod.name
                }
            }

            const entry = aggregatedStats.get(key) || { name: key, quantity: 0, revenue: 0 }
            entry.quantity += (stat._sum.quantity || 0)
            entry.revenue += (stat._sum.total || 0)
            aggregatedStats.set(key, entry)
        }

        const productStats = Array.from(aggregatedStats.values())
        productStats.sort((a, b) => b.revenue - a.revenue)

        const totalProducts = productStats.length
        const bestSellers = productStats.slice(0, 10)

        // Low Demand: bottom 10 by quantity
        const lowDemand = [...productStats].sort((a, b) => a.quantity - b.quantity).slice(0, 10)

        return NextResponse.json({
            today: {
                total: todaySales._sum.total || 0,
                orders: todaySales._count.id || 0
            },
            dailySales,
            bestSellers,
            lowDemand
        })

    } catch (error) {
        console.error(error)
        return NextResponse.json({ error: 'Failed to fetch reports' }, { status: 500 })
    }
}
