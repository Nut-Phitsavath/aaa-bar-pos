import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { verifyManager } from '@/lib/manager-auth'
import { sessionTotal } from '@/lib/sessions'
import { billTotalOf, balanceOf } from '@/lib/payments'
import { closeSessionIfSettled } from '@/lib/settle'

export const dynamic = 'force-dynamic'

/**
 * Owner VIP: the table drinks, the house pays (requirement #16).
 *
 * Stock was already deducted when each round was sent, which is the point -
 * the bottles really left the shelf. What changes is the money: the remaining
 * balance is settled by an OWNER_VIP payment, so the bill nets to zero and the
 * Z-report can show comped drinks as their own line rather than losing them.
 *
 * Manager-authorised, and the approving manager's id stays on the payment.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const { managerUsername, managerPin } = await request.json()

        const user = await getSessionUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

        const approval = await verifyManager(managerUsername, managerPin)
        if (!approval.ok) {
            return NextResponse.json(
                { error: approval.reason, retryInMs: approval.retryInMs },
                { status: approval.reason === 'TOO_MANY_ATTEMPTS' ? 429 : 403 }
            )
        }

        const total = billTotalOf(sessionTotal(session.orders), session.discountType, session.discountValue)
        const balance = balanceOf(total, session.payments)

        if (balance <= 0) {
            return NextResponse.json({ error: 'BILL_ALREADY_SETTLED' }, { status: 409 })
        }

        // Comp only what is still owed. Anything already paid in cash stays
        // paid - the house does not refund a settled leg to comp it.
        await prisma.$transaction(async (tx) => {
            await tx.payment.create({
                data: {
                    session: { connect: { id } },
                    method: 'OWNER_VIP',
                    amount: balance,
                    paymentStatus: 'PAID',
                    user: { connect: { id: user.id } },
                    approvedBy: { connect: { id: approval.manager.id } }
                }
            })
            await tx.tableSession.update({ where: { id }, data: { isOwnerVip: true } })
        })

        const settled = await closeSessionIfSettled(id)

        return NextResponse.json({
            success: true,
            comped: balance,
            approvedBy: approval.manager.name,
            closed: settled.closed
        })
    } catch (error) {
        console.error('[comp] POST failed', error)
        return NextResponse.json({ error: 'Failed to comp bill' }, { status: 500 })
    }
}
