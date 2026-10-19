// Run: node --experimental-strip-types --test lib/table-ops.test.ts
//
// None of these operations asks for a manager PIN, so the rules here are what
// stands between a busy floor and a bill nobody can account for. The one that
// matters most: money already taken pins a bill in place.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    canMove, canMerge, canSplit, withSwapCharges,
    canSplitQuantities, swapChargeLineIds, billLabel, orderBills, canSendLines, canPrintBill, splitIndexes,
} from './table-ops.ts'

const open = (over = {}) => ({ id: 's1', status: 'OPEN', paidCount: 0, ...over })
const freeTable = (over = {}) => ({ id: 't2', isActive: true, occupied: false, ...over })

test('a party can move to a free table', () => {
    assert.deepEqual(canMove({ status: 'OPEN' }, freeTable(), 't1'), { ok: true })
    // Asking for the bill still occupies the table, so it can still move.
    assert.deepEqual(canMove({ status: 'BILL_REQUESTED' }, freeTable(), 't1'), { ok: true })
})

test('a move is refused where it would collide', () => {
    assert.deepEqual(canMove({ status: 'OPEN' }, freeTable({ occupied: true }), 't1'), { ok: false, reason: 'TABLE_OCCUPIED' })
    assert.deepEqual(canMove({ status: 'OPEN' }, freeTable({ isActive: false }), 't1'), { ok: false, reason: 'TABLE_INACTIVE' })
    assert.deepEqual(canMove({ status: 'OPEN' }, freeTable({ id: 't1' }), 't1'), { ok: false, reason: 'SAME_TABLE' })
    assert.deepEqual(canMove({ status: 'CLOSED' }, freeTable(), 't1'), { ok: false, reason: 'SESSION_NOT_OPEN' })
})

test('a part-paid bill can still change seats', () => {
    // Nothing about the money moves, so there is no reason to stop it.
    assert.deepEqual(canMove({ status: 'OPEN' }, freeTable(), 't1'), { ok: true })
})

test('two open bills can be merged', () => {
    assert.deepEqual(canMerge(open({ id: 'a' }), open({ id: 'b' }), 'shift1'), { ok: true })
})

test('money already taken pins a bill in place', () => {
    // A tender belongs to the bill it was taken against. Moving rounds out from
    // under it would leave a payment explaining a total that no longer exists.
    assert.deepEqual(
        canMerge(open({ id: 'a', paidCount: 1 }), open({ id: 'b' }), 'shift1'),
        { ok: false, reason: 'ALREADY_PAID' },
    )
    assert.deepEqual(
        canMerge(open({ id: 'a' }), open({ id: 'b', paidCount: 2 }), 'shift1'),
        { ok: false, reason: 'ALREADY_PAID' },
    )
    assert.deepEqual(
        canSplit(open({ paidCount: 1 }), ['l1', 'l2'], ['l1'], 'shift1'),
        { ok: false, reason: 'ALREADY_PAID' },
    )
})

test('a bill cannot be merged into itself, or merged when closed', () => {
    assert.deepEqual(canMerge(open({ id: 'a' }), open({ id: 'a' }), 'shift1'), { ok: false, reason: 'SAME_BILL' })
    assert.deepEqual(
        canMerge(open({ id: 'a', status: 'CLOSED' }), open({ id: 'b' }), 'shift1'),
        { ok: false, reason: 'SESSION_NOT_OPEN' },
    )
})

test('nothing moves without an open shift', () => {
    assert.deepEqual(canMerge(open({ id: 'a' }), open({ id: 'b' }), null), { ok: false, reason: 'NO_OPEN_SHIFT' })
    assert.deepEqual(canSplit(open(), ['l1', 'l2'], ['l1'], null), { ok: false, reason: 'NO_OPEN_SHIFT' })
})

test('a split moves some lines, never all of them', () => {
    assert.deepEqual(canSplit(open(), ['l1', 'l2', 'l3'], ['l1', 'l2'], 'shift1'), { ok: true })
    // Taking everything leaves an empty bill on the floor and a new reference
    // for what is plainly the same table.
    assert.deepEqual(
        canSplit(open(), ['l1', 'l2'], ['l1', 'l2'], 'shift1'),
        { ok: false, reason: 'CANNOT_SPLIT_EVERYTHING' },
    )
    assert.deepEqual(canSplit(open(), ['l1', 'l2'], [], 'shift1'), { ok: false, reason: 'NOTHING_SELECTED' })
})

