import { prisma } from './prisma'
import { sessionTotal, sessionBillTotal } from './sessions'
import { isFullySettled, isConfirmed } from './payments'
import { DEFAULT_RATE_LAK, DEFAULT_RATE_USD, taxRateOf } from './currency'

/**
 * Server-side settlement. The one place a table bill becomes closed.
 *
 * Called after every payment lands and by the close endpoint, so a bill that
 * reaches zero balance settles itself whether the last leg was cash taken at
 * the table or a QR confirmed by a background poll. Idempotent: closing an
 * already-closed session is a no-op, not an error, because two devices can
 * both watch the same payment confirm.
 */
export async function closeSessionIfSettled(sessionId: string): Promise<{
    closed: boolean
    reason?: string
    total?: number
}> {
    const session = await prisma.tableSession.findUnique({
        where: { id: sessionId },
        include: {
            orders: { select: { id: true, status: true, total: true } },
            payments: true
        }
    })

    if (!session) return { closed: false, reason: 'SESSION_NOT_FOUND' }
    const total = sessionBillTotal(session)
    if (session.status === "CLOSED") return { closed: true, total }

    if (!isFullySettled(total, session.payments)) {
        return { closed: false, reason: 'BALANCE_OUTSTANDING', total }
    }

    // Stamp the rates this bill settles at; after this it never reads settings
    // again (req #18). VAT is stamped with them: an Order already stores its own
    // taxAmount, and without this a table bill reprints at whatever rate the
    // owner has since set.
    const rateRows = await prisma.setting.findMany({
        where: { key: { in: ['rate_lak', 'rate_usd', 'taxRate', 'tax_rate'] } }
    })
    const valueOf = (key: string) => rateRows.find((r) => r.key === key)?.value
    const rateOf = (key: string, fallback: number) => {
        const parsed = Number(valueOf(key))
        return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
    }
    const fxRateLAK = rateOf('rate_lak', DEFAULT_RATE_LAK)
    const fxRateUSD = rateOf('rate_usd', DEFAULT_RATE_USD)
    const taxRate = taxRateOf(valueOf('taxRate') ?? valueOf('tax_rate'))

    const openShift = await prisma.shift.findFirst({ where: { status: 'OPEN' } })
    const closedAt = new Date()

    // With split tender there is no single payment method. Orders record the
    // one that settled them when there was only one, and SPLIT otherwise - the
    // real per-method breakdown for the Z-report comes off the Payment rows.
    const methods = Array.from(
        new Set(session.payments.filter(isConfirmed).map((p) => p.method))
    )
    const orderMethod = methods.length === 1 ? methods[0] : methods.length === 0 ? 'CASH' : 'SPLIT'

    await prisma.$transaction(async (tx) => {
        // Book the revenue. Stock moved when each round was sent, so nothing
        // here touches inventory. The cash drawer was incremented as each cash
        // payment was taken, so nothing here touches the drawer either.
        await tx.order.updateMany({
            where: { sessionId, status: 'SENT' },
            data: {
                status: 'COMPLETED',
                paymentMethod: orderMethod,
                shiftId: openShift?.id ?? null,
                updatedAt: closedAt
            }
        })

        // A QR printed on the bill that the customer never used would sit on a
        // settled bill looking unresolved. It never counted towards the balance,
        // so retiring it changes no money - only the reading.
        await tx.payment.updateMany({
            where: { sessionId, method: 'ONEPAY', paymentStatus: 'PENDING' },
            data: { paymentStatus: 'CANCELLED' }
        })

        const closedSession = await tx.tableSession.update({
            where: { id: sessionId },
            data: { status: 'CLOSED', closedAt, fxRateLAK, fxRateUSD, taxRate }
        })

        // The party has paid and left; the glasses have not. Marking the table
        // rather than freeing it is what stops a host seating somebody onto a
        // table nobody has collected - the floor plan used to call it free the
        // instant this row changed.
        //
        // Only when the last bill goes: a split table with one half still
        // drinking is not ready to be cleared.
        const stillOpen = await tx.tableSession.count({
            where: {
                tableId: closedSession.tableId,
                status: { not: 'CLOSED' },
            },
        })
        if (stillOpen === 0) {
            await tx.table.update({
                where: { id: closedSession.tableId },
                data: { needsClearing: true },
            })
        }
    })

    return { closed: true, total }
}
