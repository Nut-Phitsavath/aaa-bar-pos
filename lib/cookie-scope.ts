/**
 * Whether the session cookie may carry the Secure flag.
 *
 * Secure cookies are only stored over HTTPS, with localhost as the browser's
 * one exception - which is exactly why keying this off NODE_ENV worked on the
 * main till and failed silently on every other device. The satellite tills
 * reach the host by LAN IP over plain HTTP, the browser dropped the cookie
 * without a word, and staff saw the PIN screen again with no error to report.
 *
 * So it follows the protocol actually in use. A tunnelled deployment still
 * gets Secure - cloudflared connects to 127.0.0.1 over http and says what the
 * browser really used in x-forwarded-proto, so reading request.url alone would
 * quietly downgrade it. The bar's own network does not get Secure, which is
 * the accepted trade for tills that keep working when the internet does not:
 * that network needs its own password and no guest access.
 */
export function cookieSecure(request: Request): boolean {
    // Proxies append rather than replace, so the client's own value is first.
    const forwarded = request.headers.get('x-forwarded-proto')
    if (forwarded) return forwarded.split(',')[0].trim().toLowerCase() === 'https'

    try {
        return new URL(request.url).protocol === 'https:'
    } catch {
        // An unparseable URL is not a reason to hand out a cookie the browser
        // will refuse; plain is the working default on this network.
        return false
    }
}
