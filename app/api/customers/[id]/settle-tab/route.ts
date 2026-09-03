import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { outstandingForCustomer } from '@/lib/customer-tabs'
import { allocateOldestFirst } from '@/lib/tabs'

export const dynamic = 'force-dynamic'

/**
 * Take a payment against a customer's tab (requirement #19).
 *
 * Against the CUSTOMER, not a bill. Cash arrives as a lump - "here's ten
 * thousand toward it" - not as a decision about which night to clear, so the
 * amount is spread across their open bills oldest first. Settling bill by bill
 * made staff do that arithmetic at the counter with the customer waiting.
 *
 * Only cash for now. A QR has to be minted for one exact amount against one
 * payment row, and a tab payment spanning four bills is four rows; that is
 * worth doing, but it is a different shape and not what is being asked for.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const { amount } = await request.json()

        const user = await getSessionUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const requested = Math.round(Number(amount) || 0)
        if (requested <= 0) {
            return NextResponse.json({ error: 'AMOUNT_REQUIRED' }, { status: 400 })
        }

        const customer = await prisma.customer.findUnique({ where: { id } })
        if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

        const { total, bills } = await outstandingForCustomer(id)
        if (total <= 0) {
            return NextResponse.json({ error: 'NOTHING_OUTSTANDING' }, { status: 409 })
        }

        const plan = allocateOldestFirst(requested, bills)
        const openShift = await prisma.shift.findFirst({ where: { status: 'OPEN' } })

        await prisma.$transaction(async (tx) => {
            for (const part of plan.parts) {
                await tx.payment.create({
                    data: {
                        session: { connect: { id: part.sessionId } },
                        method: 'CASH',
                        amount: part.amount,
                        paymentStatus: 'PAID',
                        user: { connect: { id: user.id } },
                    },
                })
            }

            // The drawer takes what was applied, not what was handed over: the
            // excess goes back across the counter as change.
            if (openShift && plan.applied > 0) {
                await tx.shift.update({
                    where: { id: openShift.id },
                    data: { cashPayments: { increment: plan.applied } },
                })
            }
        })

        const after = await outstandingForCustomer(id)

        return NextResponse.json({
            applied: plan.applied,
            change: plan.unapplied,
            billsCleared: plan.parts.filter((p) => {
                const bill = bills.find((b) => b.id === p.sessionId)
                return bill && p.amount >= bill.balance
            }).length,
            outstanding: after.total,
            customer: customer.name,
        })
    } catch (error) {
        console.error('[settle tab] POST failed', error)
        return NextResponse.json({ error: 'Failed to take payment' }, { status: 500 })
    }
}
