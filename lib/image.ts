import sharp from "sharp"

/**
 * Normalising photos as they arrive.
 *
 * Staff upload straight from a phone -- 4000px, several MB, sometimes HEIC.
 * They have no way to shrink a photo first and shouldn't need one, so the
 * server does it. Without this the originals pile up and the till pays for it
 * later: next/image has to decode a multi-megabyte file to build each cached
 * size, and that cache is discarded on every redeploy.
 *
 * scripts/shrink-uploads.mjs is the one-off version of this for photos that
 * were already uploaded before it existed; these numbers are the source of
 * truth for anything new.
 */

/** Menu cards show at roughly 340px; 1200 leaves room for high-DPI screens. */
export const MAX_EDGE = 1200
export const QUALITY = 82

/** Anything bigger than this is refused before we try to decode it. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

export type NormalizedImage = { buffer: Buffer; ext: "jpg" | "png" }

/**
 * Decode, downsize and re-encode an uploaded photo.
 *
 * Throws if the bytes aren't an image sharp can read -- which doubles as the
 * file-type check: a renamed .exe never gets written to disk.
 */
export async function normalizeUploadImage(input: Buffer): Promise<NormalizedImage> {
    const meta = await sharp(input).metadata()
    if (!meta.width || !meta.height) throw new Error("unreadable image")

    // rotate() first: phone photos carry their orientation in EXIF, and
    // resizing before applying it would bake in a sideways picture.
    const pipeline = sharp(input)
        .rotate()
        .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })

    // Keep PNG only when the image actually uses transparency -- JPEG would
    // fill it with black. Everything else (including HEIC off an iPhone)
    // becomes JPEG, which is far smaller for photographs.
    if (meta.hasAlpha) return { buffer: await pipeline.png({ compressionLevel: 9 }).toBuffer(), ext: "png" }
    return { buffer: await pipeline.jpeg({ quality: QUALITY, mozjpeg: true }).toBuffer(), ext: "jpg" }
}

/**
 * A filename we are willing to write to disk.
 *
 * The old code interpolated the browser-supplied name straight into a path, so
 * a crafted name containing ../ escaped the uploads folder. Here the extension
 * comes from what we actually encoded, and the stem is reduced to characters
 * that cannot mean anything to a filesystem.
 */
export function safeUploadName(originalName: string, ext: "jpg" | "png"): string {
    const stem = originalName
        .replace(/\.[^.]+$/, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60)
    return `${Date.now()}-${stem || "photo"}.${ext}`
}
