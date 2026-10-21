/**
 * First-time setup on the bar's till: the Owner account, and nothing else.
 *
 * The till starts empty - no menu, no tables, no sales, no test staff. The
 * owner enters the menu (or it is imported from SambaPOS) and builds the floor
 * plan in the app. What the app cannot start without is someone who can sign
 * in, so this creates the Owner (username "admin") with a PIN typed here, on
 * the till, by the person who will use it.
 *
 * On a clone of the repo (how the bar's till is set up) this is the whole of
 * first-time setup, as `npm run setup`:
 *   1. .env: writes it, or fills in what it lacks - DATABASE_URL, a
 *      SESSION_SECRET of this till's own, and POS_TILL=1, which stops the
 *      test-data scripts running here (notOnTill.js). Values already there,
 *      such as OnePay keys, are kept.
 *   2. builds the database, or brings it up to date (prisma migrate deploy)
 *   3. the Owner and their PIN
 *
 * It refuses to touch a database that already has sales: before this,
 * first-time setup wiped and re-seeded on "type YES", which on a live till is
 * the whole night's takings gone. Run again on a till with no sales yet and it
 * just resets the Owner's PIN.
 *
 *   npm run setup                                  asks for the PIN (twice, hidden)
 *   OWNER_PIN=4821 node prisma/setupFirstInstall.js   (for scripted installs/tests)
 */

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const readline = require('node:readline')
const bcrypt = require('bcryptjs')

const ROOT = path.join(__dirname, '..')

/** Fill in what .env lacks; keep everything it has. */
function ensureEnv() {
    const file = path.join(ROOT, '.env')
    let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
    const added = []
    const need = (key, value, good) => {
        const line = new RegExp(`^${key}=(.*)$`, 'm')
        const found = text.match(line)
        if (found && good(found[1].trim().replace(/^"(.*)"$/, '$1'))) return
        const entry = `${key}="${value}"`
        text = found ? text.replace(line, entry) : text + (text && !text.endsWith('\n') ? '\n' : '') + entry + '\n'
        added.push(key)
    }
    need('DATABASE_URL', 'file:./dev.db', (v) => v !== '')
    // .env.example ships SESSION_SECRET="", and without one nobody can sign in.
    need('SESSION_SECRET', crypto.randomBytes(48).toString('base64url'), (v) => v.length >= 32)
    need('POS_TILL', '1', (v) => v !== '')
    if (added.length) {
        fs.writeFileSync(file, text)
        console.log(`.env: wrote ${added.join(', ')}.`)
    }
}

/** The prisma CLI by path: in the deploy package there is no node_modules/.bin for npx. */
function migrate() {
    console.log('Building the database (prisma migrate deploy)...')
    const cli = path.join(ROOT, 'node_modules', 'prisma', 'build', 'index.js')
    const run = spawnSync(process.execPath, [cli, 'migrate', 'deploy'], { cwd: ROOT, stdio: 'inherit' })
    if (run.status !== 0) throw new Error('Building the database failed - see above. Nothing else was done.')
}

let prisma

// The seed's PINs are printed in README.md; an Owner using one of them has a
// PIN anyone with the repo knows.
const PUBLISHED_TEST_PINS = new Set(['1675', '2468', '3978', '2267'])

function pinProblem(pin) {
    if (!/^\d{4,8}$/.test(pin)) return 'Use 4 to 8 digits.'
    if (PUBLISHED_TEST_PINS.has(pin)) return 'That is one of the test PINs in the README - choose another.'
    if (/^(\d)\1+$/.test(pin)) return 'All the same digit is too easy to guess - choose another.'
    return null
}

/** Ask without echoing the digits (a "*" per key instead). */
function askHidden(question) {
    return new Promise((resolve, reject) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
        rl.stdoutMuted = true
        rl._writeToOutput = (s) => {
            if (!rl.stdoutMuted || s.includes(question)) rl.output.write(s)
            else rl.output.write(s.replace(/[^\r\n]/g, '*'))
        }
        // No keyboard (input piped and ended): stop, rather than wait forever
        // or loop on empty answers.
        let answered = false
        rl.on('close', () => { if (!answered) reject(new Error('No PIN was entered - nothing was changed.')) })
        rl.question(question, (answer) => { answered = true; rl.close(); process.stdout.write('\n'); resolve(answer.trim()) })
    })
}

async function choosePin() {
    if (process.env.OWNER_PIN) {
        const problem = pinProblem(process.env.OWNER_PIN)
        if (problem) throw new Error(`OWNER_PIN: ${problem}`)
        return process.env.OWNER_PIN
    }
    for (;;) {
        const pin = await askHidden('Choose the Owner PIN (4-8 digits): ')
        const problem = pinProblem(pin)
        if (problem) { console.log(problem); continue }
        const again = await askHidden('Type it again: ')
        if (again !== pin) { console.log('The two did not match - try again.'); continue }
        return pin
    }
}

async function main() {
    ensureEnv()
    migrate()
    // Read .env ourselves: the client only does if .env existed when `npm ci`
    // generated it, which on a fresh clone it did not.
    process.loadEnvFile(path.join(ROOT, '.env'))
    const { PrismaClient } = require('@prisma/client')
    prisma = new PrismaClient()

    const sales = await prisma.order.count()
    if (sales > 0) {
        console.log(`This till already has ${sales} order(s). Setup only runs on a till with no sales,`)
        console.log('so nothing was changed. To change the Owner PIN, sign in and use User Management.')
        process.exitCode = 1
        return
    }

    const pin = await choosePin()
    const hash = await bcrypt.hash(pin, 10)
    const existing = await prisma.user.findUnique({ where: { username: 'admin' } })
    if (existing) {
        await prisma.user.update({ where: { username: 'admin' }, data: { pin: hash, role: 'ADMIN', isActive: true } })
        console.log('Owner PIN reset.')
    } else {
        await prisma.user.create({ data: { name: 'Owner', username: 'admin', role: 'ADMIN', pin: hash } })
        console.log('Owner account created.')
    }
    console.log('')
    console.log('Sign in as "Owner" with that PIN, then:')
    console.log('  - Settings: shop name, VAT, kip rate, receipt footer, bank QR')
    console.log('  - User Management: managers, staff and waiters')
    console.log('  - Menu, and Tables -> Manage floor')
}

main()
    .catch((e) => { console.error(e.message || e); process.exitCode = 1 })
    .finally(() => prisma?.$disconnect())
