// Run: node --experimental-strip-types --test lib/units.test.ts
//
// The conversion table is the whole point of the base-unit work: get a
// multiplier wrong here and every stock figure and every pour cost downstream
// is wrong in a way nobody can see.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    BASE_UNIT, DECIMALS, LEGACY_UNITS, toBase, fromBase, roundFor, formatDual,
} from './units.ts'

test('base unit follows from measure type, it is never typed', () => {
    assert.equal(BASE_UNIT.WEIGHT, 'g')
    assert.equal(BASE_UNIT.VOLUME, 'ml')
    assert.equal(BASE_UNIT.EACH, 'each')
})

test('EACH is the type that keeps decimals, not the one that loses them', () => {
    // Easy to get backwards. Grams and millilitres are fine-grained enough to
    // always be whole; a quarter lime is the only fraction left after migration.
    assert.equal(DECIMALS.WEIGHT, 0)
    assert.equal(DECIMALS.VOLUME, 0)
    assert.equal(DECIMALS.EACH, 2)
})

test('a 30ml pour out of a 700ml bottle is 30, not 0.042857', () => {
    assert.equal(toBase(0.04285714285714286, 700), 30)
    assert.equal(toBase(0.06428571428571428, 700), 45)
})

test('legacy kg and litre convert by a thousand', () => {
    assert.equal(toBase(0.15, LEGACY_UNITS.kg.multiplier!), 150)
    assert.equal(toBase(0.02, LEGACY_UNITS.litre.multiplier!), 20)
    assert.equal(toBase(2, LEGACY_UNITS.kg.multiplier!), 2000)
})

test('a spirit bottle has no fixed multiplier - it is asked for per ingredient', () => {
    // 'bottle' means EACH for a beer and VOLUME for a spirit. The migration
    // resolves it per ingredient rather than from this table.
    assert.equal(LEGACY_UNITS.bottle.multiplier, null)
})

test('fromBase inverts toBase to within float tolerance', () => {
    // Deliberately not assert.equal on the raw division: 30/700 is a repeating
    // decimal and asserting an exact literal here would be testing the printer,
    // not the arithmetic. Round-tripping is the property that matters.
    assert.ok(Math.abs(fromBase(30, 700) - 30 / 700) < 1e-12)
    assert.equal(fromBase(toBase(0.25, 1000), 1000), 0.25)
    assert.ok(Math.abs(toBase(fromBase(45, 700), 700) - 45) < 1e-6)
})

test('rounding respects the measure type', () => {
    assert.equal(roundFor('VOLUME', 30.4), 30)
    assert.equal(roundFor('WEIGHT', 149.6), 150)
    assert.equal(roundFor('EACH', 0.25), 0.25, 'a quarter lime must survive')
    assert.equal(roundFor('EACH', 0.156), 0.16)
})

test('a part-used bottle reads as something a person can count', () => {
    const opts = { measureType: 'VOLUME' as const, purchaseUnit: 'bottle', multiplier: 700 }
    assert.equal(formatDual(2350, opts), '3 bottles + 250 ml')
    assert.equal(formatDual(2100, opts), '3 bottles')
    assert.equal(formatDual(250, opts), '250 ml')
    assert.equal(formatDual(0, opts), '0 ml')
})

test('whole-unit stock reads as a plain count', () => {
    const opts = { measureType: 'EACH' as const, purchaseUnit: 'bottle', multiplier: 1 }
    assert.equal(formatDual(47, opts), '47 bottles')
    assert.equal(formatDual(1, opts), '1 bottle')
})

test('negative stock still reads correctly rather than inverting', () => {
    // Stock below zero is a discrepancy the manager must see, so it has to
    // print as a number, not as nonsense from a floor() on a negative.
    const opts = { measureType: 'VOLUME' as const, purchaseUnit: 'bottle', multiplier: 700 }
    assert.equal(formatDual(-2350, opts), '-3 bottles + 250 ml')
})
