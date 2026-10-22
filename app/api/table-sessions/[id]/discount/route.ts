import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { verifyManager } from '@/lib/manager-auth'
import { sessionTotal, sessionBillTotal } from '@/lib/sessions'
import { billTotalOf, balanceOf, canDiscount } from '@/lib/payments'
import { closeSessionIfSettled } from '@/lib/settle'

export const dynamic = 'force-dynamic'

/**
 * Apply or clear a per-table discount (requirement #15).
 *
 * Manager-authorised: a discount is money the house chooses not to take, and
 * the approving manager's id stays on the session so the report can name who
 * signed it off.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const { discountType, discountValue, managerUsername, managerPin } = await request.json()

        const user = await getSessionUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const clearing = !discountType || Number(discountValue) <= 0
        if (!clearing && !['PERCENT', 'FIXED'].includes(discountType)) {
            return NextResponse.json({ error: 'Discount must be PERCENT or FIXED' }, { status: 400 })
        }

        const session = await prisma.tableSession.findUnique({
            where: { id },
            include: {
                orders: { select: { status: true, total: true } },
                payments: true
            }
        })
        if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
        if (session.status === 'CLOSED') {
            return NextResponse.json({ error: 'SESSION_ALREADY_CLOSED' }, { status: 409 })
        }

        // Before the PIN check, so a mistyped amount cannot use up one of the
        // manager's attempts. Against the bill after its promotion: that is
        // what the discount comes off.
        const base = Math.max(0, sessionTotal(session.orders) - (session.promoDiscount || 0))
        const allowed = canDiscount(base, discountType, Number(discountValue))
        if (!allowed.ok) {
            return NextResponse.json({ error: allowed.reason, max: base }, { status: 400 })
        }

        const approval = await verifyManager(managerUsername, managerPin)
        if (!approval.ok) {
            return NextResponse.json(
                { error: approval.reason, retryInMs: approval.retryInMs },
                { status: approval.reason === 'TOO_MANY_ATTEMPTS' ? 429 : 403 }
            )
        }

        const gross = sessionTotal(session.orders)
        const newTotal = clearing
            ? gross
            : sessionBillTotal({
                ...session,
                discountType,
                discountValue: Number(discountValue),
            })

        // Refuse a discount that would drop the bill below what has already been
        // paid: that is a refund, and this endpoint cannot give money back.
        const paid = gross - balanceOf(gross, session.payments)
        if (newTotal < paid) {
            return NextResponse.json(
                { error: 'DISCOUNT_BELOW_AMOUNT_PAID', paid, newTotal },
                { status: 409 }
            )
        }

        const updated = await prisma.tableSession.update({
            where: { id },
            data: clearing
                ? { discountType: null, discountValue: null, discountApprovedById: null }
                : {
                    discountType,
                    discountValue: Number(discountValue),
                    discountApprovedById: approval.manager.id
                }
        })

        // A discount can settle a bill outright when enough was already paid.
        const settled = await closeSessionIfSettled(id)

        return NextResponse.json({
            session: updated,
            total: newTotal,
            approvedBy: clearing ? null : approval.manager.name,
            closed: settled.closed
        })
    } catch (error) {
        console.error('[discount] PUT failed', error)
        return NextResponse.json({ error: 'Failed to apply discount' }, { status: 500 })
    }
}
