/**
 * Walk the receipt variants one at a time, on the real printer.
 *
 * Nothing here can be asserted by a script: whether a QR scans off thermal
 * paper, whether grey text survives, whether the last line clears the tear
 * bar. A person has to hold the slip. What a script can do is the tedious
 * part - find a bill in the database that is actually in each state, open its
 * receipt, say what to look for, and write down the verdict.
 *
 * Each case finds a real bill of that kind. Where none exists (no beeper was
 * ever keyed, no QR ever minted) it says how to make one on the till and moves
 * on, rather than inventing rows.
 *
 *   npm run dev                         (or npm start)
 *   npm run check:receipts              walk every case
 *   npm run check:receipts -- --list    just show which cases have a bill
 *   npm run check:receipts -- 9 12      only these cases
 *
 * Each receipt opens in the default browser: press Print there and pick the
 * receipt printer, exactly as staff will. Verdicts go to
 * receipt-check-results.md in the project folder.
 */

const { spawn } = require('node:child_process')
const { writeFileSync } = require('node:fs')
const readline = require('node:readline/promises')
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()
const BASE = process.env.BASE || 'http://localhost:3000'

const bill = (id) => `/receipt?session=${id}`
const sale = (id) => `/receipt?id=${id}`

// Same rule as BillReceipt: "normal" options are not printed, so a bill whose
// options are all normal proves nothing about how options print.
const isStandard = (v) => !v || /normal|standard/i.test(v) || v === '100%'

/** The bill's live numbers, from the same route the receipt reads. */
async function money(id) {
    const r = await fetch(`${BASE}/api/table-sessions/${id}`).catch(() => null)
    if (!r?.ok) return null
    const b = await r.json()
    return { total: b.total, balance: b.balance, paid: b.total - b.balance }
}

const closed = { status: 'CLOSED', mergedIntoId: null }
const live = { status: { in: ['OPEN', 'BILL_REQUESTED'] }, mergedIntoId: null }
const latest = { orderBy: { openedAt: 'desc' } }

/**
 * find() returns a receipt path, or null when no bill like it exists.
 * look is what to check on the paper; make is how to create one when missing.
 */
