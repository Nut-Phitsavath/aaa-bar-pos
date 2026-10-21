import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { verifyManager } from '@/lib/manager-auth'
import { canReopen } from '@/lib/bill-operations'

export const dynamic = 'force-dynamic'

/**
 * Reopen a settled bill (Toast and Lightspeed both call this reopening a check).
 *
 * The case is small and immediate: the table paid, then asked for one more
 * round. Without this, staff open a SECOND table for the same customers - so
 * the absence of the feature does not prevent the mistake, it just records it
 * badly, inflating the table count, splitting the server's figures and ruining
 * average spend.
 *
 * What is deliberately NOT undone:
 *
 * The payments stay. That money really was taken, and it is already counted in
 * an open drawer. The bill simply owes again once a new round is added, because
 * the balance is computed from total minus payments rather than stored.
 *
 * The FX rate stays. `closeSessionIfSettled` stamps the kip rate at close, and
 * re-closing would restamp it at today's - silently re-rating a bill that was
 * run up last night, which is exactly what requirement #18 forbids. So the
 * original stamp is preserved and only cleared if it was never set.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const { managerUsername, managerPin, reason } = await request.json()

        const user = await getSessionUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const session = await prisma.tableSession.findUnique({
            where: { id },
            include: { orders: { select: { shiftId: true } } },
        })
        if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

        const openShift = await prisma.shift.findFirst({ where: { status: 'OPEN' } })
        // The bill belongs to whichever shift its rounds were rung into.
        const billShiftId = session.orders.find((o) => o.shiftId)?.shiftId ?? null

        const check = canReopen({ status: session.status, shiftId: billShiftId }, openShift?.id ?? null)
        if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 409 })

        // Manager-approved: reopening puts a counted bill back into play.
        const approval = await verifyManager(managerUsername, managerPin)
        if (!approval.ok) {
            return NextResponse.json(
                { error: approval.reason, retryInMs: approval.retryInMs },
                { status: approval.reason === 'TOO_MANY_ATTEMPTS' ? 429 : 403 }
            )
        }

        const reopened = await prisma.tableSession.update({
            where: { id },
            data: {
                status: 'OPEN',
                closedAt: null,
                reopenedAt: new Date(),
                reopenedById: user.id,
                reopenReason: typeof reason === 'string' && reason.trim() ? reason.trim() : null,
            },
        })

        return NextResponse.json({ session: reopened })
    } catch (error) {
        console.error('[session reopen] POST failed', error)
        return NextResponse.json({ error: 'Failed to reopen' }, { status: 500 })
    }
}
