import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * Every package exchange, for the manager who was not there (req #9).
 *
 * This report is the only control on the exchange screen. Swapping needs no
 * PIN, by decision - it happens ten times a night and a PIN would be worked
 * around within a week - so nobody is stopped at the time, and the morning is
 * when a pattern becomes visible.
 *
 * What it is watching is NOT lost revenue: the package price is a floor, so a
 * customer who trades down leaves the bar holding both the money and the
 * drinks. It is watching stock that went back on the shelf on one person's
 * word. Every swap returns bottles to inventory with nobody checking they
 * arrived, so when a count comes up short these rows say where to look.
 *
 * Zero-charge swaps are included deliberately - they are most of them, and
 * they move exactly as much stock as the ones that cost the customer money.
 */
export async function GET(request: Request) {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    try {
        const { searchParams } = new URL(request.url)
        const startDate = searchParams.get('startDate')
        const endDate = searchParams.get('endDate')

        const where: any = {}
        if (startDate || endDate) {
            where.createdAt = {}
            if (startDate) where.createdAt.gte = new Date(startDate)
            if (endDate) where.createdAt.lte = new Date(endDate)
        }

        const swaps = await prisma.packageSwap.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: 500,
            include: {
                lines: true,
                user: { select: { name: true } },
                reversedBy: { select: { name: true } },
                session: { include: { table: { select: { name: true } } } },
                orderItem: { select: { name: true } },
            },
        })

        const rows = swaps.map((s) => ({
            id: s.id,
            at: s.createdAt.toISOString(),
            staff: s.user?.name ?? null,
            table: s.session?.table?.name ?? null,
            packageName: s.orderItem?.name ?? null,
            outValue: s.outValue,
            inValue: s.inValue,
            charged: s.charged,
            /**
             * The value this swap put back on the shelf.
             *
             * NOT a loss - the bar keeps the package price either way, and
             * drinks that were never served are stock it still owns. What this
             * number is, is exposure: stock that returned to inventory because
             * one staff member said so, with no manager and no customer
             * checking. If the count comes up short at the end of the night,
             * these are the rows to read, largest first.
             */
            returnedValue: s.outValue,
            reversedAt: s.reversedAt?.toISOString() ?? null,
            reversedBy: s.reversedBy?.name ?? null,
            out: s.lines.filter((l) => l.direction === 'OUT').map((l) => ({ name: l.name, quantity: l.quantity })),
            in: s.lines.filter((l) => l.direction === 'IN').map((l) => ({ name: l.name, quantity: l.quantity })),
        }))

        const live = rows.filter((r) => !r.reversedAt)

        return NextResponse.json({
            swaps: rows,
            totals: {
                count: live.length,
                reversed: rows.length - live.length,
                charged: live.reduce((n, r) => n + r.charged, 0),
                returnedValue: live.reduce((n, r) => n + r.returnedValue, 0),
            },
            // Who is doing this, which is the question the report exists for.
            byStaff: Object.values(
                live.reduce((acc: Record<string, any>, r) => {
                    const key = r.staff ?? '—'
                    acc[key] ??= { staff: key, count: 0, returnedValue: 0, charged: 0 }
                    acc[key].count += 1
                    acc[key].returnedValue += r.returnedValue
                    acc[key].charged += r.charged
                    return acc
                }, {}),
            ).sort((a: any, b: any) => b.returnedValue - a.returnedValue),
        })
    } catch (error) {
        console.error('[exchanges report] GET failed', error)
        return NextResponse.json({ error: 'Failed to build report' }, { status: 500 })
    }
}
