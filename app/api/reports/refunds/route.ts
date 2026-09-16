import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { startOfDay, endOfDay } from 'date-fns'

export const dynamic = 'force-dynamic'

/**
 * Money handed back.
 *
 * This read cancelled ORDERS and called them refunds. They are not the same
 * event and the bar does both: a cancelled order is a round that was never
 * served, struck before anyone paid for it; a refund is a tender that was
 * taken and then given back across the counter. The card was showing the first
 * under a heading promising the second, so the one thing a manager opens a
 * refund report to see - cash leaving the drawer after a sale - appeared
 * nowhere on this page. The Z-report has been reading the right source all
 * along, which is how the two disagreed.
 *
 * Read from `Payment.voidedAt`, the same source. A refund is recorded on the
 * tender rather than as a negative payment, so the original stays legible on
 * the bill and a reversal can never be mistaken for a second sale.
 *
 * Dated by when the refund happened, not when the tender was taken: a bill
 * settled last night and refunded this afternoon leaves the drawer today, and
 * today is the day that has to account for it. Same rule as the Z-report.
 *
 * Two names per row, deliberately, as in the void audit: `takenBy` rang the
 * money in, `refundedBy` signed it back out. A report that collapsed them
 * would hide the pattern worth looking for.
 */
export async function GET(request: Request) {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    try {
        const { searchParams } = new URL(request.url)
        const startDate = searchParams.get('startDate')
        const endDate = searchParams.get('endDate')

        const where: any = { voidedAt: { not: null } }
        if (startDate || endDate) {
            if (startDate) where.voidedAt.gte = startOfDay(new Date(startDate))
            if (endDate) where.voidedAt.lte = endOfDay(new Date(endDate))
        }

        const payments = await prisma.payment.findMany({
            where,
            orderBy: { voidedAt: 'desc' },
            select: {
                id: true,
                method: true,
                amount: true,
                createdAt: true,
                voidedAt: true,
                voidReason: true,
                bankReference: true,
                user: { select: { name: true } },
                voidedBy: { select: { name: true } },
                session: {
                    select: {
                        table: { select: { name: true } },
                        customer: { select: { name: true } },
                    },
                },
            },
        })

        const rows = payments.map((p) => ({
            id: p.id,
            refundedAt: p.voidedAt,
            takenAt: p.createdAt,
            table: p.session?.table?.name ?? null,
            customer: p.session?.customer?.name ?? null,
            method: p.method,
            amount: p.amount,
            takenBy: p.user?.name ?? null,
            refundedBy: p.voidedBy?.name ?? null,
            // The reason is mandatory at the dialog, so an empty one means a
            // row written before that was enforced rather than a staff member
            // skipping it.
            reason: p.voidReason,
            bankReference: p.bankReference,
        }))

        const byMethod = Object.values(
            rows.reduce((acc: Record<string, { method: string; count: number; value: number }>, r) => {
                acc[r.method] ??= { method: r.method, count: 0, value: 0 }
                acc[r.method].count += 1
                acc[r.method].value += r.amount || 0
                return acc
            }, {})
        ).sort((a, b) => b.value - a.value)

        // The same name signing every refund back is what this report is for.
        const byStaff = Object.values(
            rows.reduce((acc: Record<string, { name: string; count: number; value: number }>, r) => {
                const name = r.refundedBy ?? 'Unknown'
                acc[name] ??= { name, count: 0, value: 0 }
                acc[name].count += 1
                acc[name].value += r.amount || 0
                return acc
            }, {})
        ).sort((a, b) => b.value - a.value)

        return NextResponse.json({
            rows,
            byMethod,
            byStaff,
            totalCount: rows.length,
            totalValue: rows.reduce((sum, r) => sum + (r.amount || 0), 0),
        })
    } catch (error) {
        console.error('[reports refunds] GET failed', error)
        return NextResponse.json({ error: 'Failed to load refunds' }, { status: 500 })
    }
}
