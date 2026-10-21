/**
 * The scripts that write test data call this first. On the bar's till they
 * would wipe or fake its sales: db:seed deletes every order, db:demo adds
 * ~600 invented ones. The till runs from a clone of this repo, so they are
 * one typed command away there.
 *
 * A till is marked by POS_TILL in its .env, which `npm run setup`
 * (setupFirstInstall.js) writes. .env is read here, not left to Prisma: the
 * client only reads it if .env already existed when `npm ci` generated it,
 * and on a fresh clone it did not.
 */
const path = require('node:path')

module.exports = function notOnTill(command) {
    try { process.loadEnvFile(path.join(__dirname, '..', '.env')) } catch { /* no .env: not a till */ }
    if (!process.env.POS_TILL) return
    console.error(`${command} writes test data, and this is the bar's till (POS_TILL is set in .env).`)
    console.error('Nothing was changed.')
    process.exit(1)
}
