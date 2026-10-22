// Run: node --experimental-strip-types --test lib/brand.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { brandOf, VENDOR } from './brand.ts'

test('a till nobody has named yet shows CaniSoftware, and no "powered by"', () => {
    const b = brandOf({})
    assert.equal(b.custom, false)
    assert.equal(b.title, VENDOR.name)
    assert.equal(b.logo, VENDOR.logo)
    assert.equal(brandOf(null).custom, false)
    assert.equal(brandOf({ shopName: '   ' }).custom, false)
})

test("the bar's name takes over, split into a headline and the rest", () => {
    const b = brandOf({ shopName: 'AAA Night Club' })
    assert.equal(b.custom, true)
    assert.equal(b.title, 'AAA')
    assert.equal(b.subtitle, 'Night Club')
    assert.equal(b.logo, null)
    assert.equal(b.mark, 'AAA')
})

test('the mark is the first word when it is short, otherwise initials', () => {
    assert.equal(brandOf({ shopName: 'Memories Lane' }).mark, 'ML')
    assert.equal(brandOf({ shopName: 'Memories Lane Rooftop Lounge' }).mark, 'MLR')
    assert.equal(brandOf({ shopName: 'Sky Bar' }).mark, 'Sky')
    assert.equal(brandOf({ shopName: 'Zeus' }).mark, 'Zeus')
    assert.equal(brandOf({ shopName: 'Zeus' }).subtitle, '')
})

test('an uploaded logo is used, with or without a name', () => {
    assert.equal(brandOf({ shopName: 'AAA Night Club', shopLogo: '/api/uploads/aaa.png' }).logo, '/api/uploads/aaa.png')
    const logoOnly = brandOf({ shopLogo: '/api/uploads/aaa.png' })
    assert.equal(logoOnly.custom, true)
    assert.equal(logoOnly.logo, '/api/uploads/aaa.png')
    assert.equal(logoOnly.title, VENDOR.name)
})

test('the older shop_name key still counts', () => {
    assert.equal(brandOf({ shop_name: 'AAA Night Club' }).title, 'AAA')
})