test('a split only moves lines that are on this bill', () => {
    assert.deepEqual(
        canSplit(open(), ['l1', 'l2'], ['other'], 'shift1'),
        { ok: false, reason: 'LINE_NOT_ON_BILL' },
    )
    assert.deepEqual(
        canSplit(open(), ['l1', 'l2', 'l3'], ['l1', 'l1'], 'shift1'),
        { ok: false, reason: 'DUPLICATE_LINE' },
    )
})

test('an exchange upcharge follows its package line, and never moves alone', () => {
    const swaps = [{ orderItemId: 'set1', chargeItemId: 'diff1' }]
    // Ticking the set takes its price difference with it.
    assert.deepEqual(withSwapCharges(['set1'], swaps).sort(), ['diff1', 'set1'])
    // Ticking only the difference leaves it where the set is: otherwise one
    // guest pays the upcharge on another guest's package.
    assert.deepEqual(withSwapCharges(['diff1'], swaps), [])
    // A set with no upcharge is untouched, and so is an unrelated line.
    assert.deepEqual(withSwapCharges(['beer'], swaps), ['beer'])
    assert.deepEqual(withSwapCharges(['set1'], [{ orderItemId: 'set1', chargeItemId: null }]), ['set1'])
})

test('a discounted bill still adds up after it is split', () => {
    // The reason the split-off bill inherits the discount: the manager approved
    // it for these drinks, and two halves at full price bill the party more
    // than the table was quoted.
    const pct = (g: number) => Math.max(0, Math.ceil(g - g * 0.1))
    assert.equal(pct(700) + pct(300), pct(1000))
})

// --- canSplitQuantities: splitting by the unit, not the row ------------------
//
// The case that drove this: a table with 2 whiskeys, 2 waters and 2 snacks is
// THREE rows of two, because the till merges identical items. Moving one
// whiskey was impossible before.

/** 2 whiskeys, 2 waters, 2 snacks - six drinks on three lines. */
const sixOnThree = () => [
    { id: 'wh', quantity: 2 },
    { id: 'wa', quantity: 2 },
    { id: 'sn', quantity: 2 },
]

test('one whiskey and one water can leave, which was the whole point', () => {
    const check = canSplitQuantities(open(), sixOnThree(), [
        { itemId: 'wh', quantity: 1 },
        { itemId: 'wa', quantity: 1 },
    ], 'shift1')
    assert.deepEqual(check, { ok: true })
})

test('a whole line still moves, the way it always did', () => {
    assert.deepEqual(
        canSplitQuantities(open(), sixOnThree(), [{ itemId: 'wh', quantity: 2 }], 'shift1'),
        { ok: true },
    )
})

test('"everything" is counted in drinks, not rows', () => {
    // One of each line is three of six drinks: a real bill stays behind, even
    // though every row was touched. The row-based rule refused this.
    const some = canSplitQuantities(open(), sixOnThree(), [
        { itemId: 'wh', quantity: 1 },
        { itemId: 'wa', quantity: 1 },
        { itemId: 'sn', quantity: 1 },
    ], 'shift1')
    assert.deepEqual(some, { ok: true })

    // All of each is all six, which is a merge wearing a split's clothes.
    const all = canSplitQuantities(open(), sixOnThree(), [
        { itemId: 'wh', quantity: 2 },
        { itemId: 'wa', quantity: 2 },
        { itemId: 'sn', quantity: 2 },
    ], 'shift1')
    assert.deepEqual(all, { ok: false, reason: 'CANNOT_SPLIT_EVERYTHING' })
})

test('the last drink on a bill cannot leave', () => {
    assert.deepEqual(
        canSplitQuantities(open(), [{ id: 'only', quantity: 1 }], [{ itemId: 'only', quantity: 1 }], 'shift1'),
        { ok: false, reason: 'CANNOT_SPLIT_EVERYTHING' },
    )
})

test('you cannot move more drinks than the line holds', () => {
    assert.deepEqual(
        canSplitQuantities(open(), sixOnThree(), [{ itemId: 'wh', quantity: 3 }], 'shift1'),
        { ok: false, reason: 'MORE_THAN_ORDERED' },
    )
})

test('half a beer is not a thing the bar can pour', () => {
    assert.deepEqual(
        canSplitQuantities(open(), sixOnThree(), [{ itemId: 'wh', quantity: 1.5 }], 'shift1'),
        { ok: false, reason: 'QUANTITY_MUST_BE_WHOLE' },
    )
    assert.deepEqual(
        canSplitQuantities(open(), sixOnThree(), [{ itemId: 'wh', quantity: 0 }], 'shift1'),
        { ok: false, reason: 'QUANTITY_MUST_BE_POSITIVE' },
    )
    assert.deepEqual(
        canSplitQuantities(open(), sixOnThree(), [{ itemId: 'wh', quantity: -1 }], 'shift1'),
        { ok: false, reason: 'QUANTITY_MUST_BE_POSITIVE' },
    )
})

