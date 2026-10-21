// Run: node --experimental-strip-types --test lib/z-report.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildZ } from './z-report.ts'

// One night's shift: 20 Oct 18:00 to 21 Oct 02:45, Vientiane time (UTC+7).
const at = (day: number, hh: number, mm = 0) => new Date(Date.UTC(2026, 9, day, hh - 7, mm))
const start = at(20, 18)
const end = at(21, 2, 45)

let n = 0
const bill = (o: { total: number; closedAt?: Date | null; paid?: { method: string; amount: number; at: Date; paymentStatus?: string; voidedAt?: Date | null }[]; customer?: string; voided?: number }) => ({
    id: `s${++n}`,
    closedAt: o.closedAt ?? null,
    customerId: o.customer ? 'c1' : null,
    discountType: null,
    discountValue: null,
    promoDiscount: null,
    table: { name: `T${n}` },
    customer: o.customer ? { name: o.customer } : null,
    orders: [{ status: 'COMPLETED', total: o.total, tax: Math.round(o.total / 11), items: o.voided ? [{ total: o.voided, voidedAt: at(20, 20) }] : [] }],
    payments: (o.paid ?? []).map((p) => ({ method: p.method, amount: p.amount, createdAt: p.at, paymentStatus: p.paymentStatus ?? null, voidedAt: p.voidedAt ?? null })),
})

const z = (sessions: ReturnType<typeof bill>[], walkIns: any[] = [], refunds: any[] = []) =>
    buildZ({ sessions, walkIns, refunds, start, end })

test('a bill paid after midnight belongs to the night it was served', () => {
    const late = bill({ total: 1200, closedAt: at(21, 1, 30), paid: [{ method: 'CASH', amount: 1200, at: at(21, 1, 30) }] })
    const r = z([late])
    assert.equal(r.net, 1200)
    assert.equal(r.received, 1200)
    assert.equal(r.cashTaken, 1200)
})

test('the books balance: net = received + comped + owed, nothing unreconciled', () => {
    const r = z([
        bill({ total: 1000, closedAt: at(20, 21), paid: [{ method: 'CASH', amount: 400, at: at(20, 21) }, { method: 'ONEPAY', amount: 600, at: at(20, 21), paymentStatus: 'PAID' }] }),
        bill({ total: 500, closedAt: at(20, 22), paid: [{ method: 'OWNER_VIP', amount: 500, at: at(20, 22) }] }),
        bill({ total: 800, closedAt: at(20, 23), customer: 'Somchai', paid: [{ method: 'TRANSFER', amount: 300, at: at(20, 23) }] }),
    ])
    assert.equal(r.net, 2300)
    assert.equal(r.received, 1300)
    assert.equal(r.comped, 500)
    assert.equal(r.owed, 500)
    assert.equal(r.unreconciled, 0)
    assert.deepEqual(r.tabs.map((t) => [t.customer, t.amount]), [['Somchai', 500]])
    assert.deepEqual(r.byMethod.CASH, { amount: 400, count: 1 })
    assert.equal(r.tickets, 3)
})

test('money taken on a table still open is in the drawer but not a sale yet', () => {
    const open = bill({ total: 900, closedAt: null, paid: [{ method: 'CASH', amount: 300, at: at(20, 23) }] })
    const r = z([open])
    assert.equal(r.net, 0)
    assert.equal(r.onOpenBills, 300)
    assert.equal(r.cashTaken, 300)
    assert.equal(r.unreconciled, 0)
})

test('a QR that never confirmed and a refunded tender are not counted', () => {
    const r = z([bill({
        total: 700, closedAt: at(20, 22), paid: [
            { method: 'ONEPAY', amount: 700, at: at(20, 22), paymentStatus: 'PENDING' },
            { method: 'CASH', amount: 700, at: at(20, 22), voidedAt: at(20, 23) },
            { method: 'CASH', amount: 700, at: at(20, 22) },
        ],
    })])
    assert.equal(r.received, 700)
    assert.equal(r.cashTaken, 700)
})

test('a payment from before the shift opened is left to the shift it was taken in', () => {
    const tab = bill({ total: 600, closedAt: at(20, 19), customer: 'Noy', paid: [{ method: 'CASH', amount: 200, at: at(19, 22) }, { method: 'CASH', amount: 400, at: at(20, 19) }] })
    const r = z([tab])
    assert.equal(r.cashTaken, 400)
    assert.equal(r.received, 400)
})

test('counter sales count, as cash when paid in bank notes; voids and refunds are listed', () => {
    const r = z(
        [bill({ total: 300, closedAt: at(20, 20), voided: 150, paid: [{ method: 'CASH', amount: 300, at: at(20, 20) }] })],
        [{ total: 250, tax: 23, paymentMethod: 'BANK_NOTE', items: [] }],
        [{ amount: 120 }, { amount: 80 }],
    )
    assert.equal(r.gross, 550)
    assert.equal(r.byMethod.CASH.amount, 550)
    assert.equal(r.cashTaken, 550)
    assert.deepEqual(r.voids, { count: 1, value: 150 })
    assert.deepEqual(r.refunds, { count: 2, value: 200 })
})
