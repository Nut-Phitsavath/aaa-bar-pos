/**
 * Flow check for the ordering, exchange and restock test cases.
 *
 * `checkRoutes.js` calls the report endpoints one at a time and looks at the
 * shape that comes back. This one is the other half: it plays a whole table
 * through the routes in the order a floor actually uses them - open a bill, two
 * waiters key two rounds, a line is struck with a reason, a package is
 * exchanged twice, unopened bottles go back on the shelf - and asserts what
 * each step did to the bill, to the audit log and to the count.
 *
 * Every one of these was only ever verified by reading the code. The layer this
 * covers is the one between a route and its screen, where the bugs live.
 *
 *   npm run dev                       (or npm start)
 *   npm run check:flows               defaults to http://localhost:3000
 *   BASE=http://localhost:3131 npm run check:flows
 *
 * Writes to the database it points at, then puts it back: the bill it opened is
 * deleted, the stock it moved is restored from a snapshot taken at the start.
 * Dev data only - do not point it at the bar's live database.
 */

const net = require('node:net')
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()
const BASE = process.env.BASE || 'http://localhost:3000'
const USER = process.env.POS_USER || 'admin'
const PIN = process.env.POS_PIN || '1675'

const failures = []
let cookie = ''

function check(name, ok, detail) {
    console.log(`${ok ? '  ok  ' : 'FAIL  '}${name}${detail ? `  ${detail}` : ''}`)
    if (!ok) failures.push(name)
}

async function api(method, path, body) {
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers: { cookie, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    })
    const type = res.headers.get('content-type') || ''
    const out = type.includes('json') ? await res.json().catch(() => null) : null
    return { status: res.status, body: out }
}

/**
 * A thermal printer, played by a socket.
 *
 * ESC/POS over port 9100 is "open a socket and write bytes", so a printer is
 * exactly this much: something that listens and keeps what it was sent. It is
 * the only way to check the routing before the real printers are on the LAN.
 */
function fakePrinter(port) {
    const chunks = []
    const server = net.createServer((socket) => {
        socket.on('data', (data) => chunks.push(data))
    })
    server.listen(port, '127.0.0.1')
    return {
        port,
        text: () => Buffer.concat(chunks).toString('utf8'),
        close: () => new Promise((done) => server.close(done)),
    }
}

/** Paper arrives a moment after the write resolves. */
async function waitFor(condition, ms = 2000) {
    const until = Date.now() + ms
    while (Date.now() < until) {
        if (condition()) return true
        await new Promise((r) => setTimeout(r, 50))
    }
    return condition()
}

/** The one ingredient a single-serve item is, so a stock delta can be read. */
function soleIngredient(menu) {
    return menu.recipes.length === 1 ? menu.recipes[0].ingredientId : null
}

async function subStockOf(ingredientIds) {
    const rows = await prisma.ingredient.findMany({
        where: { id: { in: ingredientIds } },
        select: { id: true, subStock: true },
    })
    return new Map(rows.map((r) => [r.id, r.subStock]))
}

/** Menu items this check needs, discovered rather than hardcoded by name. */
async function pickMenu() {
    const menus = await prisma.menu.findMany({
        where: { isAvailable: true, price: { gt: 0 } },
        include: {
            category: { select: { name: true } },
            recipes: { include: { ingredient: { select: { measureType: true } } } },
        },
        orderBy: { name: 'asc' },
    })

    // The same rule lib/packages.ts uses: one recipe line, one whole unit.
    const components = menus.filter(
        (m) =>
            m.recipes.length === 1 &&
            m.recipes[0].quantity === 1 &&
            m.recipes[0].ingredient.measureType === 'EACH',
    )
    const componentIds = new Set(components.map((m) => m.recipes[0].ingredientId))

    // A package is a line whose recipe holds several things the bar sells singly.
    const pkg = menus.find(
        (m) =>
            m.recipes.length > 1 &&
            m.recipes.filter((r) => componentIds.has(r.ingredientId) && r.quantity >= 2).length >= 2,
    )

    const inPackage = (m) =>
        pkg && pkg.recipes.some((r) => r.ingredientId === soleIngredient(m) && r.quantity >= 2)

    // Cheapest and dearest of the package's own contents: one exchange trades
    // down (no charge), the next trades the result back up (charged).
    const held = components.filter(inPackage).sort((a, b) => a.price - b.price)
    const cheap = components.filter((m) => !inPackage(m)).sort((a, b) => a.price - b.price)[0]
    const plain = held[0]
    const dear = held[held.length - 1]

    return {
        pkg,
        plain,
        dear,
        cheap,
        // Never ordered on this bill, so restocking it must be refused.
        stranger: components.find((m) => m !== cheap && !inPackage(m)),
        food: menus.find((m) => /snack|food|kitchen/i.test(m.category.name)),
    }
}

