/**
 * Downsize menu photos in public/uploads.
 *
 *   node scripts/shrink-uploads.mjs [--apply] [--max 1200]
 *
 * Without --apply it only reports what it would do.
 *
 * Why: the originals are camera-resolution (up to 4032px, 2.4MB). next/image
 * resizes them for the browser, so they never hit the wire at that size -- but
 * the POS machine still has to decode the full-size file to build each cached
 * variant, and that cache is thrown away on every redeploy. Shrinking the
 * sources removes that CPU cost permanently.
 *
 * Menu cards display around 340px on the till, so 1200px keeps plenty of
 * headroom for high-DPI screens and any future larger layout.
 *
 * Each file keeps its name AND its real encoded format -- some files are named
 * .jpg but are actually PNG, and the app relies on content sniffing rather than
 * the extension, so re-encoding to a different format could change behaviour.
 */
import sharp from "sharp"
import fs from "fs"
import path from "path"

const DIR = path.join(process.cwd(), "public", "uploads")
const APPLY = process.argv.includes("--apply")
const maxIdx = process.argv.indexOf("--max")
const MAX = maxIdx > -1 ? Number(process.argv[maxIdx + 1]) : 1200

const kb = n => Math.round(n / 1024)
let before = 0, after = 0, touched = 0, skipped = 0, failed = []

for (const name of fs.readdirSync(DIR)) {
    const p = path.join(DIR, name)
    if (!fs.statSync(p).isFile()) continue
    const startBytes = fs.statSync(p).size
    before += startBytes

    try {
        // Read into memory first. On Windows, sharp keeps the source file open
        // while streaming, and writing back to the same path then fails with
        // EBUSY/UNKNOWN. Working from a buffer releases the handle up front.
        const input = fs.readFileSync(p)
        const meta = await sharp(input).metadata()
        const longest = Math.max(meta.width || 0, meta.height || 0)

        // Leave small files alone -- re-encoding them risks losing quality for
        // no gain.
        if (longest <= MAX && startBytes < 300 * 1024) { after += startBytes; skipped++; continue }

        let pipeline = sharp(input).rotate() // honour EXIF orientation before resizing
        if (longest > MAX) pipeline = pipeline.resize({ width: MAX, height: MAX, fit: "inside", withoutEnlargement: true })

        // Keep the source's real format, whatever the extension claims.
        if (meta.format === "png") pipeline = pipeline.png({ compressionLevel: 9, palette: true })
        else if (meta.format === "webp") pipeline = pipeline.webp({ quality: 82 })
        else pipeline = pipeline.jpeg({ quality: 82, mozjpeg: true })

        const buf = await pipeline.toBuffer()

        // Never write a file that came out bigger than it started.
        if (buf.length >= startBytes) { after += startBytes; skipped++; continue }

        if (APPLY) fs.writeFileSync(p, buf)
        after += buf.length
        touched++
        if (startBytes - buf.length > 200 * 1024)
            console.log(`  ${String(kb(startBytes)).padStart(5)}KB -> ${String(kb(buf.length)).padStart(4)}KB  ${meta.width}x${meta.height}  ${name}`)
    } catch (e) {
        failed.push(`${name}: ${String(e).slice(0, 60)}`)
        after += startBytes
    }
}

console.log(`\n${APPLY ? "APPLIED" : "DRY RUN"} (max ${MAX}px)`)
console.log(`  rewritten: ${touched}   left alone: ${skipped}   failed: ${failed.length}`)
console.log(`  ${kb(before)} KB -> ${kb(after)} KB  (${Math.round((1 - after / before) * 100)}% smaller)`)
failed.forEach(f => console.log("  FAILED " + f))
