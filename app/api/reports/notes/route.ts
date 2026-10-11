import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * What the bar keeps being asked for, in the customer's own words.
 *
 * Staff type a note during service and nobody checks it at the time - the same
 * decision as the exchange screen, and for the same reason: a bartender with a
 * queue does not stop to justify "no ice". The morning is when a pattern
 * becomes visible.
 *
 * The report's real job is not the log. It is the ranking. A note typed twice
 * is a customer; a note typed two hundred times is a menu decision the system
 * is asking you to make - "no ice" as a one-tap choice rather than something
 * five people spell five ways. Rare notes stay notes.
 *
 * Deliberately says nothing about stock. A note is free text and cannot drive a
 * deduction: the bar runs in two languages, and "no ice" / "ບໍ່ໃສ່ນ້ຳກ້ອນ" /
 * "less ice" have no reliable parse between them. A wrong parse corrupts the
 * stock count silently, which is worse than not trying. If an exclusion should
 * move stock, it has to become a structured choice with a recipe behind it -
 * that is what a modifier is for, and this report is how you find out which
 * ones deserve to be one.
 */
export async function GET(request: Request) {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    try {
        const { searchParams } = new URL(request.url)
        const startDate = searchParams.get('startDate')
        const endDate = searchParams.get('endDate')

        // OrderItem carries no timestamp of its own; a line happened when its
        // round did.
        const where: any = {
            note: { not: null },
            order: { is: {} as any },
        }
        if (startDate || endDate) {
            where.order.is.createdAt = {}
            if (startDate) where.order.is.createdAt.gte = new Date(startDate)
            if (endDate) where.order.is.createdAt.lte = new Date(endDate)
        }

        const lines = await prisma.orderItem.findMany({
            where,
            orderBy: { order: { createdAt: 'desc' } },
            take: 500,
            select: {
                id: true,
                name: true,
                quantity: true,
                note: true,
                isTakeaway: true,
                voidedAt: true,
                order: {
                    select: {
                        id: true,
                        orderNumber: true,
                        createdAt: true,
                        user: { select: { name: true } },
                        session: { select: { id: true, table: { select: { name: true } } } },
                    },
                },
            },
        })

        // An empty note is not a note. The column is nullable and the till
        // trims before saving, but a row written before that did could hold "".
        const real = lines.filter((l) => (l.note ?? '').trim().length > 0)

        const recent = real.map((l) => ({
            id: l.id,
            at: l.order?.createdAt?.toISOString() ?? null,
            note: (l.note ?? '').trim(),
            item: l.name,
            quantity: l.quantity,
            isTakeaway: l.isTakeaway,
            // A struck line still tells you what was asked for, so it stays in
            // the log - flagged, not hidden, exactly as the void audit does.
            voided: Boolean(l.voidedAt),
            staff: l.order?.user?.name ?? null,
            table: l.order?.session?.table?.name ?? null,
            sessionId: l.order?.session?.id ?? null,
            orderNumber: l.order?.orderNumber ?? null,
        }))

        // Grouped case- and space-insensitively, because "No Ice", "no ice" and
        // "no  ice" are one request typed by three people. The label shown is
        // whichever spelling the bar used most, so the ranking reads in the
        // staff's own words rather than a normalised slug.
        const groups = new Map<string, {
            key: string
            label: string
            spellings: Map<string, number>
            count: number
            lastAt: string | null
            items: Map<string, number>
        }>()

        for (const r of recent) {
            const key = r.note.toLowerCase().replace(/\s+/g, ' ')
            const g = groups.get(key) ?? {
                key, label: r.note, spellings: new Map(), count: 0, lastAt: null, items: new Map(),
            }
            g.count += 1
            g.spellings.set(r.note, (g.spellings.get(r.note) ?? 0) + 1)
            g.items.set(r.item, (g.items.get(r.item) ?? 0) + 1)
            // `recent` is newest first, so the first sighting is the latest.
            g.lastAt ??= r.at
            groups.set(key, g)
        }

        const ranked = Array.from(groups.values())
            .map((g) => ({
                note: Array.from(g.spellings.entries()).sort((a, b) => b[1] - a[1])[0][0],
                count: g.count,
                lastAt: g.lastAt,
                items: Array.from(g.items.entries())
                    .map(([name, count]) => ({ name, count }))
                    .sort((a, b) => b.count - a.count),
            }))
            .sort((a, b) => b.count - a.count || a.note.localeCompare(b.note))

        return NextResponse.json({
            ranked,
            recent,
            summary: {
                total: recent.length,
                distinct: ranked.length,
                // Said plainly so a manager reading a short list knows whether
                // they are looking at everything or at the most recent 500.
                capped: lines.length >= 500,
            },
        })
    } catch (error) {
        console.error('[notes report] GET failed', error)
        return NextResponse.json({ error: 'Failed to build report' }, { status: 500 })
    }
}
