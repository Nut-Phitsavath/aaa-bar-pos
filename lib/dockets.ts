/**
 * The ticket that comes out at the bar and the docket that comes out in the
 * kitchen when a round is sent (req #11).
 *
 * Food and drink are made by different people in different rooms, so one round
 * becomes two pieces of paper, each holding only the lines its station makes.
 * A bar ticket listing fried chicken wastes the barman's time twice: once
 * reading it and once when the kitchen never sees the order.
 *
 * Pure text in, bytes out. The formatting is tested without a printer, which is
 * the only way any of this gets checked before the hardware is on the network.
 */

/** Where a line is made. The `station` on its category. */
export const STATIONS = ['BAR', 'KITCHEN'] as const
export type Station = (typeof STATIONS)[number]

export function isStation(value: unknown): value is Station {
    return typeof value === 'string' && (STATIONS as readonly string[]).includes(value)
}

export type DocketItem = {
    name: string
    quantity: number
    note?: string | null
    /** BAR unless the category says otherwise - see the schema comment. */
    station?: string | null
}

export type Docket = {
    station: Station
    table: string
    /** This round's number within the bill, which is what staff shout about. */
    round: number | null
    waiter: string | null
    at: Date
    items: DocketItem[]
}

/** 80mm paper at the usual 12x24 font. 58mm rolls want 32. */
export const DOCKET_WIDTH = 42

/**
 * One round split into the papers it has to become.
 *
 * Only stations that actually have lines get a docket: a round of four beers
 * must not push a blank sheet out of the kitchen printer, which is how staff
 * learn to ignore the kitchen printer.
 */
export function splitByStation(items: DocketItem[]): { station: Station; items: DocketItem[] }[] {
    return STATIONS.map((station) => ({
        station,
        items: items.filter((i) => (isStation(i.station) ? i.station : 'BAR') === station),
    })).filter((group) => group.items.length > 0)
}

function centre(text: string, width: number): string {
    const pad = Math.max(0, Math.floor((width - text.length) / 2))
    return ' '.repeat(pad) + text
}

/** Long drink names wrap rather than being cut off mid-word. */
function wrap(text: string, width: number, indent: string): string[] {
    const out: string[] = []
    let line = ''
    for (const word of text.split(/\s+/)) {
        const candidate = line ? `${line} ${word}` : word
        if (candidate.length > width && line) {
            out.push(line)
            line = indent + word
        } else {
            line = candidate
        }
    }
    if (line) out.push(line)
    return out
}

function clock(at: Date): string {
    return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

/**
 * The docket as text: first line is the station, then the table, then the lines.
 *
 * The station leads because the two printers sit in different rooms and the
 * paper gets carried; the table is second because it is the only thing on the
 * page that decides where the plate goes.
 */
export function renderDocket(docket: Docket, width: number = DOCKET_WIDTH): string {
    const rule = '-'.repeat(width)
    const lines: string[] = [
        centre(docket.station, width),
        centre(docket.round ? `${docket.table} · #${docket.round}` : docket.table, width),
        centre([docket.waiter, clock(docket.at)].filter(Boolean).join(' · '), width),
        rule,
    ]

    for (const item of docket.items) {
        lines.push(...wrap(`${item.quantity}x ${item.name}`, width, '   '))
        // The note is the whole reason a kitchen reads the paper twice.
        if (item.note) lines.push(...wrap(`   ** ${item.note}`, width, '      '))
    }

    lines.push(rule)
    return lines.join('\n')
}

const ESC = 0x1b
const GS = 0x1d

/**
 * The text as ESC/POS, which is what every thermal printer in this market
 * speaks over port 9100.
 *
 * Only four commands are used - reset, alignment, double size, cut - because
 * every one beyond that is a thing to debug in a bar at midnight. The first
 * line prints double height so a barman can read which station it is from
 * across the counter.
 *
 * ponytail: the text goes out as UTF-8. A printer whose codepage cannot render
 * Lao will print the Lao half of a name as noise; the fix then is to select the
 * printer's codepage here (ESC t n) and transcode, which needs the actual model
 * in hand to pick n.
 */
export function escposDocket(text: string): Buffer {
    const [first, ...rest] = text.split('\n')
    return Buffer.concat([
        Buffer.from([ESC, 0x40]), // reset
        Buffer.from([ESC, 0x61, 0x01]), // centre
        Buffer.from([GS, 0x21, 0x11]), // double width and height
        Buffer.from(`${first}\n`, 'utf8'),
        Buffer.from([GS, 0x21, 0x00]), // back to one size
        Buffer.from([ESC, 0x61, 0x00]), // left
        Buffer.from(`${rest.join('\n')}\n\n\n`, 'utf8'),
        Buffer.from([GS, 0x56, 0x42, 0x00]), // feed and partial cut
    ])
}
