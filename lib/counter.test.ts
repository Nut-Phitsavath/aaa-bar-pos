import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isCounter, isWalkIn } from './counter.ts'

test('only the COUNTER area is the counter', () => {
    assert.equal(isCounter('COUNTER'), true)
    assert.equal(isCounter('INDOOR'), false)
    assert.equal(isCounter(null), false)
})

test('a bill on the counter is a walk-in sale, not table service', () => {
    assert.equal(isWalkIn({ sessionId: 's1', session: { table: { area: 'COUNTER' } } }), true)
})

test('an old walk-in with no bill at all is still a walk-in', () => {
    assert.equal(isWalkIn({ sessionId: null }), true)
})

test('a round on a table is table service', () => {
    assert.equal(isWalkIn({ sessionId: 's2', session: { table: { area: 'VIP' } } }), false)
})
