import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { sessionTotal } from '@/lib/sessions'
import { billTotalOf, balanceOf } from '@/lib/payments'

export const dynamic = 'force-dynamic'

/**
 * Who owes what (requirement #19).
 *
 * A tab is a closed bill that still has a balance and a customer against it.
 * Outstanding is computed from the payment rows rather than stored, so a
 * part-payment taken later reduces it without anything needing to be kept in
 * sync, and a tab paid off simply stops appearing.
 */
export async function GET() {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    try {
        const sessions = await prisma.tableSession.findMany({
            where: { payLaterCustomerId: { not: null } },
            orderBy: { closedAt: 'desc' },
            include: {
                table: { select: { name: true } },
                payLaterCustomer: { select: { id: true, name: true, phone: true } },
                orders: { select: { status: true, total: true } },
                payments: true
            }
        })

        const byCustomer = new Map<string, {
            customer: { id: string; name: string; phone: string | null }
            outstanding: number
            bills: { id: string; table: string; closedAt: string | null; total: number; balance: number }[]
        }>()

        for (const s of sessions) {
            if (!s.payLaterCustomer) continue
            const total = billTotalOf(sessionTotal(s.orders), s.discountType, s.discountValue)
            const balance = balanceOf(total, s.payments)
            if (balance <= 0) continue // settled tabs drop off the list

            const key = s.payLaterCustomer.id
            const entry = byCustomer.get(key) ?? {
                customer: s.payLaterCustomer,
                outstanding: 0,
                bills: []
            }
            entry.outstanding += balance
            entry.bills.push({
                id: s.id,
                table: s.table.name,
                closedAt: s.closedAt?.toISOString() ?? null,
                total,
                balance
            })
            byCustomer.set(key, entry)
        }

        const tabs = Array.from(byCustomer.values()).sort((a, b) => b.outstanding - a.outstanding)

        return NextResponse.json({
            tabs,
            totalOutstanding: tabs.reduce((sum, t) => sum + t.outstanding, 0)
        })
    } catch (error) {
        console.error('[tabs] GET failed', error)
        return NextResponse.json({ error: 'Failed to load tabs' }, { status: 500 })
    }
}
