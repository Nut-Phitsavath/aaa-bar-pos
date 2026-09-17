import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { refreshSessionPromo } from '@/lib/session-promo'
import { sessionTotal, sessionBillTotal, canRepricePromo } from '@/lib/sessions'
import { balanceOf } from '@/lib/payments'
import { promoWindowBlocker, isStaffPickable } from '@/lib/promotions'

export const dynamic = 'force-dynamic'

/**
 * Put a promotion on a table bill, or take it off again.
 *
 * Until this existed a promotion could only attach to a walk-in counter order,
 * so the deals this bar actually runs - "15 Free 5" on a crate of beer - could
 * not touch the trade that goes through a table, which is most of it.
 *
 * Deliberately NOT behind a manager PIN, unlike the per-table discount. A
 * promotion is a price the owner has already set, with its own window and its
 * own minimum; applying one is staff following the rules rather than writing
 * money off. The manual discount is the one that needs a name against it,
 * because it is a decision made at the table.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    try {
        const { id } = await params
        const { promoId } = await request.json()
        if (!promoId || typeof promoId !== 'string') {
            return NextResponse.json({ error: 'PROMO_REQUIRED' }, { status: 400 })
        }

        const session = await prisma.tableSession.findUnique({
            where: { id },
            include: { orders: { select: { status: true, total: true } }, payments: true },
        })
        if (!session) return NextResponse.json({ error: 'SESSION_NOT_FOUND' }, { status: 404 })
        // Closed, or settled once and reopened for a correction. Neither is a
        // bill whose deal should still be moving.
        if (!canRepricePromo(session)) {
            return NextResponse.json({ error: 'SESSION_ALREADY_CLOSED' }, { status: 409 })
        }

        const promo = await prisma.promotion.findUnique({ where: { id: promoId } })
        if (!promo) return NextResponse.json({ error: 'PROMO_NOT_FOUND' }, { status: 404 })

        // A coupon is typed off the voucher the customer is holding, never
        // picked off a list. The screen hides these; the server refuses them,
        // because a screen filter is a suggestion and this one guards money.
        if (!isStaffPickable(promo)) {
            return NextResponse.json({ error: 'CODE_ONLY' }, { status: 403 })
        }

        // Live right now? The window and the active flag only - the minimum is
        // left to the recompute below, which knows the bill's contents.
        //
        // This used to be promoBlocker(promo, Number.MAX_SAFE_INTEGER): an
        // absurd item count passed in to dodge the minimum check. It worked,
        // said nothing about why, and would have broken silently the day
        // another rule keyed off that count.
        const blocked = promoWindowBlocker(promo)
        if (blocked) {
            return NextResponse.json({ error: blocked.toUpperCase() }, { status: 409 })
        }

        const amount = await prisma.$transaction(async (tx) => {
            await tx.tableSession.update({ where: { id }, data: { promoId } })
            return refreshSessionPromo(tx as any, id)
        })

        // A deal that qualifies on nothing yet is not an error - the round that
        // unlocks it may not be rung in - but the till should say so rather
        // than show a promo that is quietly worth zero.
        const fresh = await prisma.tableSession.findUnique({
            where: { id },
            include: { orders: { select: { status: true, total: true } }, payments: true },
        })
        const total = sessionBillTotal(fresh!)

        return NextResponse.json({
            promoId,
            promoName: promo.name,
            promoDiscount: amount ?? 0,
            qualifies: (amount ?? 0) > 0,
            gross: sessionTotal(fresh!.orders),
            total,
            balance: balanceOf(total, fresh!.payments),
        })
    } catch (error) {
        console.error('[session promo] POST failed', error)
        return NextResponse.json({ error: 'Failed to apply promotion' }, { status: 500 })
    }
}

/** Take the promotion back off. The bill re-prices to its full amount. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    try {
        const { id } = await params
        const session = await prisma.tableSession.findUnique({
            where: { id },
            select: { status: true, reopenedAt: true },
        })
        if (!session) return NextResponse.json({ error: 'SESSION_NOT_FOUND' }, { status: 404 })
        if (!canRepricePromo(session)) {
            return NextResponse.json({ error: 'SESSION_ALREADY_CLOSED' }, { status: 409 })
        }

        await prisma.tableSession.update({
            where: { id },
            data: { promoId: null, promoDiscount: null },
        })

        const fresh = await prisma.tableSession.findUnique({
            where: { id },
            include: { orders: { select: { status: true, total: true } }, payments: true },
        })
        const total = sessionBillTotal(fresh!)

        return NextResponse.json({
            promoId: null,
            promoDiscount: 0,
            gross: sessionTotal(fresh!.orders),
            total,
            balance: balanceOf(total, fresh!.payments),
        })
    } catch (error) {
        console.error('[session promo] DELETE failed', error)
        return NextResponse.json({ error: 'Failed to remove promotion' }, { status: 500 })
    }
}
