/**
 * The Z-report's money, over one window of time (requirement #25).
 *
 * The window is a shift: from the moment it was opened to the moment it was
 * closed, or to now while it is still open (the X reading). SambaPOS, which
 * the bar ran before this, does the same with its work periods, and it is
 * what makes a bill paid at 01:30 part of the night it was served - this used
 * to run midnight to midnight in UTC, so the bar's "day" started at 07:00 and
 * disagreed with Overview.
 *
 * The identity this report exists to prove, over bills that closed in the
 * window:
 *
 *     net = received + comped + owed + unreconciled
 *
 * `unreconciled` should be zero. It is reported rather than hidden because a
 * non-zero value is exactly the thing a manager needs to see: a bill that
 * closed without accounting for its money.
 *
 * Money taken in the window against a bill that has NOT closed in it - a table
 * still sitting there, or a tab from another night - is its own line,
 * `onOpenBills`. It is in the drawer but it is not a sale yet, and folding it
 * into takings would make the figures irreconcilable the next night.
 *
 * Everything is derived from payment rows rather than from an order's
 * paymentMethod, because a split-tendered bill has no single method. Comped
 * and owed are their own lines, never takings: the drawer only ever held the
 * cash figure, and that is what a manager counts against.
 *
 * Pure: the route fetches, this adds up, and the tests can prove it.
 */

import { sessionTotal, sessionBillTotal } from './sessions.ts'
import { balanceOf, isConfirmed } from './payments.ts'

type Item = { total: number; voidedAt: Date | null }
type ZPayment = { method: string; amount: number; createdAt: Date; paymentStatus?: string | null; voidedAt?: Date | null }

export type ZSession = {
    closedAt: Date | null
    customerId: string | null
    discountType: string | null
    discountValue: number | null
    promoDiscount: number | null
    table: { name: string }
    customer: { name: string } | null
    orders: { status: string; total: number; tax: number | null; items: Item[] }[]
    payments: ZPayment[]
}

export type ZWalkIn = { total: number; tax: number | null; paymentMethod: string; items: Item[] }

export function buildZ({ sessions, walkIns, refunds, start, end }: {
    /** Bills closed in the window, plus bills with a payment taken in it. */
    sessions: ZSession[]
    /** Counter sales completed in the window - they never touch a session. */
    walkIns: ZWalkIn[]
    /** Tenders refunded in the window, dated by the refund. */
    refunds: { amount: number }[]
    start: Date
    end: Date
}) {
    const inWindow = (d: Date | null) => !!d && d >= start && d <= end

    let gross = 0
    let discounts = 0
    let comped = 0
    let owed = 0
    let cashTaken = 0
    let onOpenBills = 0
    let tax = 0
    let tickets = 0
    let voidedCount = 0
    let voidedValue = 0
    const byMethod: Record<string, { amount: number; count: number }> = {}
    const comps: { table: string; amount: number }[] = []
    const tabs: { table: string; customer: string; amount: number }[] = []

    const add = (method: string, amount: number) => {
        const row = byMethod[method] ?? { amount: 0, count: 0 }
        row.amount += amount
        row.count += 1
        byMethod[method] = row
    }
    const countVoids = (items: Item[]) => {
        for (const i of items) {
            if (!i.voidedAt) continue
            voidedCount += 1
            voidedValue += i.total
        }
    }

    for (const s of sessions) {
        const rawGross = sessionTotal(s.orders)
        const total = sessionBillTotal(s)

        // The sale itself counts in the window the bill closed in; a tab
        // collected tonight must not book its drinks a second time.
        const closedHere = inWindow(s.closedAt)
        if (closedHere) {
            gross += rawGross
            discounts += rawGross - total
            // VAT as it was charged, read off the order rather than recomputed
            // from today's rate.
            for (const o of s.orders) {
                if (o.status === 'CANCELLED' || o.status === 'HOLD') continue
                tax += o.tax ?? 0
                tickets += 1
            }
            // Struck lines on every round, cancelled ones included: a round
            // voided whole is still money rung up and taken back off.
            for (const o of s.orders) countVoids(o.items)

            const balance = balanceOf(total, s.payments)
            if (balance > 0 && s.customerId) {
                owed += balance
                tabs.push({ table: s.table.name, customer: s.customer?.name ?? '—', amount: balance })
            }
        }

        for (const p of s.payments) {
            if (!isConfirmed(p) || !inWindow(p.createdAt)) continue
            // Cash is cash the moment it is taken, so the drawer counts it
            // whether or not its bill has closed.
            if (p.method === 'CASH') cashTaken += p.amount
            if (!closedHere) {
                onOpenBills += p.amount
                continue
            }
            add(p.method, p.amount)
            if (p.method === 'OWNER_VIP') {
                comped += p.amount
                comps.push({ table: s.table.name, amount: p.amount })
            }
        }
    }

    for (const o of walkIns) {
        gross += o.total
        tax += o.tax ?? 0
        tickets += 1
        countVoids(o.items)
        const method = o.paymentMethod === 'BANK_NOTE' ? 'CASH' : o.paymentMethod
        add(method, o.total)
        if (method === 'CASH') cashTaken += o.total
    }

    const received = Object.entries(byMethod)
        .filter(([m]) => m !== 'OWNER_VIP')
        .reduce((sum, [, r]) => sum + r.amount, 0)
    const net = gross - discounts

    return {
        gross,
        discounts,
        net,
        received,
        comped,
        owed,
        onOpenBills,
        unreconciled: net - received - comped - owed,
        tax,
        tickets,
        voids: { count: voidedCount, value: voidedValue },
        refunds: { count: refunds.length, value: refunds.reduce((sum, r) => sum + r.amount, 0) },
        byMethod,
        comps,
        tabs,
        /** Cash into the drawer in the window, closed bills or not. */
        cashTaken,
    }
}
