// Run: node --experimental-strip-types --test lib/area-stats.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { areaStats } from './reporting.ts'

const H = 60 * 60 * 1000
const at = (h: number) => new Date(Date.UTC(2026, 9, 20, 12) + h * H)
const bill = (area: string | null, table: { id: string; name: string; seats: number } | null, total: number, hours: number) => ({
    openedAt: at(0),
    closedAt: at(hours),
    discountType: null,
    discountValue: null,
    promoDiscount: null,
    table: table && { ...table, area: area ?? 'INDOOR' },
    orders: [{ status: 'COMPLETED', total }],
})

const VIP1 = { id: 'v1', name: 'VIP 1', seats: 8 }
const T1 = { id: 't1', name: 'T1', seats: 2 }
const T2 = { id: 't2', name: 'T2', seats: 4 }

test('areas carry their tables, and an area is the sum of them', () => {
    const [indoor] = areaStats([bill('INDOOR', T1, 1000, 1), bill('INDOOR', T2, 3000, 2), bill('INDOOR', T1, 500, 1)])
    assert.equal(indoor.area, 'INDOOR')
    assert.equal(indoor.revenue, 4500)
    assert.equal(indoor.bills, 3)
    assert.deepEqual(indoor.tables.map((t) => [t.name, t.revenue, t.bills]), [['T2', 3000, 1], ['T1', 1500, 2]])
    assert.equal(indoor.tables.reduce((s, t) => s + t.revenue, 0), indoor.revenue)
})

test('per seat-hour puts a small table and a big room on the same footing', () => {
    // VIP: 8,000 over 2h at 8 seats = 500 a seat-hour. T1: 2,000 over 2h at 2 seats = 500.
    const stats = areaStats([bill('VIP', VIP1, 8000, 2), bill('INDOOR', T1, 2000, 2)])
    const vip = stats.find((a) => a.area === 'VIP')!.tables[0]
    const t1 = stats.find((a) => a.area === 'INDOOR')!.tables[0]
    assert.equal(vip.revenuePerSeatHour, 500)
    assert.equal(t1.revenuePerSeatHour, 500)
    assert.equal(vip.revenuePerHour, 4000)
    assert.equal(vip.avgMinutes, 120)
    assert.equal(vip.avgBill, 8000)
})

test('areas sort by revenue, highest first', () => {
    const stats = areaStats([bill('INDOOR', T1, 1000, 1), bill('VIP', VIP1, 9000, 3)])
    assert.deepEqual(stats.map((a) => a.area), ['VIP', 'INDOOR'])
})

test('a bill with no table still counts, under Unknown', () => {
    const [unknown] = areaStats([bill(null, null, 700, 1)])
    assert.equal(unknown.area, 'Unknown')
    assert.equal(unknown.revenue, 700)
    assert.equal(unknown.tables.length, 1)
    assert.equal(unknown.tables[0].revenuePerSeatHour, 0)
})

test('a clock that runs backwards between two tills adds no time', () => {
    const s = bill('INDOOR', T1, 1000, -1)
    const [indoor] = areaStats([s])
    assert.equal(indoor.avgMinutes, 0)
    assert.equal(indoor.revenuePerHour, 0)
    assert.equal(indoor.tables[0].revenuePerSeatHour, 0)
})
