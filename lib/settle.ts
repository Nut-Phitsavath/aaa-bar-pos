import { prisma } from './prisma'
import { sessionTotal } from './sessions'
import { isFullySettled, isConfirmed, billTotalOf } from './payments'
import { DEFAULT_RATE_LAK, DEFAULT_RATE_USD } from './currency'

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
    const total = billTotalOf(sessionTotal(session.orders), session.discountType, session.discountValue)
    if (session.status === "CLOSED") return { closed: true, total }

    if (!isFullySettled(total, session.payments)) {
        return { closed: false, reason: 'BALANCE_OUTSTANDING', total }
    }

    // Stamp the rate this bill settles at; after this it never reads settings
    // again (req #18).
    const rateRows = await prisma.setting.findMany({
        where: { key: { in: ['rate_lak', 'rate_usd'] } }
    })
    const rateOf = (key: string, fallback: number) => {
        const parsed = Number(rateRows.find((r) => r.key === key)?.value)
        return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
    }
    const fxRateLAK = rateOf('rate_lak', DEFAULT_RATE_LAK)
    const fxRateUSD = rateOf('rate_usd', DEFAULT_RATE_USD)

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

        await tx.tableSession.update({
            where: { id: sessionId },
            data: { status: 'CLOSED', closedAt, fxRateLAK, fxRateUSD }
        })
    })

    return { closed: true, total }
}
