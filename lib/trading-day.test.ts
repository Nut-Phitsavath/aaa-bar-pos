// Run: node --experimental-strip-types --test lib/trading-day.test.ts
//
// A bar's day is not a calendar day. These cover the boundary that a cafe never
// has to think about: the hours after midnight, which are the busiest hours
// here and belong to the night before.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { barHour, tradingDay, tradingHours, TRADING_DAY_START_HOUR } from './trading-day.ts'

// Laos is UTC+7 and has never observed daylight saving, so these instants mean
// exactly one wall-clock time at the bar, in every month of the year.
const utc = (iso: string) => new Date(iso)

test('an hour is read at the bar, not on the server', () => {
    // 16:00 UTC is 23:00 in Vientiane - the busiest hour of this bar's night.
    // Read on a server running UTC it would say 16:00, which is the afternoon.
    assert.equal(barHour(utc('2026-09-11T16:00:00Z')), 23)
    assert.equal(barHour(utc('2026-09-11T18:00:00Z')), 1)
})

test('a sale after midnight belongs to the night it started', () => {
    // Friday night, 01:00 on Saturday morning by the calendar. Anyone working
    // that shift calls it Friday, and the takings belong with Friday's.
    assert.equal(tradingDay(utc('2026-09-11T18:00:00Z')), '2026-09-11')
    // 03:00 Saturday, still Friday's night.
    assert.equal(tradingDay(utc('2026-09-11T20:00:00Z')), '2026-09-11')
})

test('a sale after the boundary starts a new trading day', () => {
    // 07:00 Saturday at the bar. Past the boundary, so this is Saturday's.
    assert.equal(tradingDay(utc('2026-09-12T00:00:00Z')), '2026-09-12')
})

test('an evening sale is its own calendar day', () => {
    // 21:00 Friday - no ambiguity, and the common case must not be clever.
    assert.equal(tradingDay(utc('2026-09-11T14:00:00Z')), '2026-09-11')
})

test('the hour axis opens when the bar does, not at midnight', () => {
    const hours = tradingHours()
    assert.equal(hours.length, 24)
    assert.equal(hours[0], String(TRADING_DAY_START_HOUR).padStart(2, '0'))
    // The run through the night is unbroken: the busiest stretch of this bar,
    // 21:00 to 02:00, must be six adjacent positions rather than two clumps at
    // opposite ends of the chart.
    const run = ['21', '22', '23', '00', '01', '02'].map((h) => hours.indexOf(h))
    run.forEach((position, i) => {
        if (i === 0) return
        assert.equal(position, run[i - 1] + 1, `${hours[run[i]]} should follow ${hours[run[i - 1]]}`)
    })
})

test('every hour appears exactly once', () => {
    const hours = tradingHours()
    assert.equal(new Set(hours).size, 24)
})
