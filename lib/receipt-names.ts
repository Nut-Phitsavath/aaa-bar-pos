/**
 * Splitting a snapshotted order-line name back into its two languages.
 *
 * The till writes one string per line - `${localName} (${name})` - so a deleted
 * menu item still prints the name it was sold under. Reading it back is where
 * this gets sharp: a bar's package names carry their own brackets ("Beer Lao
 * Bucket (5)"), so the composed string is
 *
 *     ຖັງເບຍລາວ (5) (Beer Lao Bucket (5))
 *
 * and a lazy `\((.*?)\)$` match splits it at the FIRST bracket, printing
 * "5) (Beer Lao Bucket (5" on the customer's receipt.
 *
 * So: scan from the end and split on the bracket that opens the final balanced
 * group, and only when what precedes it actually contains Lao script - because
 * an English-only name is not a composed string at all, and "Beer Lao Bucket
 * (5)" must keep its "(5)" rather than lose it to a phantom translation.
 */

/** Lao block. Its presence is what marks a string as composed of two names. */
const LAO = /[຀-໿]/

export type SplitName = { lao: string; english: string | null }

export function parseNames(name: string): SplitName {
    // Modifiers are appended after a dash and are not part of the name.
    const base = (name || "").replace(/-.*$/, "").trim()
    if (!base.endsWith(")")) return { lao: base, english: null }

    let depth = 0
    for (let i = base.length - 1; i >= 0; i--) {
        const c = base[i]
        if (c === ")") depth++
        else if (c === "(") {
            depth--
            if (depth !== 0) continue

            const head = base.slice(0, i).trim()
            const tail = base.slice(i + 1, -1).trim()
            // No Lao in the head means this bracket belongs to the product name
            // ("Bucket (5)"), not to a translation.
            if (head && tail && LAO.test(head)) return { lao: head, english: tail }
            return { lao: base, english: null }
        }
    }
    return { lao: base, english: null }
}