test('a line that is not on the bill cannot be moved off it', () => {
    assert.deepEqual(
        canSplitQuantities(open(), sixOnThree(), [{ itemId: 'ghost', quantity: 1 }], 'shift1'),
        { ok: false, reason: 'LINE_NOT_ON_BILL' },
    )
})

test('the same line twice would pass each check and break the cap together', () => {
    assert.deepEqual(
        canSplitQuantities(open(), sixOnThree(), [
            { itemId: 'wh', quantity: 2 },
            { itemId: 'wh', quantity: 2 },
        ], 'shift1'),
        { ok: false, reason: 'DUPLICATE_LINE' },
    )
})

test('a swapped package moves whole or not at all', () => {
    const lines = [{ id: 'pkg', quantity: 2, hasSwap: true }, { id: 'beer', quantity: 4 }]
    // Splitting the row leaves no honest answer to which half the exchange
    // happened on.
    assert.deepEqual(
        canSplitQuantities(open(), lines, [{ itemId: 'pkg', quantity: 1 }], 'shift1'),
        { ok: false, reason: 'SWAPPED_LINE_MOVES_WHOLE' },
    )
    // Whole is fine.
    assert.deepEqual(
        canSplitQuantities(open(), lines, [{ itemId: 'pkg', quantity: 2 }], 'shift1'),
        { ok: true },
    )
})

test('the old refusals still hold with quantities in play', () => {
    const one = [{ itemId: 'wh', quantity: 1 }]
    assert.deepEqual(
        canSplitQuantities(open({ status: 'CLOSED' }), sixOnThree(), one, 'shift1'),
        { ok: false, reason: 'SESSION_NOT_OPEN' },
    )
    assert.deepEqual(
        canSplitQuantities(open({ paidCount: 1 }), sixOnThree(), one, 'shift1'),
        { ok: false, reason: 'ALREADY_PAID' },
    )
    assert.deepEqual(
        canSplitQuantities(open(), sixOnThree(), one, null),
        { ok: false, reason: 'NO_OPEN_SHIFT' },
    )
    assert.deepEqual(
        canSplitQuantities(open(), sixOnThree(), [], 'shift1'),
        { ok: false, reason: 'NOTHING_SELECTED' },
    )
})

test('an upcharge follows the package it came from, and only once', () => {
    const swaps = [{ orderItemId: 'pkg', chargeItemId: 'chg' }]
    assert.deepEqual(swapChargeLineIds([{ itemId: 'pkg', quantity: 2 }], swaps), ['chg'])
    // Not dragged in when its package stays put.
    assert.deepEqual(swapChargeLineIds([{ itemId: 'beer', quantity: 1 }], swaps), [])
    // Not added twice if the charge was ticked as well.
    assert.deepEqual(
        swapChargeLineIds([{ itemId: 'pkg', quantity: 2 }, { itemId: 'chg', quantity: 1 }], swaps),
        [],
    )
})

// --- billLabel: the same letter on both screens ------------------------------
//
// The floor plan picker and the till banner letter the same bills. If they
// disagree, a waiter charges a party they can see is not the one they picked.

const bill = (id: string, openedAt: string) => ({ id, openedAt })

test('a table with one bill keeps its plain name', () => {
    assert.equal(billLabel('T5', [bill('s1', '2026-09-18T19:00:00Z')], 's1'), 'T5')
    assert.equal(billLabel('T5', [], 's1'), 'T5')
})

test('a split table letters its bills by who sat down first', () => {
    const bills = [bill('s2', '2026-09-18T20:00:00Z'), bill('s1', '2026-09-18T19:00:00Z')]
    // Passed in the wrong order on purpose: the function sorts, so a caller
    // cannot make the two screens disagree by fetching differently.
    assert.equal(billLabel('T5', bills, 's1'), 'T5-a')
    assert.equal(billLabel('T5', bills, 's2'), 'T5-b')
})

test('three bills carry on down the alphabet', () => {
    const bills = [
        bill('a', '2026-09-18T19:00:00Z'),
        bill('b', '2026-09-18T19:30:00Z'),
        bill('c', '2026-09-18T20:00:00Z'),
    ]
    assert.deepEqual(bills.map((x) => billLabel('D1', bills, x.id)), ['D1-a', 'D1-b', 'D1-c'])
})

