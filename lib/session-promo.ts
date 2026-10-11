import { prisma } from './prisma'
import { promoDiscountForLines } from './promotions'
import { BILLABLE_ORDER_STATUSES, canRepricePromo } from './sessions'

/**
 * Keeping a bill's promo discount true.
 *
 * `TableSession.promoDiscount` is a snapshot, for the same reason `fxRateLAK`
 * is: every screen that prices a bill would otherwise have to load its items to
 * find out what a deal took off, and there are eighteen of them. The cost of a
 * snapshot is that something has to keep it current, and that something is
 * here - called when the promo is applied, and again whenever the bill's
 * contents change.
 *
 * It has to be recomputed rather than left alone because both directions
 * matter. A percentage deal grows as more rounds land. A "15 Free 5" deal that
 * qualified on fifteen bottles stops qualifying the moment one of them is
 * voided - and a bill that kept the discount after the drinks came off would
 * be a discount the bar never agreed to.
 */

/** Anything that can run these queries: the client, or a transaction. */
type Executor = Pick<typeof prisma, 'orderItem' | 'tableSession' | 'promotion'>

/**
 * Work out what the session's promo is worth right now.
 *
 * Reads the lines that are actually on the bill - billable rounds, struck lines
 * excluded - and prices the promo against the slice of them it is scoped to.
 * Returns 0 when there is no promo, which is also what clears the snapshot.
 */
export async function computeSessionPromo(tx: Executor, sessionId: string): Promise<number> {
    const session = await tx.tableSession.findUnique({
        where: { id: sessionId },
        select: { promoId: true },
    })
    if (!session?.promoId) return 0

    const promo = await tx.promotion.findUnique({ where: { id: session.promoId } })
    if (!promo) return 0

    const lines = await tx.orderItem.findMany({
        where: {
            // A struck line is not on the bill and must not count towards a
            // minimum or be discounted.
            voidedAt: null,
            order: {
                sessionId,
                status: { in: [...BILLABLE_ORDER_STATUSES] },
            },
        },
        select: {
            quantity: true,
            total: true,
            menu: { select: { categoryId: true } },
        },
    })

    return promoDiscountForLines(
        promo,
        lines.map((l) => ({
            categoryId: l.menu?.categoryId ?? null,
            quantity: l.quantity,
            total: l.total,
        }))
    )
}

/**
 * Recompute and store it. Safe to call on a session with no promo - it writes
 * null and costs one indexed read.
 *
 * Deliberately silent on a bill that has closed, or been reopened after
 * closing: a settled bill is priced at what the customer was charged, and a
 * late recompute would rewrite history the same way re-reading the exchange
 * rate would. See canRepricePromo.
 */
export async function refreshSessionPromo(tx: Executor, sessionId: string): Promise<number | null> {
    const session = await tx.tableSession.findUnique({
        where: { id: sessionId },
        select: { status: true, promoId: true, reopenedAt: true },
    })
    if (!session || !canRepricePromo(session)) return null
    if (!session.promoId) {
        await tx.tableSession.update({ where: { id: sessionId }, data: { promoDiscount: null } })
        return null
    }

    const amount = await computeSessionPromo(tx, sessionId)
    await tx.tableSession.update({ where: { id: sessionId }, data: { promoDiscount: amount } })
    return amount
}
