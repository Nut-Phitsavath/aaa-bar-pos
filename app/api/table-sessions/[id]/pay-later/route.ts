import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOpenShift } from '@/lib/shift-guard'
import { getSessionUser } from '@/lib/auth'
import { verifyManager } from '@/lib/manager-auth'
import { sessionTotal } from '@/lib/sessions'
import { billTotalOf, balanceOf } from '@/lib/payments'
import { DEFAULT_RATE_LAK, DEFAULT_RATE_USD, taxRateOf } from '@/lib/currency'

export const dynamic = 'force-dynamic'

/**
 * Send an unpaid bill to a customer's tab (requirement #19).
 *
 * Deliberately NOT a payment method: no money arrived, and recording one would
 * put takings in the Z-report that are not in the drawer. Instead the bill
 * closes with its balance still owed and a customer carrying it. Settling later
 * adds ordinary CASH/ONEPAY payments to this same session, so a part-payment
 * simply reduces what they owe and the tab clears itself at zero.
 *
 * Manager-authorised: letting someone walk out without paying is the same class
 * of decision as comping them.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const { customerId, managerUsername, managerPin } = await request.json()

        // A tab outside a shift lands in no drawer count.
        const currentShift = await prisma.shift.findFirst({ where: { status: 'OPEN' } })
        const shiftCheck = requireOpenShift(currentShift)
        if (!shiftCheck.ok) {
            return NextResponse.json({ error: shiftCheck.reason }, { status: 409 })
        }

        const user = await getSessionUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        if (!customerId) {
            // An anonymous tab is a debt with nobody's name on it.
            return NextResponse.json({ error: 'CUSTOMER_REQUIRED' }, { status: 400 })
        }

        const session = await prisma.tableSession.findUnique({
            where: { id },
            include: {
                orders: { select: { id: true, status: true, total: true } },
                payments: true
            }
        })
        if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
        if (session.status === 'CLOSED') {
            return NextResponse.json({ error: 'SESSION_ALREADY_CLOSED' }, { status: 409 })
        }

        const customer = await prisma.customer.findUnique({ where: { id: customerId } })
        if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

        const approval = await verifyManager(managerUsername, managerPin)
        if (!approval.ok) {
            return NextResponse.json(
                { error: approval.reason, retryInMs: approval.retryInMs },
                { status: approval.reason === 'TOO_MANY_ATTEMPTS' ? 429 : 403 }
            )
        }

        const total = billTotalOf(sessionTotal(session.orders), session.discountType, session.discountValue)
        const outstanding = balanceOf(total, session.payments)
        if (outstanding <= 0) {
            return NextResponse.json({ error: 'BILL_ALREADY_SETTLED' }, { status: 409 })
        }

        // Same rate snapshot a paid bill gets: the tab is settled at the rates it
        // was run up at, not whatever the board says the night it is collected.
        const rateRows = await prisma.setting.findMany({
            where: { key: { in: ['rate_lak', 'rate_usd', 'taxRate', 'tax_rate'] } }
        })
        const valueOf = (key: string) => rateRows.find((r) => r.key === key)?.value
        const rateOf = (key: string, fallback: number) => {
            const parsed = Number(valueOf(key))
            return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
        }

        const openShift = await prisma.shift.findFirst({ where: { status: 'OPEN' } })
        const closedAt = new Date()

        await prisma.$transaction(async (tx) => {
            // The sale is real and the stock is gone, so the orders complete.
            // What is missing is the money, which the tab now carries.
            await tx.order.updateMany({
                where: { sessionId: id, status: 'SENT' },
                data: {
                    status: 'COMPLETED',
                    paymentMethod: 'PAY_LATER',
                    shiftId: openShift?.id ?? null,
                    updatedAt: closedAt
                }
            })

            await tx.tableSession.update({
                where: { id },
                data: {
                    status: 'CLOSED',
                    closedAt,
                    fxRateLAK: rateOf('rate_lak', DEFAULT_RATE_LAK),
                    fxRateUSD: rateOf('rate_usd', DEFAULT_RATE_USD),
                    taxRate: taxRateOf(valueOf('taxRate') ?? valueOf('tax_rate')),
                    customerId: customerId,
                    payLaterApprovedById: approval.manager.id
                }
            })
        })

        return NextResponse.json({
            success: true,
            outstanding,
            customer: customer.name,
            approvedBy: approval.manager.name
        })
    } catch (error) {
        console.error('[pay-later] POST failed', error)
        return NextResponse.json({ error: 'Failed to open tab' }, { status: 500 })
    }
}