const CASES = [
    {
        n: 1, title: 'Unpaid bill with a payment QR',
        find: async () => {
            const p = await prisma.payment.findFirst({
                where: { method: 'ONEPAY', paymentStatus: 'PENDING', qrCodeData: { not: null }, voidedAt: null },
                orderBy: { createdAt: 'desc' },
            })
            return p && bill(p.sessionId)
        },
        look: [
            'A QR code and the amount owed under it, at the bottom.',
            'Scan it with a banking app: it opens a payment for exactly that amount.',
            'The QR is sharp, not smeared; the paper did not tear through it.',
        ],
        make: 'Needs OnePay online. Open a table, send a round, press "Print bill" on the till.',
    },
    {
        n: 2, title: 'Unpaid bill, no QR (offline or QR failed)',
        find: async () => {
            for (const s of await prisma.tableSession.findMany({ where: live, include: { payments: true }, ...latest })) {
                if (s.payments.some((p) => p.qrCodeData && p.paymentStatus === 'PENDING')) continue
                const m = await money(s.id)
                if (m && m.balance > 0 && m.paid === 0) return bill(s.id)
            }
            return null
        },
        look: [
            'The bill prints in full even though there is no QR.',
            'No empty box or gap where the QR would be.',
            'Balance due equals the total.',
        ],
        make: 'Open a table, send a round, leave it unpaid.',
    },
    {
        n: 3, title: 'Part-paid bill, printed again',
        find: async () => {
            for (const s of await prisma.tableSession.findMany({ where: live, ...latest })) {
                const m = await money(s.id)
                if (m && m.paid > 0 && m.balance > 0) return bill(s.id)
            }
            return null
        },
        look: [
            '"Amount paid" shows what was already paid, as a minus.',
            '"Balance due" is total minus paid - work it out on paper.',
            'If there is a QR, its amount is the balance, not the full total.',
        ],
        make: 'Open a table, send a round, settle part of it in cash, then print the bill again.',
    },
    {
        n: 4, title: 'Paid in full',
        find: async () => {
            const s = await prisma.tableSession.findFirst({
                where: { ...closed, isOwnerVip: false, payLaterApprovedById: null, discountValue: null, promoId: null },
                ...latest,
            })
            return s && bill(s.id)
        },
        look: [
            'Table name large at the top, the reference under it, opened and closed times.',
            'Balance due ฿0.',
            'The kip line (1 ฿ = … ₭) and the total in kip.',
            'The footer, then enough blank paper that tearing does not cut the footer.',
        ],
        make: 'Settle any table in full.',
    },
    {
        n: 5, title: 'Comped table (owner / VIP)',
        find: async () => {
            const s = await prisma.tableSession.findFirst({ where: { ...closed, isOwnerVip: true }, ...latest })
            return s && bill(s.id)
        },
        look: [
            'Items at full price, "Amount paid" equal to the total, Balance due ฿0.',
            'Known: nothing on the slip says it was comped - it reads exactly like a paid bill. Decide if that is acceptable.',
        ],
        make: 'Settle a table as Owner / VIP.',
    },
    {
        n: 6, title: 'Pay later (tab)',
        find: async () => {
            const s = await prisma.tableSession.findFirst({ where: { payLaterApprovedById: { not: null }, mergedIntoId: null }, ...latest })
            return s && bill(s.id)
        },
        look: [
            'The items and the total.',
            'Known: there is no "Balance due" or "pay later" line - with nothing paid, the slip only shows the total. Decide if a tab slip should say it is owed.',
        ],
        make: 'Settle a table with Pay later (needs a manager).',
    },
    {
        n: 7, title: 'Discount or promotion',
        find: async () => {
            const s = await prisma.tableSession.findFirst({
                where: { ...closed, OR: [{ discountValue: { gt: 0 } }, { promoId: { not: null } }] },
                ...latest,
            })
            return s && bill(s.id)
        },
        look: [
            'A "-" discount line between the subtotal and the total.',
            'Items add up to the gross; gross minus discount equals the total.',
        ],
        make: 'Apply a discount or a promotion to a table, then settle it.',
    },
    {
        n: 8, title: 'Package with an exchange',
        find: async () => {
            const w = await prisma.packageSwap.findFirst({
                where: { reversedAt: null, session: closed },
                orderBy: { createdAt: 'desc' },
            })
            return w && bill(w.sessionId)
        },
        look: [
            'Under the set: what went out and what came in, by name and count.',
            'If the swap cost more, the difference is its own priced line - not folded into the set price.',
        ],
        make: 'Sell a package set, exchange one of its drinks, settle.',
    },
    {
        n: 9, title: 'A voided line',
        find: async () => {
            const i = await prisma.orderItem.findFirst({
                where: { voidedAt: { not: null }, order: { session: closed } },
                include: { order: true },
                orderBy: { voidedAt: 'desc' },
            })
            if (!i) return null
            return { path: bill(i.order.sessionId), hint: `Voided: ${i.quantity}x ${i.name}` }
        },
        look: [
            'The voided item (named above) is NOT on the slip.',
            'The total does not include it: add up the lines that are printed.',
        ],
        make: 'Send a round, void one line with a reason, settle.',
    },
    {
        n: 10, title: 'Same drink over several rounds (merged)',
        find: async () => {
            const sessions = await prisma.tableSession.findMany({
                where: closed, include: { orders: { include: { items: { where: { voidedAt: null } } } } }, ...latest, take: 200,
            })
            for (const s of sessions) {
                const seen = new Map()
                for (const o of s.orders) for (const name of new Set(o.items.map((i) => i.name))) seen.set(name, (seen.get(name) ?? 0) + 1)
                const repeat = [...seen].find(([, rounds]) => rounds > 1)
                if (repeat) return { path: bill(s.id), hint: `${repeat[0]} was ordered in ${repeat[1]} rounds` }
            }
            return null
        },
        look: [
            'The drink named above is ONE line with the combined quantity.',
            'A line with a note ("no ice") stays separate from the same drink without one.',
        ],
        make: 'Send the same drink to one table in two rounds, settle.',
    },
    {
        n: 11, title: 'Two waiters on one table',
        find: async () => {
            const sessions = await prisma.tableSession.findMany({ where: closed, include: { orders: true }, ...latest, take: 200 })
            const s = sessions.find((x) => new Set(x.orders.map((o) => o.waiterId).filter(Boolean)).size > 1)
            return s && bill(s.id)
        },
        look: [
            'The Server line names both waiters.',
            'A long pair of names wraps cleanly rather than running off the edge.',
        ],
        make: 'Two waiters each send a round to the same table, settle.',
    },
    {
        n: 12, title: 'Counter sale, cash with change',
        find: async () => {
            const orders = await prisma.order.findMany({
                where: { sessionId: null, paymentMethod: 'CASH', cashReceived: { not: null } },
                orderBy: { createdAt: 'desc' }, take: 50,
            })
            const o = orders.find((x) => x.cashReceived > x.total) ?? orders[0]
            return o && sale(o.id)
        },
        look: [
            'Order number at the top instead of a table.',
            '"Cash received" and "Change": change = received minus total.',
            'Known: the date prints US-style (9/2/2026, 10:16 PM) while table bills print 02/09/2026 22:16. A customer cannot tell 9 Feb from 2 Sep.',
        ],
        make: 'Ring up a walk-in sale, pay cash with more than the total.',
    },
    {
        n: 13, title: 'Counter sale, transfer / QR',
        find: async () => {
            const o = await prisma.order.findFirst({ where: { sessionId: null, paymentMethod: { not: 'CASH' } }, orderBy: { createdAt: 'desc' } })
            return o && sale(o.id)
        },
        look: [
            'No cash received or change lines.',
            'Known: the slip does not say how it was paid (transfer / QR).',
        ],
        make: 'Ring up a walk-in sale paid by OnePay / transfer.',
    },
    {
        n: 14, title: 'Counter sale with a beeper number',
        find: async () => {
            const o = await prisma.order.findFirst({ where: { beeperNumber: { not: null } }, orderBy: { createdAt: 'desc' } })
            return o && sale(o.id)
        },
        look: ['"BEEPER: n" near the top, big enough to read at arm\'s length.'],
        make: 'Ring up a walk-in sale and enter a beeper number before paying.',
    },
    {
        n: 15, title: 'Drink options and takeaway',
        find: async () => {
            const items = await prisma.orderItem.findMany({
                where: { order: { sessionId: null }, OR: [{ sugarLevel: { not: null } }, { shotType: { not: null } }, { cupSize: { not: null } }, { isTakeaway: true }] },
                orderBy: { order: { createdAt: 'desc' } }, take: 300,
            })
            const i = items.find((x) => x.isTakeaway || !isStandard(x.sugarLevel) || !isStandard(x.shotType) || !isStandard(x.cupSize))
            return i && sale(i.orderId)
        },
        look: [
            'Under the item: the sugar level, shot type or size that was picked.',
            '"Normal" options are NOT printed - only the ones that differ.',
            'A takeaway item is marked as takeaway.',
        ],
        make: 'Ring up a walk-in drink with 50% sugar or a double shot, and one takeaway.',
    },
    {
        n: 16, title: 'Longest Lao name',
        find: async () => {
            const items = await prisma.orderItem.findMany({
                where: { voidedAt: null, order: { session: closed } }, select: { name: true, order: { select: { sessionId: true } } },
                orderBy: { order: { createdAt: 'desc' } }, take: 2000,
            })
            const lao = items.filter((i) => /[຀-໿]/.test(i.name)).sort((a, b) => b.name.length - a.name.length)[0]
            return lao && { path: bill(lao.order.sessionId), hint: `Longest name: ${lao.name}` }
        },
        look: [
            'The Lao letters are whole: tone marks and vowels above/below are not clipped.',
            'The long name wraps onto a second line instead of pushing the price off the edge.',
        ],
        make: 'Sell an item with a long Lao name.',
    },
    {
        n: 17, title: 'Long bill',
        find: async () => {
            const sessions = await prisma.tableSession.findMany({
                where: closed, include: { orders: { include: { items: { where: { voidedAt: null } } } } }, ...latest, take: 300,
            })
            let best = null
            for (const s of sessions) {
                const lines = new Set(s.orders.flatMap((o) => o.items.map((i) => `${i.name}:${i.note ?? ''}`))).size
                if (!best || lines > best.lines) best = { id: s.id, lines }
            }
            return best && { path: bill(best.id), hint: `${best.lines} lines` }
        },
        look: [
            'One continuous slip: it does not stop early or split into pages.',
            'The total and footer at the end are all there.',
        ],
        make: 'Send 15+ different items to one table, settle.',
    },
    {
        n: 18, title: 'Shop header and footer from Settings',
        find: async () => {
            const s = await prisma.tableSession.findFirst({ where: closed, ...latest })
            const set = await prisma.setting.findMany({ where: { key: { in: ['shopLogo', 'shopAddress', 'shopPhone', 'receiptFooter'] } } })
            const empty = set.filter((x) => !x.value).map((x) => x.key)
            return s && { path: bill(s.id), hint: empty.length ? `Empty in Settings now: ${empty.join(', ')} - fill them in first to test them` : 'All header fields are filled in' }
        },
        look: [
            'The logo prints as a clean black-and-white mark, not a grey smudge.',
            'Address and phone under the shop name; the custom footer at the end.',
        ],
        make: 'Fill in logo, address, phone and footer in Settings.',
    },
    {
        n: 19, title: 'USD line',
        find: async () => {
            const on = await prisma.setting.findUnique({ where: { key: 'show_usd' } })
            if (on?.value !== 'true') return null
            const s = await prisma.tableSession.findFirst({ where: { ...closed, fxRateUSD: { not: null } }, ...latest })
            return s && bill(s.id)
        },
        look: ['The total in USD at the night\'s rate, next to the kip line.'],
        make: 'Switch "Show USD" on in Settings, then settle a table.',
    },
    {
        n: 20, title: 'Old bill without a stored VAT rate',
        find: async () => {
            const s = await prisma.tableSession.findFirst({ where: { ...closed, taxRate: null }, ...latest })
            return s && bill(s.id)
        },
        look: ['No VAT line at all - on purpose: the rate was never saved for this bill, so it is not guessed.'],
        make: 'Only bills from before the VAT rate was stamped have this. Nothing to make.',
    },
]

