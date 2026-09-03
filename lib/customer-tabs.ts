import { prisma } from './prisma'
import { sessionTotal } from './sessions'
import { billTotalOf, balanceOf } from './payments'
import type { OpenBill } from './tabs'

/**
 * What one customer still owes, bill by bill.
 *
 * Derived from payment rows rather than stored, so a part-payment taken later
 * reduces it without anything needing to be kept in step, and a tab paid off
 * simply stops appearing. Shared by the tabs screen, the floor plan and the
 * settle flow so all three quote the same number.
 */
export async function outstandingForCustomer(customerId: string): Promise<{
    total: number
    bills: (OpenBill & { table: string; billTotal: number })[]
}> {
    const sessions = await prisma.tableSession.findMany({
        where: { customerId, status: 'CLOSED' },
        orderBy: { closedAt: 'asc' },
        include: {
            table: { select: { name: true } },
            orders: { select: { status: true, total: true } },
            payments: true,
        },
    })

    const bills = sessions
        .map((s) => {
            const billTotal = billTotalOf(sessionTotal(s.orders), s.discountType, s.discountValue)
            return {
                id: s.id,
                table: s.table.name,
                closedAt: s.closedAt,
                billTotal,
                balance: balanceOf(billTotal, s.payments),
            }
        })
        .filter((b) => b.balance > 0)

    return { total: bills.reduce((sum, b) => sum + b.balance, 0), bills }
}

/** Outstanding for several customers at once, without a query per customer. */
export async function outstandingByCustomer(): Promise<Map<string, number>> {
    const sessions = await prisma.tableSession.findMany({
        where: { customerId: { not: null }, status: 'CLOSED' },
        include: {
            orders: { select: { status: true, total: true } },
            payments: true,
        },
    })

    const owed = new Map<string, number>()
    for (const s of sessions) {
        if (!s.customerId) continue
        const billTotal = billTotalOf(sessionTotal(s.orders), s.discountType, s.discountValue)
        const balance = balanceOf(billTotal, s.payments)
        if (balance <= 0) continue
        owed.set(s.customerId, (owed.get(s.customerId) ?? 0) + balance)
    }
    return owed
}
