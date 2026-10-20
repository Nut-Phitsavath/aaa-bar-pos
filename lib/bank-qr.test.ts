// Run: node --experimental-strip-types --test lib/bank-qr.test.ts
//
// The bar's static bank QR (Settings -> Store Transfer QR) printed on a bill
// that is still owed. A static QR carries no amount: the customer types it, so
// the slip has to say exactly what to type - in kip, because a LAO QR pays
// into a kip account.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bankQrFor } from './bank-qr.ts'

const QR = 'data:image/jpeg;base64,AAAA'
const owed = { balance: 165, fxRateLAK: 690, qrCodeData: null }

test('an unpaid bill prints the bank QR with the kip to transfer', () => {
    assert.deepEqual(bankQrFor(owed, QR), { src: QR, thb: 165, lak: 113850 })
})

test('a part-paid bill asks only for what is still owed', () => {
    assert.deepEqual(bankQrFor({ ...owed, balance: 40 }, QR), { src: QR, thb: 40, lak: 27600 })
})

test('nothing owed, nothing to scan', () => {
    assert.equal(bankQrFor({ ...owed, balance: 0 }, QR), null)
    // A counter sale has no balance at all: it was paid at the till.
    assert.equal(bankQrFor({ balance: undefined, fxRateLAK: 690, qrCodeData: null }, QR), null)
})

test('no QR uploaded, nothing printed', () => {
    assert.equal(bankQrFor(owed, ''), null)
    assert.equal(bankQrFor(owed, null), null)
})

test('a dynamic OnePay QR, which carries its own amount, wins over the static one', () => {
    assert.equal(bankQrFor({ ...owed, qrCodeData: '000201...' }, QR), null)
})

test('with no rate to hand the slip asks in baht rather than guess the kip', () => {
    assert.deepEqual(bankQrFor({ ...owed, fxRateLAK: null }, QR), { src: QR, thb: 165, lak: null })
})
