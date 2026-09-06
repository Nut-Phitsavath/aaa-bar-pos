import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { requireOpenShift } from '@/lib/shift-guard'
import { decrementStock } from '@/lib/stock'
import { recomputeOrderTotal, reverseSwap } from '@/lib/swap-charge'

export const dynamic = 'force-dynamic'

/**
 * Undo an exchange.
 *
 * Needed because a swap cannot be un-swapped: what it added never becomes part
 * of the package, so a second exchange can never take it back out. Without this
 * the wrong drink tapped at 1am is permanent, and the only fix is a manager
 * editing stock by hand - which is how a count stops meaning anything.
 *
 * Reversed, never deleted. A swap that happened and was undone is two facts an
 * audit wants; deleting the row would leave the stock movement behind with
 * nothing explaining it. The bill's charge line is struck the same way a void
 * strikes a line, so a round's total is always the sum of what survived.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const user = await getSessionUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const openShift = await prisma.shift.findFirst({ where: { status: 'OPEN' } })
        const shiftCheck = requireOpenShift(openShift)
        if (!shiftCheck.ok) {
            return NextResponse.json({ error: shiftCheck.reason }, { status: 409 })
        }

        const swap = await prisma.packageSwap.findUnique({
            where: { id },
            include: {
                lines: true,
                orderItem: { include: { order: { select: { id: true, status: true, sessionId: true } } } },
            },
        })
        if (!swap) return NextResponse.json({ error: 'Not found' }, { status: 404 })
        if (swap.reversedAt) return NextResponse.json({ error: 'ALREADY_REVERSED' }, { status: 409 })

        if (swap.orderItem.order.sessionId) {
            const session = await prisma.tableSession.findUnique({
                where: { id: swap.orderItem.order.sessionId },
                select: { status: true },
            })
            if (session?.status === 'CLOSED') {
                return NextResponse.json({ error: 'SESSION_ALREADY_CLOSED' }, { status: 409 })
            }
        }

        await prisma.$transaction(async (tx) => {
            await reverseSwap(tx, swap, user.id, decrementStock)
            // The charge line has stopped counting, so the round is worth less.
            if (swap.chargeItemId) await recomputeOrderTotal(tx, swap.orderItem.order.id)
        })

        return NextResponse.json({ reversed: true })
    } catch (error) {
        console.error('[package swap] reverse failed', error)
        return NextResponse.json({ error: 'Failed to reverse' }, { status: 500 })
    }
}
