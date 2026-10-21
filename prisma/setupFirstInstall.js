/**
 * First-time setup on the bar's till: the Owner account, and nothing else.
 *
 * The till starts empty - no menu, no tables, no sales, no test staff. The
 * owner enters the menu (or it is imported from SambaPOS) and builds the floor
 * plan in the app. What the app cannot start without is someone who can sign
 * in, so this creates the Owner (username "admin") with a PIN typed here, on
 * the till, by the person who will use it.
 *
 * Run after `prisma migrate deploy` has built the database (FIRST-TIME-SETUP.bat
 * does both). It refuses to touch a database that already has sales: before
 * this, first-time setup wiped and re-seeded on "type YES", which on a live
 * till is the whole night's takings gone.
 *
 * Run again on a till with no sales yet and it just resets the Owner's PIN.
 *
 *   node prisma/setupFirstInstall.js            asks for the PIN (twice, hidden)
 *   OWNER_PIN=4821 node prisma/setupFirstInstall.js   (for scripted installs/tests)
 */

const readline = require('node:readline')
const bcrypt = require('bcryptjs')
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

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
    .finally(() => prisma.$disconnect())
