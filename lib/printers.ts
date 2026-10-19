/**
 * Getting a docket out of a printer that is across the room (req #11).
 *
 * Thermal printers on a LAN listen on port 9100 and take raw ESC/POS. That is
 * the whole protocol: open a socket, write the bytes, close it. No driver, no
 * spooler, no print dialog - which is the point, because a print dialog on every
 * round is a dialog staff will dismiss and a docket nobody gets.
 *
 * The addresses live in Settings, not in code: the owner can move a printer or
 * swap a dead one without a deploy, and a bar with only the receipt printer so
 * far leaves them blank and nothing tries to print.
 *
 * Nothing here can fail an order. A round that is keyed and paid for but not
 * printed is a shout across the room; a round that failed to save because a
 * printer was unplugged is a drink nobody is charged for.
 */

import net from 'node:net'
import { prisma } from './prisma'
import {
    escposDocket, renderDocket, splitByStation,
    type DocketItem, type Station,
} from './dockets'

/** Settings keys holding each station's printer address. */
export const PRINTER_SETTING: Record<Station, string> = {
    BAR: 'printer_bar',
    KITCHEN: 'printer_kitchen',
}

/** What every ESC/POS network printer listens on unless told otherwise. */
export const PRINTER_PORT = 9100

/** Long enough for a printer waking up, short enough not to stall the till. */
const TIMEOUT_MS = 4000

export type PrintResult = { station: Station; address: string | null; ok: boolean; error?: string }

export function parseAddress(value: string | undefined | null): { host: string; port: number } | null {
    const trimmed = (value ?? '').trim()
    if (!trimmed) return null
    // "192.168.1.50" or "192.168.1.50:9100". A hostname works too - some of
    // these printers announce themselves over mDNS.
    const [host, port] = trimmed.split(':')
    if (!host) return null
    const parsed = Number(port)
    return { host, port: Number.isInteger(parsed) && parsed > 0 ? parsed : PRINTER_PORT }
}

/** Write the bytes and wait for the socket to drain, or give up. */
export function sendBytes(
    address: { host: string; port: number },
    bytes: Buffer,
    timeoutMs: number = TIMEOUT_MS,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection(address)
        // One settle: a timeout firing after an error must not reject twice.
        let done = false
        const finish = (error?: Error) => {
            if (done) return
            done = true
            socket.destroy()
            if (error) reject(error)
            else resolve()
        }

        socket.setTimeout(timeoutMs)
        socket.on('timeout', () => finish(new Error('PRINTER_TIMEOUT')))
        socket.on('error', (error) => finish(error))
        socket.on('connect', () => {
            socket.write(bytes, (error) => finish(error ?? undefined))
        })
    })
}

/**
 * Print one round: a bar ticket, a kitchen docket, or both.
 *
 * Both are attempted even if the first fails - a dead kitchen printer must not
 * keep the barman from getting the drinks order.
 */
export async function printRound(round: {
    table: string
    round: number | null
    waiter: string | null
    at?: Date
    items: DocketItem[]
}): Promise<PrintResult[]> {
    const groups = splitByStation(round.items)
    if (groups.length === 0) return []

    const settings = await prisma.setting.findMany({
        where: { key: { in: Object.values(PRINTER_SETTING) } },
    })
    const addressOf = (station: Station) =>
        parseAddress(settings.find((s) => s.key === PRINTER_SETTING[station])?.value)

    const results: PrintResult[] = []
    for (const group of groups) {
        const address = addressOf(group.station)
        if (!address) {
            // No printer configured for this station. Not an error the till
            // should nag about every round - the bar may not own one yet.
            results.push({ station: group.station, address: null, ok: true })
            continue
        }

        const bytes = escposDocket(
            renderDocket({
                station: group.station,
                table: round.table,
                round: round.round,
                waiter: round.waiter,
                at: round.at ?? new Date(),
                items: group.items,
            }),
        )

        try {
            await sendBytes(address, bytes)
            results.push({ station: group.station, address: `${address.host}:${address.port}`, ok: true })
        } catch (error: any) {
            console.error(`[printers] ${group.station} at ${address.host}:${address.port} failed`, error?.message)
            results.push({
                station: group.station,
                address: `${address.host}:${address.port}`,
                ok: false,
                error: error?.message === 'PRINTER_TIMEOUT' ? 'PRINTER_TIMEOUT' : 'PRINTER_UNREACHABLE',
            })
        }
    }
    return results
}
