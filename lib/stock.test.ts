// Run: node --experimental-strip-types --test lib/stock.test.ts
//
// A sale that moves stock without leaving a row is the gap this file exists to
// close: when the audit sheet says six bottles are missing, "what sold?" has to
// be answerable from the ledger rather than by diffing two balances.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decrementStock, type StockMovement } from './stock.ts'

/** A tx that records what it was asked to do, so no database is needed. */
function fakeTx() {
    const calls = { updates: [] as unknown[][], rows: [] as Record<string, unknown>[] }
    return {
        calls,
        $executeRaw: async (_q: TemplateStringsArray, ...v: unknown[]) => {
            calls.updates.push(v)
            return 1
        },
        stockTransaction: {
            create: async ({ data }: { data: Record<string, unknown> }) => {
                calls.rows.push(data)
                return data
            },
        },
    }
}

const SALE: StockMovement = { type: 'SALE', userId: 'u1', notes: 'order-1', reason: 'menu-1' }

test('a movement writes exactly one ledger row', async () => {
    const tx = fakeTx()
    await decrementStock(tx, 'i-heineken', 5, SALE)
    assert.equal(tx.calls.rows.length, 1)
    assert.equal(tx.calls.updates.length, 1)
})

test('the row carries who, why and against what', async () => {
    const tx = fakeTx()
    await decrementStock(tx, 'i-heineken', 5, SALE)
    const row = tx.calls.rows[0]
    assert.equal(row.ingredientId, 'i-heineken')
    assert.equal(row.type, 'SALE')
    assert.equal(row.userId, 'u1')
    assert.equal(row.notes, 'order-1')
    assert.equal(row.reason, 'menu-1')
})

test('stock leaving the shop is recorded as leaving SUB', async () => {
    const tx = fakeTx()
    await decrementStock(tx, 'i-heineken', 5, SALE)
    const row = tx.calls.rows[0]
    assert.equal(row.quantity, 5, 'quantity is always positive; direction is in the store fields')
    assert.equal(row.fromStore, 'SUB')
    assert.equal(row.toStore, null)
})

test('stock coming back is recorded as arriving at SUB, still positive', async () => {
    const tx = fakeTx()
    await decrementStock(tx, 'i-heineken', -5, { type: 'SALE_VOID' })
    const row = tx.calls.rows[0]
    assert.equal(row.quantity, 5)
    assert.equal(row.fromStore, null)
    assert.equal(row.toStore, 'SUB')
})

test('a zero or non-finite movement touches nothing at all', async () => {
    const tx = fakeTx()
    await decrementStock(tx, 'i-heineken', 0, SALE)
    await decrementStock(tx, 'i-heineken', Number.NaN, SALE)
    assert.equal(tx.calls.updates.length, 0)
    assert.equal(tx.calls.rows.length, 0, 'a no-op must not leave a row claiming something happened')
})
