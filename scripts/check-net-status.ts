/**
 * Self-check for lib/net-status.ts:  npx tsx scripts/check-net-status.ts
 *
 * The classifier branches on the *shape* of a thrown error, which is easy to
 * get wrong silently -- misread it and a bank outage tells staff to go reboot
 * a working router. This drives it with errors produced by real failed fetches
 * rather than hand-built fakes, so it stays honest if Node changes them.
 */
import assert from "node:assert"
import { isNetworkError, hasInternet, classifyPaymentFailure } from "../lib/net-status"

const grab = async (fn: () => Promise<unknown>) => {
    try { await fn(); return null } catch (e) { return e }
}

async function main() {
    // 1. DNS failure -- what an offline till actually produces.
    const dnsErr = await grab(() => fetch("https://no-such-host-xyz.invalid/x"))
    assert.ok(dnsErr, "expected the bogus host to throw")
    assert.equal(isNetworkError(dnsErr), true, "DNS failure must count as a network error")

    // 2. Aborted/timed-out request -- a black-holed route on a dead WAN.
    const timeoutErr = await grab(() =>
        fetch("http://10.255.255.1/x", { signal: AbortSignal.timeout(1500) }))
    assert.ok(timeoutErr, "expected the unroutable address to throw")
    assert.equal(isNetworkError(timeoutErr), true, "timeout must count as a network error")

    // 3. Errors lib/onepay throws once the bank HAS answered, or before we try.
    //    These must NOT be read as connectivity problems.
    assert.equal(isNetworkError(new Error("Onepay Auth Failed: bad credentials")), false)
    assert.equal(isNetworkError(new Error("Onepay QR Error: invalid amount")), false)
    assert.equal(isNetworkError(new Error("ONEPAY_USERNAME or ONEPAY_PASSWORD not set")), false)
    assert.equal(await classifyPaymentFailure(new Error("Onepay QR Error: nope")), "BANK_API",
        "a bank rejection must never be reported as an internet outage")

    // 4. The probe, against whatever this machine's connection actually is.
    const online = await hasInternet()
    const verdict = await classifyPaymentFailure(dnsErr)
    assert.equal(verdict, online ? "BANK_API" : "NO_INTERNET",
        "a network-level failure must be classified by the probe result")

    console.log(`ok - machine ${online ? "online" : "offline"}; network failure -> ${verdict}`)
    console.log("ok - all net-status checks passed")
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1) })
