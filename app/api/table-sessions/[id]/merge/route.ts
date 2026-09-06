import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { isConfirmed } from '@/lib/payments'
import { canMerge } from '@/lib/table-ops'

export const dynamic = 'force-dynamic'

/**
 * Two tables become one party (req #2).
 *
 * `[id]` is the bill that survives - the one the staff member is standing at -
 * and `fromSessionId` is the one poured into it. The survivor keeps its
 * reference, its opening time and its customer; the emptied bill closes as
 * MERGED pointing at where its rounds went, so history has no hole in it.
 *
 * Refused once either side has taken money. A tender belongs to the bill it was
 * taken against, and moving rounds out from under it would leave a payment
 * explaining a total that no longer exists.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const user = await getSessionUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const { fromSessionId } = await request.json()
        if (typeof fromSessionId !== 'string') {
            return NextResponse.json({ error: 'SESSION_REQUIRED' }, { status: 400 })
        }

        const openShift = await prisma.shift.findFirst({ where: { status: 'OPEN' } })

        const [into, from] = await Promise.all([
            prisma.tableSession.findUnique({
                where: { id },
                include: { table: { select: { name: true } }, payments: true },
            }),
            prisma.tableSession.findUnique({
                where: { id: fromSessionId },
                include: { table: { select: { name: true } }, payments: true, orders: { select: { id: true } } },
            }),
        ])
        if (!into || !from) return NextResponse.json({ error: 'Not found' }, { status: 404 })

        const check = canMerge(
            { id: from.id, status: from.status, paidCount: from.payments.filter(isConfirmed).length },
            { id: into.id, status: into.status, paidCount: into.payments.filter(isConfirmed).length },
            openShift?.id ?? null,
        )
        if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 409 })

        await prisma.$transaction(async (tx) => {
            // The rounds move wholesale. Their tableOrderNumber is renumbered so
            // the merged ticket reads 1, 2, 3 rather than 1, 2, 1, 2 - which is
            // what a bar argues about at the end of the night.
            const existing = await tx.order.count({ where: { sessionId: id } })
            const moving = await tx.order.findMany({
                where: { sessionId: fromSessionId },
                orderBy: { createdAt: 'asc' },
                select: { id: true },
            })
            for (const [i, order] of moving.entries()) {
                await tx.order.update({
                    where: { id: order.id },
                    data: { sessionId: id, tableOrderNumber: existing + i + 1 },
                })
            }

            // Package swaps are logged against a session too, so they follow
            // their rounds or the exchange report would point at an empty bill.
            await tx.packageSwap.updateMany({
                where: { sessionId: fromSessionId },
                data: { sessionId: id },
            })

            await tx.tableSession.update({
                where: { id: fromSessionId },
                data: { status: 'CLOSED', closedAt: new Date(), mergedIntoId: id },
            })

            await tx.tableSessionEvent.create({
                data: {
                    sessionId: id,
                    kind: 'MERGE',
                    userId: user.id,
                    fromTable: from.table.name,
                    toTable: into.table.name,
                    otherSessionId: fromSessionId,
                    lineCount: moving.length,
                },
            })
        })

        return NextResponse.json({ merged: true, rounds: from.orders.length, from: from.table.name })
    } catch (error) {
        console.error('[table merge] POST failed', error)
        return NextResponse.json({ error: 'Failed to merge tables' }, { status: 500 })
    }
}
