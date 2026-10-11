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
        const startDate = searchParams.get('startDate')
        const endDate = searchParams.get('endDate')

        // The reports page sends a full ISO timestamp, already snapped to the
        // start and end of the day in the bar's own timezone. This route used
        // to staple a SECOND time onto the end of it - "...000ZT00:00:00.000Z"
        // - which is not a date, so every request from the tab it serves threw
        // on an Invalid Date and returned a 500. The empty state on screen is
        // what a failed fetch looks like here, which is why it read as "no
        // counts yet" rather than as a fault.
        //
        // Honour what the caller sent, the way every other report route does.
        // Only the no-parameter case still has to invent a window, and today in
        // UTC is as good a guess as any for a hand-typed URL.
        const today = new Date().toISOString().split('T')[0]
        const start = startDate ? new Date(startDate) : new Date(`${today}T00:00:00.000Z`)
        const end = endDate ? new Date(endDate) : new Date(`${today}T23:59:59.999Z`)

        // A bad date reaches Prisma as an Invalid Date and surfaces as a 500
        // with nothing on screen to say so. Saying it plainly costs two lines.
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return NextResponse.json({ error: 'Invalid date range' }, { status: 400 })
        }

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