const MANUAL = [
    'Reprint: Orders page -> the bill from case 4 -> Receipt -> Print. It must match the first print exactly.',
    'Grey text: on any slip above, the dates and small labels are still readable, not faded out.',
]

function open(path) {
    // explorer hands a URL to the default browser and, unlike `start`, does not
    // choke on the & in a query string.
    spawn('explorer.exe', [`${BASE}${path}`], { detached: true, stdio: 'ignore' }).unref()
}

async function main() {
    const args = process.argv.slice(2)
    const listOnly = args.includes('--list')
    const only = args.filter((a) => /^\d+$/.test(a)).map(Number)
    const cases = only.length ? CASES.filter((c) => only.includes(c.n)) : CASES

    const up = await fetch(`${BASE}/api/settings`).catch(() => null)
    if (!up?.ok) {
        console.error(`The app is not answering at ${BASE}. Start it first: npm run dev`)
        process.exit(1)
    }

    const found = []
    for (const c of cases) {
        const r = await c.find()
        const hit = typeof r === 'string' ? { path: r } : r
        found.push({ ...c, hit })
    }

    if (listOnly) {
        for (const c of found) console.log(`${String(c.n).padStart(2)}. ${c.title.padEnd(44)} ${c.hit ? BASE + c.hit.path : '-- none: ' + c.make}`)
        return
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const results = []
    console.log('\nFor each case the receipt opens in your browser. Press Print there, pick the')
    console.log('receipt printer, check the paper, then answer here.\n')

    for (const c of found) {
        console.log(`\n=== ${c.n}. ${c.title} ===`)
        if (!c.hit) {
            console.log(`No bill like this in the database. To make one: ${c.make}`)
            results.push({ n: c.n, title: c.title, verdict: 'NO DATA', note: c.make })
            continue
        }
        if (c.hit.hint) console.log(c.hit.hint)
        console.log(`${BASE}${c.hit.path}`)
        console.log('Look for:')
        for (const l of c.look) console.log(`  - ${l}`)
        open(c.hit.path)

        let verdict = null
        while (!verdict) {
            const a = (await rl.question('[p]ass  [f]ail  [s]kip  [r]eopen  [q]uit > ')).trim().toLowerCase()
            if (a === 'r') open(c.hit.path)
            else if (a === 'p') verdict = 'PASS'
            else if (a === 'f') verdict = 'FAIL'
            else if (a === 's') verdict = 'SKIP'
            else if (a === 'q') verdict = 'QUIT'
        }
        if (verdict === 'QUIT') break
        const note = verdict === 'FAIL' ? (await rl.question('What was wrong? > ')).trim() : ''
        results.push({ n: c.n, title: c.title, verdict, note, url: `${BASE}${c.hit.path}` })
    }

    console.log('\nTwo more by hand:')
    for (const m of MANUAL) console.log(`  - ${m}`)
    rl.close()

    const md = [
        `# Receipt check - ${new Date().toLocaleString('en-GB')}`, '',
        '| # | Case | Result | Note |', '|---|---|---|---|',
        ...results.map((r) => `| ${r.n} | ${r.title} | ${r.verdict} | ${(r.note || '').replace(/\|/g, '/')} |`),
        '', ...MANUAL.map((m) => `- [ ] ${m}`), '',
    ].join('\n')
    writeFileSync('receipt-check-results.md', md)

    const tally = (v) => results.filter((r) => r.verdict === v).length
    console.log(`\n${tally('PASS')} pass, ${tally('FAIL')} fail, ${tally('SKIP')} skipped, ${tally('NO DATA')} without a bill.`)
    console.log('Written to receipt-check-results.md')
}

main()
    .catch((e) => { console.error(e); process.exitCode = 1 })
    .finally(() => prisma.$disconnect())
