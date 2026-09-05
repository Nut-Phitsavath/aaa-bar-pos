// Run: node --experimental-strip-types --test lib/cart-storage.test.ts
//
// Unsent lines belong to the ticket being keyed, not to the till. One shared
// key meant a drink rung up at the counter appeared on the next table opened -
// one tap from Send, which charges it to the wrong customer and moves the stock
// to match.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cartKey, COUNTER_CART_KEY, isCartKey } from './cart-storage.ts'

test('the counter keeps the original key', () => {
    // Unchanged on purpose: whatever a staff member had half-keyed at the
    // counter when this shipped is still theirs, rather than vanishing.
    assert.equal(cartKey(null), COUNTER_CART_KEY)
    assert.equal(cartKey(undefined), COUNTER_CART_KEY)
    assert.equal(cartKey(''), COUNTER_CART_KEY)
})

test('a table gets a key of its own', () => {
    assert.equal(cartKey('abc-123'), 'pos_cart:abc-123')
})

test('two tables never share a key', () => {
    assert.notEqual(cartKey('table-a'), cartKey('table-b'))
})

test('a table never shares the counter key', () => {
    // The whole bug in one assertion.
    assert.notEqual(cartKey('any-session'), COUNTER_CART_KEY)
})

test('cart keys are recognisable, so they can be swept up', () => {
    assert.equal(isCartKey(COUNTER_CART_KEY), true)
    assert.equal(isCartKey('pos_cart:abc'), true)
    assert.equal(isCartKey('pos_customer'), false)
    assert.equal(isCartKey('pos_table'), false)
    assert.equal(isCartKey(''), false)
})
