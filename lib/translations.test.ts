// Run: node --experimental-strip-types --test lib/translations.test.ts
//
// Two failures that are invisible until a customer or a staff member hits them,
// and that I have now caused twice by appending a key without checking:
//
//   - a duplicate key. The later one silently wins, so the value you just wrote
//     may never render and the one you meant to change is somewhere else.
//   - a key in one language only. The missing side renders "⚠️ key_name" on a
//     till that is used in Lao all night.
//
// Both are mechanical, so neither needs a person to notice them.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { translations } from './translations.ts'

/**
 * Read the source rather than the object: a duplicate key is gone by the time
 * the module is evaluated, so the parsed object can never reveal one.
 */
function keysBySource() {
    const src = readFileSync(new URL('./translations.ts', import.meta.url), 'utf8')
    const found: Record<string, Record<string, number[]>> = {}
    let locale: string | null = null

    src.split(/\r?\n/).forEach((line, i) => {
        const header = line.match(/^\s{4}(\w+)\s*:\s*\{/)
        if (header) { locale = header[1]; found[locale] ??= {}; return }
        const key = line.match(/^\s{8}([a-zA-Z_][a-zA-Z0-9_]*)\s*:/)
        if (!key || !locale) return
        ;(found[locale][key[1]] ??= []).push(i + 1)
    })
    return found
}

test('no locale declares the same key twice', () => {
    const found = keysBySource()
    const dupes: string[] = []
    for (const [locale, keys] of Object.entries(found)) {
        for (const [key, lines] of Object.entries(keys)) {
            if (lines.length > 1) dupes.push(`${locale}.${key} at lines ${lines.join(', ')}`)
        }
    }
    assert.deepEqual(dupes, [], `duplicate keys silently keep the last value:\n  ${dupes.join('\n  ')}`)
})

test('every key exists in both languages', () => {
    const en = Object.keys(translations.en)
    const lo = Object.keys(translations.lo)
    const missingLo = en.filter((k) => !(k in translations.lo))
    const missingEn = lo.filter((k) => !(k in translations.en))
    assert.deepEqual(missingLo, [], `missing from lo, will render as ⚠️: ${missingLo.join(', ')}`)
    assert.deepEqual(missingEn, [], `missing from en, will render as ⚠️: ${missingEn.join(', ')}`)
})

test('no translation is an empty string', () => {
    // An empty value renders as nothing at all, which reads as a broken layout
    // rather than as a missing translation.
    const blank: string[] = []
    for (const [locale, dict] of Object.entries(translations)) {
        for (const [key, value] of Object.entries(dict as Record<string, string>)) {
            if (typeof value === 'string' && value.trim() === '') blank.push(`${locale}.${key}`)
        }
    }
    assert.deepEqual(blank, [])
})
