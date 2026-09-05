// Run: node --experimental-strip-types --test lib/receipt-names.test.ts
//
// What a customer reads off the paper. The bug these exist to stop printed
// "5) (Beer Lao Bucket (5" as the English name of a bucket of beer.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseNames } from './receipt-names.ts'

test('a plain two-language name splits', () => {
    assert.deepEqual(parseNames('ເບຍລາວ (Beer Lao)'), { lao: 'ເບຍລາວ', english: 'Beer Lao' })
})

test('a package name keeps its own brackets on both sides', () => {
    // The regression: the till composes `${localName} (${name})`, and both
    // halves of a package name already contain "(5)".
    assert.deepEqual(
        parseNames('ຖັງເບຍລາວ (5) (Beer Lao Bucket (5))'),
        { lao: 'ຖັງເບຍລາວ (5)', english: 'Beer Lao Bucket (5)' }
    )
})

test('an English-only name is left whole, brackets and all', () => {
    // Nothing composed this, so "(5)" is part of the product, not a translation.
    assert.deepEqual(parseNames('Beer Lao Bucket (5)'), { lao: 'Beer Lao Bucket (5)', english: null })
})

test('a name with no brackets has no English half', () => {
    assert.deepEqual(parseNames('Mojito'), { lao: 'Mojito', english: null })
    assert.deepEqual(parseNames('ໂມຈິໂຕ້'), { lao: 'ໂມຈິໂຕ້', english: null })
})

test('a trailing modifier is dropped before splitting', () => {
    assert.deepEqual(parseNames('ເບຍລາວ (Beer Lao) - ICE'), { lao: 'ເບຍລາວ', english: 'Beer Lao' })
})

test('unbalanced brackets never lose characters', () => {
    // A malformed name cannot be composed by the till, so there is no right
    // split - only a wrong one, which is dropping part of what was sold. The
    // guarantee is that every character survives into one half or the other.
    for (const input of ['Weird ))', 'ເບຍ ((Beer)', '((', 'ເບຍ )(']) {
        const { lao, english } = parseNames(input)
        const kept = (lao + (english ?? '')).replace(/[()\s]/g, '')
        assert.equal(kept, input.replace(/[()\s]/g, ''), `lost characters from ${input}`)
    }
})

test('an empty half is not a split', () => {
    assert.deepEqual(parseNames('()'), { lao: '()', english: null })
    assert.deepEqual(parseNames('ເບຍລາວ ()'), { lao: 'ເບຍລາວ ()', english: null })
})

test('an empty or missing name does not throw', () => {
    assert.deepEqual(parseNames(''), { lao: '', english: null })
    assert.deepEqual(parseNames(undefined as unknown as string), { lao: '', english: null })
})

test('nested brackets inside the English half survive', () => {
    assert.deepEqual(
        parseNames('ຊຸດຊີວາສ (Chivas Set (700ml))'),
        { lao: 'ຊຸດຊີວາສ', english: 'Chivas Set (700ml)' }
    )
})
