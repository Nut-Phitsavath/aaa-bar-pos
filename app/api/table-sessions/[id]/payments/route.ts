import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOpenShift } from '@/lib/shift-guard'
import { getSessionUser } from '@/lib/auth'
import { sessionTotal } from '@/lib/sessions'
import { balanceOf, canAcceptPayment, billTotalOf } from '@/lib/payments'
import { closeSessionIfSettled } from '@/lib/settle'

export const dynamic = 'force-dynamic'

/** List the tenders against a bill. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const payments = await prisma.payment.findMany({
            where: { sessionId: id },
            orderBy: { createdAt: 'asc' },
            include: { user: { select: { id: true, name: true } } }
        })
        return NextResponse.json(payments)
    } catch (error) {
        console.error('[payments] GET failed', error)
        return NextResponse.json({ error: 'Failed to load payments' }, { status: 500 })
    }
}

/**
 * Take one tender against a bill.
 *
 * Cash counts immediately and goes into the drawer. OnePay is recorded PENDING
 * and only counts once BCEL confirms it via the status poll - the same
 * mechanism the walk-in till already uses, untouched.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const { method, amount } = await request.json()

        // Money taken outside a shift lands in no drawer count.
        const currentShift = await prisma.shift.findFirst({ where: { status: 'OPEN' } })
        const shiftCheck = requireOpenShift(currentShift)
        if (!shiftCheck.ok) {
            return NextResponse.json({ error: shiftCheck.reason }, { status: 409 })
        }

        const user = await getSessionUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        // TRANSFER is the shop's own bank QR: no API, no webhook, so it counts
        // the moment a staff member says the money landed - the same trust the
        // walk-in till has always placed in that method. OnePay is the only one
        // that waits, because BCEL is the only one that can answer.
        if (!['CASH', 'ONEPAY', 'TRANSFER'].includes(method)) {
            // OWNER_VIP arrives with P2b and needs a manager approval it does
            // not have yet; refusing it here is better than booking a free
            // table nobody signed off.
            return NextResponse.json({ error: 'Unsupported payment method' }, { status: 400 })
        }

        const session = await prisma.tableSession.findUnique({
            where: { id },
            include: {
                orders: { select: { status: true, total: true } },
                payments: true
            }
        })
        if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

        const total = billTotalOf(sessionTotal(session.orders), session.discountType, session.discountValue)
        const requested = Number(amount)

        const check = canAcceptPayment(session, total, session.payments, requested, method)
        if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 409 })

        // Cash may be over-tendered; only what the bill needs is applied, and
        // the rest is change across the counter. Recording the tendered figure
        // would overstate the drawer by exactly the change given.
        const balance = balanceOf(total, session.payments)
        const applied = Math.min(requested, balance)

        const payment = await prisma.$transaction(async (tx) => {
            // Resolved once, before the write: the tender records which shift
            // took it, so a refund can tell "taken minutes ago" from "taken on a
            // night whose drawer has already been counted and signed off".
            const openShift = await tx.shift.findFirst({ where: { status: 'OPEN' } })

            const created = await tx.payment.create({
                data: {
                    session: { connect: { id } },
                    method,
                    amount: applied,
                    paymentStatus: method === 'ONEPAY' ? 'PENDING' : 'PAID',
                    user: { connect: { id: user.id } },
                    ...(openShift ? { shift: { connect: { id: openShift.id } } } : {}),
                }
            })

            // The drawer only ever sees cash, and only the applied amount.
            if (method === 'CASH' && openShift) {
                await tx.shift.update({
                    where: { id: openShift.id },
                    data: { cashPayments: { increment: applied } }
                })
            }

            return created
        })

        // Anything that counts on the spot may have settled the bill outright.
        // OnePay cannot: it is PENDING until the bank says otherwise, and the
        // status poll closes the bill when it does.
        const settle = method !== 'ONEPAY'
            ? await closeSessionIfSettled(id)
            : { closed: false }

        return NextResponse.json({
            payment,
            balance: balanceOf(total, [...session.payments, payment]),
            closed: settle.closed
        })
    } catch (error) {
        console.error('[payments] POST failed', error)
        return NextResponse.json({ error: 'Failed to record payment' }, { status: 500 })
    }
}
