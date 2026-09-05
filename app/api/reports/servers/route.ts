import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * Who served the most (requirement #23).
 *
 * Keyed on the WAITER, not the till operator. The existing staff chart groups
 * by `order.user`, which is whoever keyed the order at the POS - in this bar
 * that is the same one or two people every night, so it answers a question
 * nobody asked. `order.waiterId` is the server who actually carried the order,
 * and that is what a bonus is paid on.
 *
 * Revenue counts COMPLETED orders only, so a round sitting on an open table is
 * not credited until the bill is settled - a server cannot inflate their
 * numbers by leaving tables open. Voids are counted separately rather than
 * netted off, because "sold a lot" and "voided a lot" are two different facts
 * about a person and a manager needs both.
 */
export async function GET(request: Request) {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    try {
        const { searchParams } = new URL(request.url)
        const startDate = searchParams.get('startDate')
        const endDate = searchParams.get('endDate')

        const where: any = { waiterId: { not: null } }
        if (startDate || endDate) {
            where.createdAt = {}
            if (startDate) where.createdAt.gte = new Date(startDate)
            if (endDate) where.createdAt.lte = new Date(endDate)
        }

        const orders = await prisma.order.findMany({
            where,
            select: {
                total: true, status: true, discount: true, sessionId: true,
                waiter: { select: { id: true, name: true } },
                // voidedAt/total per line, because voids are counted from the
                // lines now: a round can lose one drink and survive, and a
                // fully struck round has had its own total recomputed to zero,
                // so reading order.total would report every void as worth 0.
                items: { select: { quantity: true, voidedAt: true, total: true } }
            }
        })

        type Row = {
            id: string; name: string
            revenue: number; orders: number; items: number
            tables: Set<string>; voids: number; voidValue: number; discounts: number
        }
        const byServer = new Map<string, Row>()

        for (const o of orders) {
            if (!o.waiter) continue
            const row = byServer.get(o.waiter.id) ?? {
                id: o.waiter.id, name: o.waiter.name,
                revenue: 0, orders: 0, items: 0,
                tables: new Set<string>(), voids: 0, voidValue: 0, discounts: 0,
            }

            // Voids are per line and independent of the order's own status, so
            // one drink coming back off an otherwise good round still counts
            // against the server who carried it (req #23).
            const struck = o.items.filter((i) => i.voidedAt)
            row.voids += struck.length
            row.voidValue += struck.reduce((n, i) => n + (i.total || 0), 0)

            if (o.status === 'COMPLETED') {
                row.revenue += o.total
                row.orders += 1
                // Only lines that survived were actually served and paid for.
                row.items += o.items.filter((i) => !i.voidedAt).reduce((n, i) => n + i.quantity, 0)
                row.discounts += o.discount ?? 0
                if (o.sessionId) row.tables.add(o.sessionId)
            }

            byServer.set(o.waiter.id, row)
        }

        const servers = Array.from(byServer.values())
            .map((r) => ({
                id: r.id,
                name: r.name,
                revenue: r.revenue,
                orders: r.orders,
                items: r.items,
                tables: r.tables.size,
                voids: r.voids,
                voidValue: r.voidValue,
                discounts: r.discounts,
                // What a bonus conversation actually turns on: not just the
                // total, but how big a round they tend to sell.
                avgOrder: r.orders > 0 ? Math.round(r.revenue / r.orders) : 0,
            }))
            .sort((a, b) => b.revenue - a.revenue)

        const totalRevenue = servers.reduce((sum, s) => sum + s.revenue, 0)

        return NextResponse.json({
            servers: servers.map((s) => ({
                ...s,
                // Share of the room's takings, so one server's number means
                // something on a quiet night as well as a busy one.
                share: totalRevenue > 0 ? Math.round((s.revenue / totalRevenue) * 1000) / 10 : 0,
            })),
            totalRevenue,
        })
    } catch (error) {
        console.error('[servers report] GET failed', error)
        return NextResponse.json({ error: 'Failed to build report' }, { status: 500 })
    }
}
