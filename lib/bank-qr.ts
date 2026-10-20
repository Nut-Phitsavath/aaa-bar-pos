/**
 * The bar's static bank QR on a bill that is still owed.
 *
 * Until the bank's dynamic QR is set up, the bar takes transfers on one fixed
 * LAO QR (Settings -> Store Transfer QR). It carries no amount, so the
 * customer types one - and a bill that only says ฿165 leaves them converting
 * baht to kip in their head. The slip therefore states the kip to transfer, at
 * the bill's own rate, whichever currency the till prints in: a LAO QR pays
 * into a kip account.
 *
 * Printed only while something is owed: on a settled receipt or a counter sale
 * there is nothing left to scan for. A dynamic OnePay QR, once there is one,
 * carries its own amount and replaces this.
 */

import { thbToLak } from './currency.ts'

/**
 * What the uploaded QR picture says, so the slip can redraw it as vectors.
 *
 * A photo of a QR does not survive a thermal driver: it is shrunk to the
 * head's dots, smoothed and thresholded, the modules run together, and on the
 * bar's 58 mm Xprinter it stopped scanning. The same code redrawn as vector
 * squares prints crisp at any size (checked down to 25 mm through the real
 * driver). Browser-only; null when the picture holds no readable QR, and the
 * slip then prints the picture as it is.
 */
export async function decodeQrImage(src: string): Promise<string | null> {
    try {
        const { default: jsQR } = await import('jsqr')
        const img = new Image()
        img.src = src
        await img.decode()
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d')
        if (!ctx) return null
        ctx.drawImage(img, 0, 0)
        const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
        return jsQR(data, width, height)?.data || null
    } catch {
        return null
    }
}

export function bankQrFor(
    bill: { balance?: number | null; fxRateLAK?: number | null; qrCodeData?: string | null },
    qrUrl: string | null | undefined,
): { src: string; thb: number; lak: number | null } | null {
    if (!qrUrl) return null
    if (bill.qrCodeData) return null
    const owed = bill.balance ?? 0
    if (owed <= 0) return null
    const rate = bill.fxRateLAK && bill.fxRateLAK > 0 ? bill.fxRateLAK : null
    return { src: qrUrl, thb: owed, lak: rate ? thbToLak(owed, rate) : null }
}
