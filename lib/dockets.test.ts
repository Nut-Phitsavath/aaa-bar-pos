// Run: node --experimental-strip-types --test lib/dockets.test.ts
//
// The printer is not here, so this is where the docket gets checked: that food
// and drink separate, that a station with nothing to make gets no paper, and
// that a preparation note survives onto the page a cook actually reads.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitByStation, renderDocket, escposDocket, DOCKET_WIDTH } from './dockets.ts'

const AT = new Date('2026-09-19T22:31:00')

const ROUND = [
    { name: 'Fried Chicken', quantity: 1, station: 'KITCHEN' },
    { name: 'Mojito', quantity: 2, station: 'BAR', note: 'Extra Mint & Less Ice' },
    { name: 'Beer Lao', quantity: 4, station: 'BAR' },
]

test('food goes to the kitchen and drinks to the bar', () => {
    const groups = splitByStation(ROUND)
    assert.deepEqual(groups.map((g) => g.station), ['BAR', 'KITCHEN'])
    assert.deepEqual(groups[0].items.map((i) => i.name), ['Mojito', 'Beer Lao'])
    assert.deepEqual(groups[1].items.map((i) => i.name), ['Fried Chicken'])
})

test('a station with nothing to make gets no paper', () => {
    // A blank docket every round is how staff learn to ignore the printer.
    const groups = splitByStation([{ name: 'Beer Lao', quantity: 2, station: 'BAR' }])
    assert.equal(groups.length, 1)
    assert.equal(groups[0].station, 'BAR')
})

test('a line with no station set prints at the bar', () => {
    // The column defaults to BAR, but a line from an older order or a category
    // someone typed by hand must still print somewhere rather than vanish.
    const groups = splitByStation([
        { name: 'Soda', quantity: 1 },
        { name: 'Tonic', quantity: 1, station: null },
        { name: 'Coke', quantity: 1, station: 'NONSENSE' },
    ])
    assert.equal(groups.length, 1)
    assert.equal(groups[0].items.length, 3)
})

test('the docket says station, table, round, waiter and time', () => {
    const text = renderDocket({
        station: 'KITCHEN', table: 'VIP-01', round: 2, waiter: 'Kham', at: AT,
        items: [{ name: 'Fried Chicken', quantity: 1 }],
    })
    const lines = text.split('\n')
    assert.match(lines[0], /KITCHEN/)
    assert.match(lines[1], /VIP-01 · #2/)
    assert.match(lines[2], /Kham · 22:31/)
    assert.match(text, /1x Fried Chicken/)
})

test('a preparation note reaches the person making it', () => {
    const text = renderDocket({
        station: 'BAR', table: 'T-04', round: 1, waiter: 'Nok', at: AT,
        items: [{ name: 'Mojito', quantity: 2, note: 'Extra Mint & Less Ice' }],
    })
    assert.match(text, /2x Mojito/)
    assert.match(text, /\*\* Extra Mint & Less Ice/)
})

test('nothing runs off the edge of the paper', () => {
    const text = renderDocket({
        station: 'BAR', table: 'T-04', round: 12, waiter: 'Nok', at: AT,
        items: [{ name: 'ວິສະກີ້ ໂຊວາ ຂວດໃຫຍ່ (Whisky Soda large bottle, no ice)', quantity: 3 }],
    })
    for (const line of text.split('\n')) {
        assert.ok(line.length <= DOCKET_WIDTH, `too wide: ${line}`)
    }
    // Wrapped, not truncated: the second half is still on the page.
    assert.match(text, /no ice/)
})

test('a walk-in round with no round number still prints', () => {
    const text = renderDocket({
        station: 'BAR', table: 'Counter', round: null, waiter: null, at: AT,
        items: [{ name: 'Beer Lao', quantity: 1 }],
    })
    assert.match(text.split('\n')[1], /Counter/)
    assert.doesNotMatch(text, /#/)
})

test('the bytes are ESC/POS: reset first, cut last', () => {
    const bytes = escposDocket(renderDocket({
        station: 'BAR', table: 'T-04', round: 1, waiter: 'Nok', at: AT,
        items: [{ name: 'Beer Lao', quantity: 2 }],
    }))
    assert.deepEqual([...bytes.subarray(0, 2)], [0x1b, 0x40])
    assert.deepEqual([...bytes.subarray(-4)], [0x1d, 0x56, 0x42, 0x00])
    assert.match(bytes.toString('utf8'), /2x Beer Lao/)
})
