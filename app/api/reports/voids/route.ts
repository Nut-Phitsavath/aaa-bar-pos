import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { startOfDay, endOfDay } from 'date-fns'
import { VOID_REASONS } from '@/lib/voids'

export const dynamic = 'force-dynamic'

/**
 * The void audit report (req #24): every struck line, with staff name, table,
 * time and reason.
 *
 * Reads the line-level stamps rather than cancelled orders, because the
 * requirement asks for voided ITEMS - and a manager chasing a pattern needs to
 * see that it was five Chivas sets, not five "orders". A whole-round void
 * appears here as its own lines, since that is what it struck.
 *
 * Two names per row, deliberately. `waiter` took the round; `voidedBy` struck
 * it. They are usually different people, and a report that collapsed them
 * would hide the one thing worth looking for: the same name doing the striking
 * over and over.
 */
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url)
        const startDate = searchParams.get('startDate')
        const endDate = searchParams.get('endDate')

        const where: any = { voidedAt: { not: null } }
        if (startDate || endDate) {
            if (startDate) where.voidedAt.gte = startOfDay(new Date(startDate))
            if (endDate) where.voidedAt.lte = endOfDay(new Date(endDate))
        }

        const items = await prisma.orderItem.findMany({
            where,
            orderBy: { voidedAt: 'desc' },
            include: {
                voidedBy: { select: { name: true } },
                order: {
                    select: {
                        orderNumber: true,
                        tableOrderNumber: true,
                        status: true,
                        waiter: { select: { name: true } },
                        session: { select: { table: { select: { name: true } } } },
                    },
                },
            },
        })

        const rows = items.map((i) => ({
            id: i.id,
            voidedAt: i.voidedAt,
            // A walk-in sale has no table; saying so beats an empty cell.
            table: i.order.session?.table?.name ?? null,
            round: i.order.tableOrderNumber ?? null,
            orderNumber: i.order.orderNumber,
            item: i.name,
            quantity: i.quantity,
            value: i.total,
            waiter: i.order.waiter?.name ?? null,
            voidedBy: i.voidedBy?.name ?? null,
            reason: i.voidReason,
            note: i.voidNote,
            // Whether the whole round went, or just this line out of it.
            wholeRound: i.order.status === 'CANCELLED',
        }))

        // The breakdown is the point of forcing a reason from a fixed list: it
        // answers "what keeps going wrong here", which free text never could.
        const byReason = VOID_REASONS.map((reason) => {
            const matching = rows.filter((r) => r.reason === reason)
            return {
                reason,
                count: matching.length,
                value: matching.reduce((sum, r) => sum + (r.value || 0), 0),
            }
        }).filter((r) => r.count > 0)

        const byStaff = Object.values(
            rows.reduce((acc: Record<string, { name: string; count: number; value: number }>, r) => {
                const name = r.voidedBy ?? 'Unknown'
                acc[name] ??= { name, count: 0, value: 0 }
                acc[name].count += 1
                acc[name].value += r.value || 0
                return acc
            }, {})
        ).sort((a, b) => b.value - a.value)

        return NextResponse.json({
            rows,
            byReason,
            byStaff,
            totalCount: rows.length,
            totalValue: rows.reduce((sum, r) => sum + (r.value || 0), 0),
        })
    } catch (error) {
        console.error('[reports voids] GET failed', error)
        return NextResponse.json({ error: 'Failed to load void report' }, { status: 500 })
    }
}
