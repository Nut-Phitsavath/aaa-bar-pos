// Run: node --experimental-strip-types --test lib/currency.test.ts
//
// Baht is the only money; USD is an optional display conversion. These cover
// the cases where the screen, the bill and the stored order would disagree.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    formatTHB, formatUSD,
    thbToUsd,
    calculateChange, calculateInclusiveTax,
    DEFAULT_RATE_USD,
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

test('formatUSD shows two decimals', () => {
    assert.equal(formatUSD(128.75), '$128.75')
    assert.equal(formatUSD(5), '$5.00')
})

test('formatters never emit NaN onto a bill', () => {
    assert.equal(formatTHB(NaN), '฿0')
    assert.equal(formatTHB(undefined as unknown as number), '฿0')
    assert.equal(formatUSD(NaN), '$0.00')
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
    assert.equal(thbToUsd(100, 0), 0)
})

test('conversion is pure: the same rate always gives the same figure', () => {
    // This is what makes requirement #18 work. A closed bill stores its rate
    // and re-renders identically no matter what settings say later.
    const atClose = thbToUsd(4120, 32)
    const rateChangedInSettings = 35
    assert.equal(thbToUsd(4120, 32), atClose)
    assert.notEqual(thbToUsd(4120, rateChangedInSettings), atClose)
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
    // Market was ~32 THB/USD when this was written; the owner sets the real
    // rate in settings.
    assert.ok(DEFAULT_RATE_USD > 10 && DEFAULT_RATE_USD < 100)
})

// Requirement #18, generalised: a rate is a per-transaction fact. FX and VAT
// are both stamped at close, and these tests are the only thing standing
// between a settings edit and what last night's bills say they charged.

test('a closed bill keeps the rates it was settled at', () => {
    // Owner moves the USD rate and registers for VAT this morning. The bill
    // closed last night was charged at 33 and 7%, and stays that way.
    const bill = { status: 'CLOSED', fxRateUSD: 33, taxRate: 7 }
    assert.deepEqual(
        billRates(bill, { usd: 35, tax: 10 }),
        { usd: 33, tax: 7 }
    )
})

test('an open bill quotes the current rates', () => {
    // Nothing stamped yet - a table still drinking is quoted at today's rates.
    const bill = { status: 'OPEN', fxRateUSD: null, taxRate: null }
    assert.deepEqual(
        billRates(bill, { usd: 35, tax: 10 }),
        { usd: 35, tax: 10 }
    )
})

test('a bill closed before rates were stamped shows no conversion and no VAT', () => {
    // Bills that predate the columns have no rate to show. Null prints no USD
    // line and no VAT line, which is honest; today's rates would be a lie about
    // what that customer was charged.
    const bill = { status: 'CLOSED', fxRateUSD: null, taxRate: null }
    assert.deepEqual(
        billRates(bill, { usd: 35, tax: 10 }),
        { usd: null, tax: null }
    )
})

test('a zero VAT rate stamped at close survives a later registration', () => {
    // 0 is a real answer, not a missing one: a bar not registered for VAT
    // charged no VAT, and `?? live` would quietly backfill today's 10%.
    const bill = { status: 'CLOSED', fxRateUSD: 33, taxRate: 0 }
    assert.equal(billRates(bill, { usd: 35, tax: 10 }).tax, 0)
})
