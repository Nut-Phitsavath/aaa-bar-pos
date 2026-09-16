/**
 * Smoke check for the report endpoints.
 *
 * There are 83 API routes in this app and, before this file, zero tests that
 * called one. `lib/` is well covered - 22 test files, 270-odd assertions - but
 * every bug found on 2026-09-16 lived in the layer between a route and its
 * screen, where nothing was looking:
 *
 *   - /api/reports/variance returned 500 on EVERY request, from the day it was
 *     written, because it stapled a second timestamp onto one the page already
 *     sent. Its component renders the same empty state for a failed fetch as
 *     for an empty period, so the screen looked correct and only the terminal
 *     ever said otherwise.
 *   - /api/reports/refunds answered with cancelled orders under a heading
 *     promising refunds.
 *   - /api/reports/export disagreed with the page it sits on by the whole
 *     per-table discount.
 *
 * None of those need a clever test. They need SOMETHING to call the route with
 * the parameters the page actually sends and look at what comes back. That is
 * all this does.
 *
 * Deliberately not a unit test suite. These routes are a database query and a
 * response shape; mocking Prisma to test them in isolation would test the mock.
 * Pointing it at a running server tests the thing that ships.
 *
 *   npm run dev                       (or npm start)
 *   npm run check:routes              defaults to http://localhost:3000
 *   BASE=http://localhost:3131 npm run check:routes
 *
 * Exits non-zero on the first failure, so it works in a pre-push hook.
 */

const BASE = process.env.BASE || 'http://localhost:3000'
const USER = process.env.POS_USER || 'admin'
const PIN = process.env.POS_PIN || '1675'

// The exact shape the reports page sends: a full ISO timestamp, already snapped
// to the start and end of the day in the bar's timezone. Passing a bare date
// here would have hidden the variance bug completely.
const END = new Date()
const START = new Date(END.getTime() - 30 * 24 * 60 * 60 * 1000)
const RANGE = `startDate=${START.toISOString()}&endDate=${END.toISOString()}`
const TODAY = END.toISOString().split('T')[0]

const failures = []
let cookie = ''

function check(name, ok, detail) {
    console.log(`${ok ? '  ok' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`)
    if (!ok) failures.push(name)
}

async function get(path) {
    const res = await fetch(`${BASE}${path}`, { headers: { cookie } })
    let body = null
    const type = res.headers.get('content-type') || ''
    if (type.includes('json')) body = await res.json().catch(() => null)
    return { status: res.status, body, type }
}

/** Every reports route, with what a correct answer looks like. */
const ROUTES = [
    ['analytics', `/api/reports/analytics?${RANGE}`, (b) =>
        b?.summary && typeof b.summary.totalRevenue === 'number' && Array.isArray(b.areaStats)],
    ['variance', `/api/reports/variance?${RANGE}`, (b) =>
        Array.isArray(b?.rows) && typeof b.shrinkage === 'number'],
    ['voids', `/api/reports/voids?${RANGE}`, (b) => Array.isArray(b?.rows)],
    ['exchanges', `/api/reports/exchanges?${RANGE}`, (b) => b != null],
    ['notes', `/api/reports/notes?${RANGE}`, (b) => b != null],
    ['refunds', `/api/reports/refunds?${RANGE}`, (b) =>
        Array.isArray(b?.rows) && typeof b.totalValue === 'number'],
    ['servers', `/api/reports/servers?${RANGE}`, (b) => Array.isArray(b?.servers)],
    ['z-report', `/api/reports/z?date=${TODAY}`, (b) =>
        typeof b?.net === 'number' && typeof b.unreconciled === 'number'],
]

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

    for (const [name, path, valid] of ROUTES) {
        const { status, body } = await get(path)
        // A 200 carrying the wrong shape is the failure mode that hurts: the
        // screen renders its empty state and nobody looks again.
        check(name, status === 200 && valid(body), `${status}${status === 200 && !valid(body) ? ' but the shape is wrong' : ''}`)
    }

    // The two spreadsheets are routes too, and one of them had no auth at all.
    for (const [name, path] of [
        ['export', `/api/reports/export?${RANGE}`],
        ['export-inventory', `/api/reports/export-inventory?${RANGE}`],
    ]) {
        const res = await fetch(`${BASE}${path}`, { headers: { cookie } })
        check(name, res.status === 200 && (res.headers.get('content-type') || '').includes('spreadsheet'), String(res.status))
    }

    // A malformed date must say so rather than 500 behind a blank card.
    const bad = await get('/api/reports/variance?startDate=nonsense&endDate=nonsense')
    check('variance rejects a bad date', bad.status === 400, String(bad.status))

    // Takings are not public. The export ran without any guard until today.
    const saved = cookie
    cookie = ''
    const anon = await fetch(`${BASE}/api/reports/export?${RANGE}`)
    check('export refuses an anonymous caller', anon.status === 401, String(anon.status))
    cookie = saved

    // The one that started all of this: the workbook and the screen have to
    // agree, because they are read by the same person on the same morning.
    const page = await get(`/api/reports/analytics?${RANGE}`)
    const XLSX = require('xlsx')
    const xl = await fetch(`${BASE}/api/reports/export?${RANGE}`, { headers: { cookie } })
    const wb = XLSX.read(Buffer.from(await xl.arrayBuffer()), { type: 'buffer' })
    const summary = XLSX.utils.sheet_to_json(wb.Sheets['Summary'])
    const figure = (name) => summary.find((r) => r.Figure === name)?.Value

    check(
        'the export agrees with the page on net revenue',
        figure('Net (billed)') === page.body?.summary?.totalRevenue,
        `export ${figure('Net (billed)')} vs page ${page.body?.summary?.totalRevenue}`
    )
    check(
        'the export agrees with the page on discounts',
        figure('Table discounts') === page.body?.summary?.totalDiscounts,
        `export ${figure('Table discounts')} vs page ${page.body?.summary?.totalDiscounts}`
    )

    console.log()
    if (failures.length) {
        console.error(`${failures.length} check(s) failed.`)
        process.exitCode = 1
    } else {
        console.log('All report routes answer correctly.')
    }
}

main().catch((e) => {
    console.error(e)
    process.exitCode = 1
})
