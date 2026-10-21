/**
 * The QR printed on a bill that is still owed.
 *
 * Settings -> "QR on bills" picks one of three. Off. The bar's static bank QR
 * (Settings -> Store Transfer QR), used until the bank's dynamic QR is set up:
 * it carries no amount, so the customer types one and the slip states the
 * baht to transfer. Or OnePay's dynamic QR, which carries its own amount and
 * is confirmed by the bank.
 */

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

/** Settings -> "QR on bills". */
export const BILL_QR_MODES = ['OFF', 'BANK', 'ONEPAY'] as const
export type BillQrMode = (typeof BILL_QR_MODES)[number]

/**
 * The owner's choice, or - until one is made - what the bar already had: its
 * uploaded bank QR if there is one, nothing if not. OnePay is never assumed;
 * it is a live payment service and has to be picked on purpose.
 */
export function billQrMode(value: string | null | undefined, hasBankQr: boolean): BillQrMode {
    if ((BILL_QR_MODES as readonly string[]).includes(value ?? '')) return value as BillQrMode
    return hasBankQr ? 'BANK' : 'OFF'
}

export type BillQr =
    | { kind: 'ONEPAY'; payload: string; thb: number }
    | { kind: 'BANK'; src: string; thb: number }

/**
 * Which QR, if any, this bill carries.
 *
 * Only while the bill is open and something is owed: a settled receipt or a
 * counter sale has nothing left to scan for, and a closed bill still owing is
 * a tab, which is settled at the till against its customer - a QR on the slip
 * would let it be paid with nothing saying whose tab it was.
 *
 * OnePay's QR carries its own amount and is confirmed by the bank. When it
 * could not be made (no internet, BCEL down) the bank QR stands in if the
 * owner allowed it, and staff confirm that transfer by hand as usual.
 */
export function billQrFor(
    bill: { balance?: number | null; qrCodeData?: string | null; closedAt?: string | null },
    settings: { mode: BillQrMode; fallback: boolean; bankQrUrl: string | null | undefined },
): BillQr | null {
    const owed = bill.balance ?? 0
    if (owed <= 0 || bill.closedAt || settings.mode === 'OFF') return null

    if (settings.mode === 'ONEPAY') {
        if (bill.qrCodeData) return { kind: 'ONEPAY', payload: bill.qrCodeData, thb: owed }
        if (!settings.fallback) return null
    }

    if (!settings.bankQrUrl) return null
    return { kind: 'BANK', src: settings.bankQrUrl, thb: owed }
}
