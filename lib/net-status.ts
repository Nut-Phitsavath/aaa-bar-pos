/**
 * Telling "this till has no internet" apart from "the bank is down".
 *
 * Both look like a failed OnePay call, but the cashier's fix is different:
 * a dead router is something they can go fix, a dead bank is not.
 */

/**
 * True when a request never got an HTTP response at all -- DNS, TCP or TLS
 * failed. `fetch` signals that as a TypeError ("fetch failed") with the real
 * cause attached, or a TimeoutError when an AbortSignal fired.
 *
 * Anything else -- BCEL returning an error body, `Onepay Auth Failed`, missing
 * credentials -- is a normal Error thrown by lib/onepay, which means we DID
 * reach the bank (or never tried), so it is not a connectivity problem.
 */
export function isNetworkError(error: unknown): boolean {
    if (error instanceof TypeError) return true
    const name = (error as { name?: string })?.name
    return name === "TimeoutError" || name === "AbortError"
}

// ponytail: single probe, no retry. A false "offline" (café blocks the probe
// host) still tells the cashier to take cash, which is the right move either
// way -- only the reason shown would be wrong. Point NET_PROBE_URL somewhere
// else if this café's ISP blocks Cloudflare.
const PROBE_URL = process.env.NET_PROBE_URL || "https://1.1.1.1"
const PROBE_TIMEOUT_MS = Number(process.env.NET_PROBE_TIMEOUT_MS || 3000)

/**
 * Whether the POS machine itself can reach the internet. Only called after a
 * request already failed, so it costs nothing on the happy path.
 *
 * Probes a bare IP on purpose: with a hostname, a router that answers DNS
 * while the WAN is down would look like a working connection.
 */
export async function hasInternet(): Promise<boolean> {
    try {
        await fetch(PROBE_URL, {
            method: "HEAD",
            signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        })
        return true // any response at all proves the path works
    } catch {
        return false
    }
}

/**
 * Classify a failed OnePay call for the till.
 *   NO_INTERNET -- this machine is offline; staff can check the router.
 *   BANK_API    -- we reached the network but OnePay is unusable; take cash.
 */
export async function classifyPaymentFailure(error: unknown): Promise<"NO_INTERNET" | "BANK_API"> {
    if (!isNetworkError(error)) return "BANK_API"
    return (await hasInternet()) ? "BANK_API" : "NO_INTERNET"
}
