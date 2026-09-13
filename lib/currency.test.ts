// Run: node --experimental-strip-types --test lib/currency.test.ts
//
// THB is the till's currency; LAK and USD are display conversions. These cover
// the cases where the screen, the bill and the stored order would disagree.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    formatTHB, formatLAK, formatUSD,
    thbToLak, thbToUsd,
    calculateChange, calculateInclusiveTax,
    DEFAULT_RATE_LAK, DEFAULT_RATE_USD,
    billRates,
} from './currency.ts'

test('formatTHB groups thousands and shows no decimals', () => {
    // Bar prices are whole baht. Satang on a bill is noise.
    assert.equal(formatTHB(4120), '฿4,120')
    assert.equal(formatTHB(0), '฿0')
    assert.equal(formatTHB(120), '฿120')
})

test('formatTHB rounds rather than printing a fraction', () => {
    assert.equal(formatTHB(2499.5), '฿2,500')
})

test('formatLAK keeps the kip suffix the tills already show', () => {
    assert.equal(formatLAK(2801600), '2,801,600 ₭')
})

test('formatUSD shows two decimals', () => {
    assert.equal(formatUSD(128.75), '$128.75')
    assert.equal(formatUSD(5), '$5.00')
})

test('formatters never emit NaN onto a bill', () => {
    assert.equal(formatTHB(NaN), '฿0')
    assert.equal(formatLAK(undefined as unknown as number), '0 ₭')
    assert.equal(formatUSD(NaN), '$0.00')
})

test('thbToLak multiplies by the configured rate', () => {
    // Rate is configured the way a person says it: 1 THB = 680 LAK.
    assert.equal(thbToLak(4120, 680), 2801600)
})

test('thbToLak rounds to whole kip', () => {
    // There is no sub-kip note; a bill must never show a fraction of one.
    assert.equal(thbToLak(1.5, 681), 1022)
})

test('thbToUsd divides by baht-per-dollar', () => {
    // Configured as "1 USD = 32 THB", which is how a rate board reads.
    assert.equal(thbToUsd(3200, 32), 100)
})

test('thbToUsd keeps two decimals', () => {
    assert.equal(thbToUsd(100, 32), 3.13)
})

test('conversion at a zero or missing rate yields zero, never Infinity', () => {
    // A rate left unset in settings must not print "$Infinity" on a bill.
    assert.equal(thbToLak(100, 0), 0)
    assert.equal(thbToUsd(100, 0), 0)
})

test('conversion is pure: the same rate always gives the same figure', () => {
    // This is what makes requirement #18 work. A closed bill stores its rate
    // and re-renders identically no matter what settings say later.
    const atClose = thbToLak(4120, 680)
    const rateChangedInSettings = 700
    assert.equal(thbToLak(4120, 680), atClose)
    assert.notEqual(thbToLak(4120, rateChangedInSettings), atClose)
})

test('change is broken into real baht denominations', () => {
    const { totalChange, denominations } = calculateChange(880, 1000)
    assert.equal(totalChange, 120)
    assert.deepEqual(denominations, [
        { denom: 100, count: 1 },
        { denom: 20, count: 1 },
    ])
})

test('change short of the total is reported negative, not broken up', () => {
    const { totalChange, denominations } = calculateChange(1000, 800)
    assert.equal(totalChange, -200)
    assert.deepEqual(denominations, [])
})

test('inclusive tax is unchanged by the currency switch', () => {
    assert.equal(calculateInclusiveTax(110, 10), 10)
    assert.equal(calculateInclusiveTax(100, 0), 0)
})

test('shipped defaults are sane', () => {
    // Market was ~680 LAK/THB and ~32 THB/USD when this was written; the owner
    // sets the real counter rate in settings.
    assert.ok(DEFAULT_RATE_LAK > 100 && DEFAULT_RATE_LAK < 2000)
    assert.ok(DEFAULT_RATE_USD > 10 && DEFAULT_RATE_USD < 100)
})

// Requirement #18, generalised: a rate is a per-transaction fact. FX and VAT
// are both stamped at close, and these tests are the only thing standing
// between a settings edit and what last night's bills say they charged.

test('a closed bill keeps the rates it was settled at', () => {
    // Owner moves the counter rate and registers for VAT this morning. The bill
    // closed last night was charged at 690 and 7%, and stays that way.
    const bill = { status: 'CLOSED', fxRateLAK: 690, fxRateUSD: 33, taxRate: 7 }
    assert.deepEqual(
        billRates(bill, { lak: 720, usd: 35, tax: 10 }),
        { lak: 690, usd: 33, tax: 7 }
    )
})

test('an open bill quotes the current rates', () => {
    // Nothing stamped yet - a table still drinking is quoted at today's rates.
    const bill = { status: 'OPEN', fxRateLAK: null, fxRateUSD: null, taxRate: null }
    assert.deepEqual(
        billRates(bill, { lak: 720, usd: 35, tax: 10 }),
        { lak: 720, usd: 35, tax: 10 }
    )
})

test('a bill closed before rates were stamped shows no conversion and no VAT', () => {
    // Bills that predate the columns have no rate to show. Null prints no LAK
    // line and no VAT line, which is honest; today's rates would be a lie about
    // what that customer was charged.
    const bill = { status: 'CLOSED', fxRateLAK: null, fxRateUSD: null, taxRate: null }
    assert.deepEqual(
        billRates(bill, { lak: 720, usd: 35, tax: 10 }),
        { lak: null, usd: null, tax: null }
    )
})

test('a zero VAT rate stamped at close survives a later registration', () => {
    // 0 is a real answer, not a missing one: a bar not registered for VAT
    // charged no VAT, and `?? live` would quietly backfill today's 10%.
    const bill = { status: 'CLOSED', fxRateLAK: 690, fxRateUSD: 33, taxRate: 0 }
    assert.equal(billRates(bill, { lak: 720, usd: 35, tax: 10 }).tax, 0)
})
