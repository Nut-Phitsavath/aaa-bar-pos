import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * What the shelf said against what the till thought.
 *
 * The count sheet has been collected and dropped on the floor: StockCount has
 * stored theoretical, actual and difference all along and nothing ever read it
 * back. Valued at cost, because "six bottles short" and "6,000 baht short" are
 * the same fact told to two different people, and only one of them acts on it.
 */
export async function GET(request: Request) {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    try {
        const { searchParams } = new URL(request.url)
        const today = new Date().toISOString().split('T')[0]
        const start = new Date(`${searchParams.get('startDate') || today}T00:00:00.000Z`)
        const end = new Date(`${searchParams.get('endDate') || today}T23:59:59.999Z`)

        const counts = await prisma.stockCount.findMany({
            where: { createdAt: { gte: start, lte: end } },
            include: {
                ingredient: {
                    select: {
                        name: true, measureType: true, purchaseUnit: true,
                        purchaseMultiplier: true, cost: true,
                    },
                },
                user: { select: { name: true } },
            },
            orderBy: { createdAt: 'desc' },
        })

        const rows = counts.map((c) => {
            const multiplier = c.ingredient.purchaseMultiplier || 1
            return {
                id: c.id,
                countedAt: c.createdAt,
                countedBy: c.user?.name ?? '—',
                ingredient: c.ingredient.name,
                measureType: c.ingredient.measureType,
                purchaseUnit: c.ingredient.purchaseUnit,
                purchaseMultiplier: multiplier,
                theoretical: c.theoreticalStock,
                actual: c.actualStock,
                difference: c.difference,
                // cost is per purchase unit; difference is in base units.
                valueAtCost: Math.round(c.difference * (c.ingredient.cost / multiplier) * 100) / 100,
                notes: c.notes,
            }
        })

        const sum = (f: (r: typeof rows[number]) => boolean) =>
            Math.round(rows.filter(f).reduce((n, r) => n + r.valueAtCost, 0) * 100) / 100

        return NextResponse.json({
            rows,
            // Kept apart rather than netted: a night that lost 5,000 and found
            // 5,000 is not a night that balanced, it is two problems.
            shrinkage: sum((r) => r.valueAtCost < 0),
            overage: sum((r) => r.valueAtCost > 0),
        })
    } catch (error) {
        console.error('[variance] GET failed', error)
        return NextResponse.json({ error: 'Failed to load variance' }, { status: 500 })
    }
}