async function main() {
    console.log(`${BASE}\n`)

    const login = await fetch(`${BASE}/api/auth/pin-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: USER, pin: PIN }),
    }).catch(() => null)

    if (!login) {
        console.error(`Nothing answering on ${BASE}. Start the server first, or set BASE.`)
        process.exitCode = 1
        return
    }
    if (login.status !== 200) {
        console.error(`Could not sign in as "${USER}" (${login.status}). Set POS_USER / POS_PIN.`)
        process.exitCode = 1
        return
    }
    cookie = (login.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ')

    const menu = await pickMenu()
    if (!menu.pkg || !menu.plain || !menu.dear || !menu.cheap || !menu.stranger) {
        console.error('This database has no package with two swappable components. Seed one first.')
        process.exitCode = 1
        return
    }

    const waiters = (await api('GET', '/api/waiters')).body ?? []
    if (waiters.length < 2) {
        console.error('Need two waiters on file to key two rounds.')
        process.exitCode = 1
        return
    }
    const [kham, nok] = waiters

    const table = (
        await prisma.table.findMany({
            where: { isActive: true, sessions: { none: { status: { not: 'CLOSED' } } } },
            orderBy: { displayOrder: 'asc' },
        })
    )[0]
    if (!table) {
        console.error('No free table to open a bill on.')
        process.exitCode = 1
        return
    }

    // Every route in the money path refuses to run with the night closed.
    const openShift = await prisma.shift.findFirst({ where: { status: 'OPEN' } })
    const shift = openShift ?? (await prisma.shift.create({ data: { startCash: 0, status: 'OPEN' } }))

    // Restored at the end, so running this twice does not drift the count.
    const watched = [menu.plain, menu.dear, menu.cheap, menu.stranger, menu.food]
        .filter(Boolean)
        .map(soleIngredient)
        .filter(Boolean)
    const openingStock = await subStockOf(watched)
    const startedAt = new Date()

    // The printer addresses are settings, so the check borrows them and puts
    // the owner's values back afterwards.
    const PRINTER_KEYS = ['printer_bar', 'printer_kitchen']
    const savedPrinters = await prisma.setting.findMany({ where: { key: { in: PRINTER_KEYS } } })
    const setSetting = (key, value) =>
        prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } })

    let sessionId = null
    let printersUsed = []
    try {
        const opened = await api('POST', '/api/table-sessions', { tableId: table.id })
        sessionId = opened.body?.id ?? opened.body?.session?.id
        check(`bill opens on ${table.name}`, opened.status === 200 && Boolean(sessionId), String(opened.status))
        if (!sessionId) return

        // ---- TC-ORD-001: modifiers and a preparation note reach the line ----
        const NOTE = 'Extra Mint & Less Ice'
        const round1 = await api('POST', '/api/orders', {
            sessionId,
            waiterId: kham.id,
            status: 'SENT',
            items: [
                { menuId: menu.dear.id, name: menu.dear.name, price: menu.dear.price, quantity: 1, sugarLevel: '50%', note: NOTE },
                { menuId: menu.plain.id, name: menu.plain.name, price: menu.plain.price, quantity: 2 },
            ],
            total: menu.dear.price + menu.plain.price * 2,
            subtotal: menu.dear.price + menu.plain.price * 2,
            tax: 0,
            discount: 0,
        })
        check('TC-ORD-001 round with a note is accepted', round1.status === 200, String(round1.status))

        let bill = (await api('GET', `/api/table-sessions/${sessionId}`)).body
        const noted = bill?.orders?.[0]?.items?.find((i) => i.menuId === menu.dear.id)
        check('TC-ORD-001 note is stored on the line', noted?.note === NOTE, noted?.note ?? 'missing')
        check('TC-ORD-001 modifier is stored on the line', noted?.sugarLevel === '50%', noted?.sugarLevel ?? 'missing')
        check(
            'TC-ORD-001 line is priced from the menu, not the cart',
            noted?.price === menu.dear.price && noted?.total === menu.dear.price,
            `${noted?.price} x1 = ${noted?.total}`,
        )

        // ---- TC-ORD-002: two waiters, two rounds, one bill ----
        const second = menu.food ?? menu.cheap
        const round2 = await api('POST', '/api/orders', {
            sessionId,
            waiterId: nok.id,
            status: 'SENT',
            items: [{ menuId: second.id, name: second.name, price: second.price, quantity: 1 }],
            total: second.price,
            subtotal: second.price,
            tax: 0,
            discount: 0,
        })
        check('TC-ORD-002 second waiter keys a second round', round2.status === 200, String(round2.status))

        const unattributed = await api('POST', '/api/orders', {
            sessionId,
            status: 'SENT',
            items: [{ menuId: second.id, name: second.name, price: second.price, quantity: 1 }],
            total: second.price, subtotal: second.price, tax: 0, discount: 0,
        })
        check('TC-ORD-002 a round with no waiter is refused', unattributed.status === 400, String(unattributed.status))

        bill = (await api('GET', `/api/table-sessions/${sessionId}`)).body
        const [r1, r2] = bill.orders
        check(
            'TC-ORD-002 each round carries its own waiter',
            r1?.waiter?.id === kham.id && r2?.waiter?.id === nok.id,
            `${r1?.waiter?.name} / ${r2?.waiter?.name}`,
        )
        check(
            'TC-ORD-002 both rounds are on the one bill, numbered in order',
            bill.orders.length === 2 && r1.tableOrderNumber === 1 && r2.tableOrderNumber === 2,
            `rounds ${bill.orders.length}`,
        )

        // ---- TC-ORD-003: item void needs a reason and leaves a record ----
        const target = r2.items[0]
        const foodIngredient = soleIngredient(second)
        const beforeVoid = await subStockOf(watched)
        const billBefore = bill.total

        const noReason = await api('POST', `/api/orders/${r2.id}/void`, { itemIds: [target.id] })
        check(
            'TC-ORD-003 a void with no reason is refused',
            noReason.status === 400 && noReason.body?.error === 'VOID_REASON_REQUIRED',
            `${noReason.status} ${noReason.body?.error ?? ''}`,
        )

        const voided = await api('POST', `/api/orders/${r2.id}/void`, {
            itemIds: [target.id],
            reason: 'CUSTOMER_CHANGED',
            note: 'ordered by mistake',
        })
        check('TC-ORD-003 the line is struck with a reason', voided.status === 200, String(voided.status))

        const struck = await prisma.orderItem.findUnique({ where: { id: target.id } })
        check(
            'TC-ORD-003 the void log carries who, when and why',
            Boolean(struck?.voidedAt) && struck?.voidReason === 'CUSTOMER_CHANGED' && Boolean(struck?.voidedById),
            `${struck?.voidReason} by ${struck?.voidedById ? 'a named user' : 'nobody'}`,
        )
        check(
            'TC-ORD-003 the line is kept, not deleted',
            struck !== null && struck.total === second.price,
            struck ? 'kept' : 'gone',
        )

        bill = (await api('GET', `/api/table-sessions/${sessionId}`)).body
        check(
            'TC-ORD-003 the struck line comes off the bill total',
            Math.abs(bill.total - (billBefore - second.price)) < 0.01,
            `${billBefore} -> ${bill.total}`,
        )
        if (foodIngredient) {
            const after = await subStockOf(watched)
            const back = after.get(foodIngredient) - beforeVoid.get(foodIngredient)
            check(
                'TC-ORD-003 the void puts its stock back',
                Math.abs(back - (second.recipes[0]?.quantity ?? 0)) < 0.001,
                `+${back}`,
            )
        }
        const voidReport = await api(
            'GET',
            `/api/reports/voids?startDate=${startedAt.toISOString()}&endDate=${new Date().toISOString()}`,
        )
        check(
            'TC-ORD-003 the void report reads it back',
            voidReport.status === 200 && voidReport.body?.rows?.some((r) => r.reason === 'CUSTOMER_CHANGED'),
            String(voidReport.status),
        )

        // ---- TC-EXC-001: trade a package's contents down, nothing charged ----
        const round3 = await api('POST', '/api/orders', {
            sessionId,
            waiterId: nok.id,
            status: 'SENT',
            items: [{ menuId: menu.pkg.id, name: menu.pkg.name, price: menu.pkg.price, quantity: 1 }],
            total: menu.pkg.price, subtotal: menu.pkg.price, tax: 0, discount: 0,
        })
        check('TC-EXC-001 the package is ordered', round3.status === 200, String(round3.status))

        bill = (await api('GET', `/api/table-sessions/${sessionId}`)).body
        const pkgLine = bill.orders.at(-1).items.find((i) => i.menuId === menu.pkg.id)
        const totalBeforeSwap = bill.total
        const beforeDown = await subStockOf(watched)

        // Out: two of the dearest content and two of the plain one. In: the same
        // number of the cheapest thing on the menu, which must cost less.
        const outQty = 2
        const outValue = menu.dear.price * outQty + menu.plain.price * outQty
        const inQty = 4
        const downSwap = await api('POST', `/api/order-items/${pkgLine.id}/swap`, {
            removing: [
                { menuId: menu.dear.id, quantity: outQty },
                { menuId: menu.plain.id, quantity: outQty },
            ],
            adding: [{ menuId: menu.cheap.id, quantity: inQty }],
        })
        const downCharge = menu.cheap.price * inQty
        check('TC-EXC-001 the swap is approved', downSwap.status === 200, `${downSwap.status} ${downSwap.body?.error ?? ''}`)
        check(
            'TC-EXC-001 trading down charges nothing',
            downSwap.body?.charged === 0 && downCharge < outValue,
            `out ${outValue} in ${downCharge} charged ${downSwap.body?.charged}`,
        )

        bill = (await api('GET', `/api/table-sessions/${sessionId}`)).body
        check(
            'TC-EXC-001 the bill total does not move',
            Math.abs(bill.total - totalBeforeSwap) < 0.01,
            `${totalBeforeSwap} -> ${bill.total}`,
        )

        const afterDown = await subStockOf(watched)
        const delta = (id, map) => Math.round((map.get(id) - beforeDown.get(id)) * 1000) / 1000
        check(
            'TC-EXC-001 what came out goes back on the shelf',
            delta(soleIngredient(menu.dear), afterDown) === outQty &&
                delta(soleIngredient(menu.plain), afterDown) === outQty,
            `${menu.dear.name} +${delta(soleIngredient(menu.dear), afterDown)}, ${menu.plain.name} +${delta(soleIngredient(menu.plain), afterDown)}`,
        )
        check(
            'TC-EXC-001 what went in is deducted',
            delta(soleIngredient(menu.cheap), afterDown) === -inQty,
            `${menu.cheap.name} ${delta(soleIngredient(menu.cheap), afterDown)}`,
        )

        // ---- TC-EXC-002: trade the result back up, difference charged ----
        const upOut = 2
        const upIn = 2
        const expected = Math.round((menu.dear.price * upIn - menu.cheap.price * upOut) * 100) / 100
        const totalBeforeUp = bill.total
        const upSwap = await api('POST', `/api/order-items/${pkgLine.id}/swap`, {
            removing: [{ menuId: menu.cheap.id, quantity: upOut }],
            adding: [{ menuId: menu.dear.id, quantity: upIn }],
        })
        check('TC-EXC-002 the dearer swap is approved', upSwap.status === 200, `${upSwap.status} ${upSwap.body?.error ?? ''}`)
        check(
            'TC-EXC-002 the difference is what is charged',
            upSwap.body?.charged === expected,
            `expected ${expected}, got ${upSwap.body?.charged}`,
        )

        bill = (await api('GET', `/api/table-sessions/${sessionId}`)).body
        const chargeLine = bill.orders
            .flatMap((o) => o.items)
            .find((i) => !i.voidedAt && /Exchange difference/i.test(i.name))
        check(
            'TC-EXC-002 the difference reaches the bill as its own line',
            chargeLine?.total === expected && Math.abs(bill.total - (totalBeforeUp + expected)) < 0.01,
            `line ${chargeLine?.total}, bill ${totalBeforeUp} -> ${bill.total}`,
        )

        // ---- TC-EXC-003: both swaps are readable as an audit trail ----
        const audit = await api(
            'GET',
            `/api/reports/exchanges?startDate=${startedAt.toISOString()}&endDate=${new Date().toISOString()}`,
        )
        const rows = audit.body?.swaps ?? []
        const mine = rows.filter((r) => r.table === table.name && new Date(r.at) >= startedAt)
        check('TC-EXC-003 the exchange report answers', audit.status === 200, String(audit.status))
        check('TC-EXC-003 both swaps are logged', mine.length === 2, `${mine.length} of 2`)
        const one = mine[0]
        check(
            'TC-EXC-003 a row names the table, the staff, both directions and the difference',
            Boolean(one?.table) &&
                Boolean(one?.staff) &&
                (one?.out?.length ?? 0) > 0 &&
                (one?.in?.length ?? 0) > 0 &&
                typeof one?.charged === 'number' &&
                Boolean(one?.at),
            one ? Object.keys(one).join(',') : 'no rows',
        )

        // ---- TC-REST-001: unopened bottles go back on the shelf ----
        const returnable = (await api('GET', `/api/table-sessions/${sessionId}/returns`)).body?.items ?? []
        const giveBack = returnable.find((i) => i.quantity >= 2)
        check('TC-REST-001 the cleanup screen lists what the table still holds', giveBack !== undefined,
            returnable.map((i) => `${i.name} x${i.quantity}`).join(', ') || 'nothing')

        // Four traded in, two traded back out: two are standing on the table.
        // Offering four here is two bottles of stock invented at cleanup.
        const swappedIn = returnable.find((i) => i.menuId === menu.cheap.id)
        check(
            'TC-REST-001 a drink swapped in and then out again is not offered twice',
            swappedIn?.quantity === inQty - upOut,
            `${menu.cheap.name} x${swappedIn?.quantity ?? 0}, expected ${inQty - upOut}`,
        )
        if (giveBack) {
            const beforeReturn = await subStockOf(watched)
            const restocked = await api('POST', `/api/table-sessions/${sessionId}/returns`, {
                items: [{ menuId: giveBack.menuId, quantity: 2 }],
            })
            check('TC-REST-001 the count is recorded', restocked.status === 200 && restocked.body?.returned === 2,
                `${restocked.status} returned ${restocked.body?.returned}`)

            const afterReturn = await subStockOf(watched)
            const ing = (await prisma.recipe.findFirst({ where: { menuId: giveBack.menuId } }))?.ingredientId
            const moved = ing && afterReturn.has(ing)
                ? Math.round((afterReturn.get(ing) - beforeReturn.get(ing)) * 1000) / 1000
                : null
            check('TC-REST-001 physical stock goes up by what came back', moved === 2 || moved === null,
                moved === null ? 'ingredient not watched' : `+${moved}`)

            const left = restocked.body?.items?.find((i) => i.menuId === giveBack.menuId)
            check('TC-REST-001 the same bottles cannot be handed back twice',
                (left?.quantity ?? 0) === giveBack.quantity - 2,
                `${giveBack.quantity} -> ${left?.quantity ?? 0}`)

            const billAfterReturn = (await api('GET', `/api/table-sessions/${sessionId}`)).body
            check('TC-REST-001 the bar keeps the money: the bill does not move',
                Math.abs(billAfterReturn.total - bill.total) < 0.01,
                `${bill.total} -> ${billAfterReturn.total}`)
        }

        // ---- TC-REST-002: restocking something the table never had ----
        const notOurs = await api('POST', `/api/table-sessions/${sessionId}/returns`, {
            items: [{ menuId: menu.stranger.id, quantity: 2 }],
        })
        check(
            `TC-REST-002 restocking ${menu.stranger.name} (never ordered here) is refused`,
            notOurs.status === 409 && notOurs.body?.error === 'NOT_ON_THIS_BILL',
            `${notOurs.status} ${notOurs.body?.error ?? ''}`,
        )

        // ---- TC-ORD-005: food to the kitchen, drinks to the bar ----
        if (!menu.food) {
            check('TC-ORD-005 skipped: no kitchen category on this menu', false)
        } else {
            const bar = fakePrinter(9911)
            const kitchen = fakePrinter(9912)
            printersUsed = [bar, kitchen]
            await setSetting('printer_bar', '127.0.0.1:9911')
            await setSetting('printer_kitchen', '127.0.0.1:9912')

            const mixed = await api('POST', '/api/orders', {
                sessionId,
                waiterId: kham.id,
                status: 'SENT',
                items: [
                    { menuId: menu.food.id, name: menu.food.name, price: menu.food.price, quantity: 1 },
                    { menuId: menu.plain.id, name: menu.plain.name, price: menu.plain.price, quantity: 2 },
                ],
                total: menu.food.price + menu.plain.price * 2,
                subtotal: menu.food.price + menu.plain.price * 2,
                tax: 0, discount: 0,
            })
            check('TC-ORD-005 the mixed round is sent', mixed.status === 200, String(mixed.status))
            check(
                'TC-ORD-005 both printers are reported as printed',
                (mixed.body?.dockets ?? []).length === 2 && mixed.body.dockets.every((d) => d.ok),
                JSON.stringify(mixed.body?.dockets ?? []),
            )

            await waitFor(() => bar.text() && kitchen.text())
            check('TC-ORD-005 the bar ticket holds the drink', bar.text().includes(menu.plain.name),
                bar.text().split('\n')[0]?.trim() || 'nothing printed')
            check('TC-ORD-005 the bar ticket does not hold the food', !bar.text().includes(menu.food.name))
            check('TC-ORD-005 the kitchen docket holds the food', kitchen.text().includes(menu.food.name),
                kitchen.text().split('\n')[0]?.trim() || 'nothing printed')
            check('TC-ORD-005 the kitchen docket does not hold the drink', !kitchen.text().includes(menu.plain.name))
            check('TC-ORD-005 each docket names its table and cuts the paper',
                kitchen.text().includes(table.name) && kitchen.text().includes('\x1dVB'),
                `${kitchen.text().includes(table.name) ? 'table' : 'NO table'} · ${kitchen.text().includes('\x1dVB') ? 'cut' : 'NO cut'}`)

            // A printer that is off must not fail the round, and must say so.
            await setSetting('printer_kitchen', '127.0.0.1:9913')
            const unplugged = await api('POST', '/api/orders', {
                sessionId,
                waiterId: kham.id,
                status: 'SENT',
                items: [{ menuId: menu.food.id, name: menu.food.name, price: menu.food.price, quantity: 1 }],
                total: menu.food.price, subtotal: menu.food.price, tax: 0, discount: 0,
            })
            check('TC-ORD-005 a dead printer does not lose the order', unplugged.status === 200, String(unplugged.status))
            check(
                'TC-ORD-005 a dead printer is reported to the till',
                (unplugged.body?.dockets ?? []).some((d) => d.station === 'KITCHEN' && !d.ok),
                JSON.stringify(unplugged.body?.dockets ?? []),
            )
        }
    } finally {
        for (const printer of printersUsed) await printer.close()
        // The owner's addresses back, including "not set" if that is what they were.
        for (const key of PRINTER_KEYS) {
            const saved = savedPrinters.find((s) => s.key === key)
            if (saved) await setSetting(key, saved.value)
            else await prisma.setting.deleteMany({ where: { key } })
        }

        // Put the database back: the bill, its rounds, the stock it moved.
        if (sessionId) {
            const orders = await prisma.order.findMany({ where: { sessionId }, select: { id: true } })
            const ids = orders.map((o) => o.id)
            await prisma.packageSwap.deleteMany({ where: { sessionId } })
            await prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } })
            await prisma.order.deleteMany({ where: { id: { in: ids } } })
            await prisma.tableSession.deleteMany({ where: { id: sessionId } })
            await prisma.table.update({ where: { id: table.id }, data: { needsClearing: false } })
        }
        await prisma.stockTransaction.deleteMany({ where: { createdAt: { gte: startedAt } } })
        for (const [id, subStock] of openingStock) {
            await prisma.ingredient.update({ where: { id }, data: { subStock } })
        }
        if (!openShift) await prisma.shift.delete({ where: { id: shift.id } })
        console.log('\n  (test bill removed, stock restored)')
    }

    console.log(
        failures.length === 0
            ? `\n${'-'.repeat(40)}\nall flows pass`
            : `\n${'-'.repeat(40)}\n${failures.length} failing:\n  ${failures.join('\n  ')}`,
    )
    if (failures.length) process.exitCode = 1
}

main()
    .catch((e) => {
        console.error(e)
        process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