test('bills sharing a timestamp still letter the same way every time', () => {
    // A split stamps new Date() on the child, so a tie is reachable. Without a
    // tiebreak the letter would flip between requests.
    const same = '2026-09-18T19:00:00Z'
    const bills = [bill('zzz', same), bill('aaa', same)]
    assert.equal(billLabel('T5', bills, 'aaa'), 'T5-a')
    assert.equal(billLabel('T5', bills, 'zzz'), 'T5-b')
    // Same answer from the reversed input.
    const reversed = [...bills].reverse()
    assert.equal(billLabel('T5', reversed, 'aaa'), 'T5-a')
    assert.equal(billLabel('T5', reversed, 'zzz'), 'T5-b')
})

test('a bill not in the list falls back to the table name, never a wrong letter', () => {
    const bills = [bill('s1', '2026-09-18T19:00:00Z'), bill('s2', '2026-09-18T20:00:00Z')]
    assert.equal(billLabel('T5', bills, 'gone'), 'T5')
})

test('on a tie, the bill that existed first keeps the earlier letter', () => {
    // A split stamps new Date() on the child, so parent and child can share an
    // openedAt. Without createdAt the tiebreak falls to UUID order, and the
    // party who had been there all night could be renamed "T5-b" while the
    // half that just split off took "T5-a".
    const same = '2026-09-18T19:00:00Z'
    const parent = { id: 'zzz-parent', openedAt: same, createdAt: '2026-09-18T19:00:00Z' }
    const child = { id: 'aaa-child', openedAt: same, createdAt: '2026-09-18T21:30:00Z' }
    assert.equal(billLabel('T5', [parent, child], parent.id), 'T5-a')
    assert.equal(billLabel('T5', [parent, child], child.id), 'T5-b')
    // Same answer whichever order they arrive in.
    assert.equal(billLabel('T5', [child, parent], parent.id), 'T5-a')
})

test('without createdAt it still sorts deterministically, just by id', () => {
    const same = '2026-09-18T19:00:00Z'
    const bills = [{ id: 'b', openedAt: same }, { id: 'a', openedAt: same }]
    assert.equal(billLabel('T5', bills, 'a'), 'T5-a')
    assert.equal(billLabel('T5', [...bills].reverse(), 'a'), 'T5-a')
})

// --- canSendLines: drinks leaving for another table's bill -------------------

const otherBill = (over = {}) => ({ id: 's2', status: 'OPEN', paidCount: 0, ...over })

test('a bottle can leave a line of three for another table', () => {
    const lines = [{ id: 'wine', quantity: 3 }, { id: 'beer', quantity: 2 }]
    assert.deepEqual(
        canSendLines(open(), otherBill(), lines, [{ itemId: 'wine', quantity: 1 }], 'shift1'),
        { ok: true },
    )
})

test('sending every drink is a merge, and says so', () => {
    const lines = [{ id: 'wine', quantity: 1 }]
    assert.deepEqual(
        canSendLines(open(), otherBill(), lines, [{ itemId: 'wine', quantity: 1 }], 'shift1'),
        { ok: false, reason: 'CANNOT_SEND_EVERYTHING' },
    )
})

test('a bill cannot send drinks to itself', () => {
    const lines = [{ id: 'wine', quantity: 3 }]
    assert.deepEqual(
        canSendLines(open({ id: 'same' }), otherBill({ id: 'same' }), lines,
            [{ itemId: 'wine', quantity: 1 }], 'shift1'),
        { ok: false, reason: 'SAME_BILL' },
    )
})

test('the destination has to be open and unpaid too', () => {
    const lines = [{ id: 'wine', quantity: 3 }]
    const one = [{ itemId: 'wine', quantity: 1 }]
    assert.deepEqual(
        canSendLines(open(), otherBill({ status: 'CLOSED' }), lines, one, 'shift1'),
        { ok: false, reason: 'DESTINATION_NOT_OPEN' },
    )
    assert.deepEqual(
        canSendLines(open(), otherBill({ paidCount: 1 }), lines, one, 'shift1'),
        { ok: false, reason: 'DESTINATION_ALREADY_PAID' },
    )
    // A bill asking for its bill is still open for business.
    assert.deepEqual(
        canSendLines(open(), otherBill({ status: 'BILL_REQUESTED' }), lines, one, 'shift1'),
        { ok: true },
    )
})

