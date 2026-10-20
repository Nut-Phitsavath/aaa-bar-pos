// Run: node --experimental-strip-types --test lib/bank-qr.test.ts
//
// Which QR, if any, a bill carries. Settings -> "QR on bills" picks Off, the
// bar's static bank QR, or OnePay's dynamic one; the slip follows it. A static
// QR carries no amount, so the slip says exactly what to type - in kip,
// because a LAO QR pays into a kip account.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { billQrFor, billQrMode } from './bank-qr.ts'

const QR = 'data:image/jpeg;base64,AAAA'
const owed = { balance: 165, fxRateLAK: 690, qrCodeData: null, closedAt: null }
const bank = { mode: 'BANK', fallback: true, bankQrUrl: QR } as const
const onepay = { mode: 'ONEPAY', fallback: true, bankQrUrl: QR } as const

// --- The setting -------------------------------------------------------------

test('until someone chooses, a bar with a bank QR uploaded prints it, and one without prints none', () => {
    assert.equal(billQrMode(undefined, true), 'BANK')
    assert.equal(billQrMode(undefined, false), 'OFF')
    assert.equal(billQrMode('', true), 'BANK')
})

test('a choice once made is kept', () => {
    assert.equal(billQrMode('OFF', true), 'OFF')
    assert.equal(billQrMode('ONEPAY', false), 'ONEPAY')
    // Anything unknown is treated as no choice.
    assert.equal(billQrMode('PROMPTPAY', true), 'BANK')
})

// --- Bank QR -------------------------------------------------------------------

test('an unpaid bill prints the bank QR with the kip to transfer', () => {
    assert.deepEqual(billQrFor(owed, bank), { kind: 'BANK', src: QR, thb: 165, lak: 113850 })
})

test('a part-paid bill asks only for what is still owed', () => {
    assert.deepEqual(billQrFor({ ...owed, balance: 40 }, bank), { kind: 'BANK', src: QR, thb: 40, lak: 27600 })
})

test('with no rate to hand the slip asks in baht rather than guess the kip', () => {
    assert.deepEqual(billQrFor({ ...owed, fxRateLAK: null }, bank), { kind: 'BANK', src: QR, thb: 165, lak: null })
})

test('nothing owed, nothing to scan', () => {
    assert.equal(billQrFor({ ...owed, balance: 0 }, bank), null)
    // A counter sale has no balance at all: it was paid at the till.
    assert.equal(billQrFor({ ...owed, balance: undefined }, bank), null)
})

test('a tab slip carries no QR, so a tab is always settled at the till against its customer', () => {
    // Closed with money still owed is a tab (or a discrepancy): not a bill to scan.
    assert.equal(billQrFor({ ...owed, closedAt: '18/09/2026 17:07' }, bank), null)
})

test('bank QR mode with no QR uploaded prints none', () => {
    assert.equal(billQrFor(owed, { ...bank, bankQrUrl: '' }), null)
})

// --- Off -----------------------------------------------------------------------

test('off means off, even with a QR uploaded or one already made', () => {
    assert.equal(billQrFor(owed, { ...bank, mode: 'OFF' }), null)
    assert.equal(billQrFor({ ...owed, qrCodeData: '000201...' }, { ...bank, mode: 'OFF' }), null)
})

// --- OnePay --------------------------------------------------------------------

test('OnePay prints the QR it made, which carries its own amount', () => {
    assert.deepEqual(billQrFor({ ...owed, qrCodeData: '000201...' }, onepay), { kind: 'ONEPAY', payload: '000201...', thb: 165 })
})

test('when OnePay could not make one, the bank QR stands in - if the owner allowed it', () => {
    assert.deepEqual(billQrFor(owed, onepay), { kind: 'BANK', src: QR, thb: 165, lak: 113850 })
    assert.equal(billQrFor(owed, { ...onepay, fallback: false }), null)
})
