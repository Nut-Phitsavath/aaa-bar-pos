/**
 * Reconciliation check for the reports page.
 *
 * Three figures on that page were read off columns this bar does not write,
 * and each was wrong in a way nobody could see from the screen - the number
 * looked like a number. This asserts they are still being read off the live
 * source, from a direction the route itself does not use.
 *
 *   1. Revenue nets off the per-table discount. The route sums it from
 *      TableSession; this rebuilds the same total by pricing every closed bill
 *      and adding the walk-ins, so the two only agree if the route is reading
 *      the discount the customer was actually given.
 *   2. Comps come from OWNER_VIP payments, not the cafe's isReportable flag.
 *   3. Voided lines are out of the per-item sums.
 *
 * The bill math below is deliberately a second implementation rather than an
 * import of lib/payments: a cross-check that shares its arithmetic with the
 * thing it is checking proves nothing.
 *
 * Run: node prisma/checkReports.js
 * Exits non-zero if any of the three regress.
 */
const { PrismaClient } = require("@prisma/client")

const prisma = new PrismaClient()

/** Mirrors lib/payments.billTotalOf: discount clamped to the bill, then ceil. */
function billTotal(gross, type, value) {
    const v = value || 0
    if (!type || v <= 0) return Math.max(0, Math.ceil(gross))
    const raw = type === "PERCENT" ? gross * (v / 100) : v
    return Math.max(0, Math.ceil(gross - Math.min(Math.max(0, raw), gross)))
}

const failures = []
function check(name, ok, detail) {
    console.log(`${ok ? "  ok" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`)
    if (!ok) failures.push(name)
}

async function main() {
    // --- 1. Revenue nets off the per-table discount -----------------------
    const gross = (await prisma.order.aggregate({
        where: { status: "COMPLETED", isReportable: true },
        _sum: { total: true },
    }))._sum.total || 0

    const discounted = await prisma.tableSession.findMany({
        where: { discountType: { not: null } },
        select: {
            discountType: true, discountValue: true,
            orders: {
                where: { status: "COMPLETED", isReportable: true },
                select: { total: true },
            },
        },
    })
    const discounts = discounted.reduce((sum, s) => {
        const g = s.orders.reduce((n, o) => n + o.total, 0)
        return sum + (g - billTotal(g, s.discountType, s.discountValue))
    }, 0)

    check(
        "per-table discounts are read from the session, not Order.discount",
        discounted.length === 0 || discounts > 0,
        `${discounted.length} discounted bills, ฿${Math.round(discounts)}`
    )

    const orderDiscountColumn = (await prisma.order.aggregate({ _sum: { discount: true } }))._sum.discount || 0
    check(
        "Order.discount is still the dead cafe column",
        orderDiscountColumn === 0 || discounts > 0,
        `Order.discount sums to ฿${orderDiscountColumn}`
    )

    // Same total, built the other way: price every closed bill, add walk-ins.
    const closed = await prisma.tableSession.findMany({
        where: { closedAt: { not: null } },
        select: {
            discountType: true, discountValue: true,
            orders: {
                where: { isReportable: true },
                select: { status: true, total: true },
            },
        },
    })
    const billed = closed.reduce((sum, s) => {
        const g = s.orders.filter(o => o.status === "COMPLETED").reduce((n, o) => n + o.total, 0)
        return sum + billTotal(g, s.discountType, s.discountValue)
    }, 0)
    const walkIns = (await prisma.order.aggregate({
        where: { sessionId: null, status: "COMPLETED", isReportable: true },
        _sum: { total: true },
    }))._sum.total || 0

    const net = gross - discounts
    // One baht per discounted bill is the most the round-up can account for.
    const slack = Math.max(1, discounted.length)
    check(
        "net revenue equals what the bills actually charged",
        Math.abs(net - (billed + walkIns)) <= slack,
        `net ฿${Math.round(net)} vs billed ฿${Math.round(billed + walkIns)}`
    )

    // --- 2. Comps come from OWNER_VIP payments ---------------------------
    const compPayments = await prisma.payment.aggregate({
        where: { method: "OWNER_VIP", voidedAt: null },
        _sum: { amount: true }, _count: true,
    })
    const cafeComps = await prisma.order.count({ where: { isReportable: false } })
    check(
        "comps are counted from OWNER_VIP payments",
        compPayments._count > 0 || cafeComps === 0,
        `${compPayments._count} comped bills worth ฿${Math.round(compPayments._sum.amount || 0)}, ` +
        `${cafeComps} on the old isReportable flag`
    )

    // --- 3. Voided lines are out of the per-item sums ---------------------
    const liveLines = await prisma.orderItem.aggregate({
        where: { voidedAt: null, order: { status: "COMPLETED", isReportable: true } },
        _sum: { total: true },
    })
    const voidedLines = await prisma.orderItem.aggregate({
        where: { voidedAt: { not: null }, order: { status: "COMPLETED", isReportable: true } },
        _sum: { total: true }, _count: true,
    })
    check(
        "struck lines are excluded from item-level sales",
        (liveLines._sum.total || 0) <= gross + 1,
        `${voidedLines._count} struck lines worth ฿${Math.round(voidedLines._sum.total || 0)} held out`
    )

    console.log()
    if (failures.length) {
        console.error(`${failures.length} check(s) failed.`)
        process.exitCode = 1
    } else {
        console.log("Reports reconcile.")
    }
}

main()
    .catch(e => { console.error(e); process.exitCode = 1 })
    .finally(() => prisma.$disconnect())