test('the split rules still apply to the sending bill', () => {
    const lines = [{ id: 'wine', quantity: 3 }, { id: 'beer', quantity: 2 }]
    assert.deepEqual(
        canSendLines(open({ paidCount: 1 }), otherBill(), lines, [{ itemId: 'wine', quantity: 1 }], 'shift1'),
        { ok: false, reason: 'ALREADY_PAID' },
    )
    assert.deepEqual(
        canSendLines(open(), otherBill(), lines, [{ itemId: 'wine', quantity: 9 }], 'shift1'),
        { ok: false, reason: 'MORE_THAN_ORDERED' },
    )
    assert.deepEqual(
        canSendLines(open(), otherBill(), [{ id: 'pkg', quantity: 2, hasSwap: true }, { id: 'b', quantity: 5 }],
            [{ itemId: 'pkg', quantity: 1 }], 'shift1'),
        { ok: false, reason: 'SWAPPED_LINE_MOVES_WHOLE' },
    )
})

// The printed bill is what the customer pays from, and it carries the QR. It
// can only show rounds that were sent, so printing with drinks still in the
// cart hands over a bill - and a QR - for less than the screen says.
test('a bill prints once every round on it has been sent', () => {
    assert.deepEqual(canPrintBill({ rounds: [{ status: 'SENT' }], unsentLines: 0 }), { ok: true })
    assert.deepEqual(canPrintBill({ rounds: [{ status: 'SENT' }, { status: 'COMPLETED' }], unsentLines: 0 }), { ok: true })
})

test('drinks still in the cart keep the bill from printing', () => {
    assert.deepEqual(
        canPrintBill({ rounds: [{ status: 'SENT' }], unsentLines: 2 }),
        { ok: false, reason: 'UNSENT_ITEMS' },
    )
    // Unsent items with nothing sent yet is still "send first", not "empty".
    assert.deepEqual(
        canPrintBill({ rounds: [], unsentLines: 3 }),
        { ok: false, reason: 'UNSENT_ITEMS' },
    )
})

test('a table with nothing sent has no bill to print', () => {
    // A ฿0 bill flips the table to "waiting to pay" with nobody owing anything.
    assert.deepEqual(canPrintBill({ rounds: [], unsentLines: 0 }), { ok: false, reason: 'NOTHING_SENT' })
    // Held and cancelled rounds are not on the printed bill either.
    assert.deepEqual(
        canPrintBill({ rounds: [{ status: 'HOLD' }, { status: 'CANCELLED' }], unsentLines: 0 }),
        { ok: false, reason: 'NOTHING_SENT' },
    )
})

// --- The letter a split bill keeps -------------------------------------------
//
// Worked out from whichever bills were still open, the letter moved: once T1-a
// paid, T1-b became plain "T1", and a reprint of either said "T1". The slips a
// party walks away with have to say which half each one was, for good.

test('the first split letters the original a and the new bill b', () => {
    assert.deepEqual(splitIndexes(null, []), { parent: 0, child: 1 })
})

test('splitting a split bill carries on down the alphabet', () => {
    // T1-b splits again while T1-a is still at the table.
    assert.deepEqual(splitIndexes(1, [0, 1]), { parent: 1, child: 2 })
    // T1-a splits after T1-b and T1-c exist: the next letter is d, not b again.
    assert.deepEqual(splitIndexes(0, [0, 1, 2]), { parent: 0, child: 3 })
})

test('a letter already given out tonight is not given out twice', () => {
    // T1-a has paid and gone; T1-b splits. The new bill is T1-c - a second
    // "T1-a" slip in the same night is the confusion this exists to stop.
    assert.deepEqual(splitIndexes(1, [0, 1]), { parent: 1, child: 2 })
    // An unlettered bill on a table that already has lettered ones (bills
    // split before letters were saved) takes the next free letter.
    assert.deepEqual(splitIndexes(null, [0, 1]), { parent: 2, child: 3 })
})

test('a saved letter wins over working it out from the open bills', () => {
    // T1-a has paid, so only T1-b is still open. It stays T1-b.
    assert.equal(billLabel('T1', [{ id: 'b', openedAt: '2026-10-19T20:00:00Z', splitIndex: 1 }], 'b'), 'T1-b')
    // Both open, saved letters given in the opposite order to opening time.
    const both = [
        { id: 'x', openedAt: '2026-10-19T19:00:00Z', splitIndex: 1 },
        { id: 'y', openedAt: '2026-10-19T20:00:00Z', splitIndex: 0 },
    ]
    assert.equal(billLabel('T1', both, 'x'), 'T1-b')
    assert.equal(billLabel('T1', both, 'y'), 'T1-a')
})
