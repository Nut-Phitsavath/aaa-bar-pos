// Run: node --experimental-strip-types --test lib/floor-order.test.ts
//
// The floor plan derives its COLUMNS from the order of this array, so the
// invariant under test is that reordering inside one area leaves every other
// area exactly where it was.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withAreaOrder, moveInArea, moveInList } from './floor-order.ts'

const tbl = (id: string, area: string, displayOrder: number) => ({ id, area, displayOrder })

/** Two areas, interleaved on purpose - that is how the API returns them. */
const floor = () => [
    tbl('in1', 'INDOOR', 0), tbl('in2', 'INDOOR', 1), tbl('in3', 'INDOOR', 2),
    tbl('out1', 'OUTDOOR', 0), tbl('out2', 'OUTDOOR', 1),
]

test('reordering one area renumbers only that area', () => {
    const next = [tbl('in3', 'INDOOR', 2), tbl('in1', 'INDOOR', 0), tbl('in2', 'INDOOR', 1)]
    const after = withAreaOrder(floor(), 'INDOOR', next)

    assert.deepEqual(
        after.filter((x) => x.area === 'INDOOR').map((x) => [x.id, x.displayOrder]),
        [['in3', 0], ['in1', 1], ['in2', 2]],
    )
    // Untouched, numbers and all.
    assert.deepEqual(
        after.filter((x) => x.area === 'OUTDOOR').map((x) => [x.id, x.displayOrder]),
        [['out1', 0], ['out2', 1]],
    )
})

test('the areas themselves keep their positions', () => {
    // The columns are derived from first appearance in this array. Rebuilding
    // it by concatenation would put INDOOR after OUTDOOR and the whole board
    // would jump sideways.
    const next = [tbl('in3', 'INDOOR', 2), tbl('in2', 'INDOOR', 1), tbl('in1', 'INDOOR', 0)]
    const after = withAreaOrder(floor(), 'INDOOR', next)
    assert.deepEqual([...new Set(after.map((x) => x.area))], ['INDOOR', 'OUTDOOR'])
    // And each slot still belongs to the area it did before.
    assert.deepEqual(after.map((x) => x.area), floor().map((x) => x.area))
})

test('moving a table down one place', () => {
    const after = moveInArea(floor(), 'INDOOR', 0, 1)
    assert.deepEqual(after.filter((x) => x.area === 'INDOOR').map((x) => x.id),
        ['in2', 'in1', 'in3'])
})

test('moving the last table to the top - the case that needed scrolling', () => {
    const after = moveInArea(floor(), 'INDOOR', 2, 0)
    assert.deepEqual(after.filter((x) => x.area === 'INDOOR').map((x) => x.id),
        ['in3', 'in1', 'in2'])
})

test('a move that goes nowhere changes nothing', () => {
    // An arrow key at the top of a list should do nothing, not re-save the
    // same order and flash a spinner.
    const start = floor()
    assert.deepEqual(moveInArea(start, 'INDOOR', 0, -1), start)
    assert.deepEqual(moveInArea(start, 'INDOOR', 2, 3), start)
    assert.deepEqual(moveInArea(start, 'INDOOR', 1, 1), start)
})

test('an area of one cannot be reordered into anything', () => {
    const one = [tbl('solo', 'VIP', 0), tbl('in1', 'INDOOR', 0)]
    assert.deepEqual(moveInArea(one, 'VIP', 0, 1), one)
})

test('an unknown area leaves the floor alone', () => {
    const start = floor()
    assert.deepEqual(moveInArea(start, 'NOWHERE', 0, 1), start)
})

// --- moveInList: the menu's flat lists --------------------------------------

test('moveInList moves an item and leaves the rest in order', () => {
    assert.deepEqual(moveInList(['a', 'b', 'c', 'd'], 3, 0), ['d', 'a', 'b', 'c'])
    assert.deepEqual(moveInList(['a', 'b', 'c', 'd'], 0, 3), ['b', 'c', 'd', 'a'])
    assert.deepEqual(moveInList(['a', 'b', 'c'], 0, 1), ['b', 'a', 'c'])
})

test('moveInList returns the SAME array when the move goes nowhere', () => {
    // Identity is the signal callers use to skip a save, so this must not be a
    // fresh array that merely happens to be equal.
    const list = ['a', 'b', 'c']
    assert.equal(moveInList(list, 0, 0), list)
    assert.equal(moveInList(list, 0, -1), list)
    assert.equal(moveInList(list, 2, 3), list)
    assert.equal(moveInList(list, -1, 1), list)
    assert.equal(moveInList(list, 9, 1), list)
})

test('moveInList on a single-item list does nothing', () => {
    const one = ['only']
    assert.equal(moveInList(one, 0, 0), one)
})
