/**
 * What this till prints its slips in, kept on the device itself.
 *
 * The choice belongs to the till, not to whoever is signed in: staff move
 * between the main bar and the VIP counter, the customers at each counter do
 * not, and a slip at the main bar has to come out in kip whoever presses Print.
 * The app has no record of devices, so the device's own browser storage is the
 * one place that is per till by nature.
 *
 * Read through useSyncExternalStore, so a page already open - the receipt
 * preview, Settings in another tab - follows a change at once, and the server
 * render (which cannot see the device) agrees with the first client one.
 * Storage that is blocked or cleared reads as baht - what every till printed
 * before this existed.
 */

import { useSyncExternalStore } from 'react'
import { isReceiptCurrency, type ReceiptCurrency } from './currency.ts'

const KEY = 'pos_till_receipt_currency'
const CHANGED = 'pos-till-currency-changed'

export function readTillCurrency(): ReceiptCurrency {
    try {
        const value = localStorage.getItem(KEY)
        return isReceiptCurrency(value) ? value : 'THB'
    } catch {
        return 'THB'
    }
}

/** False when the device would not keep it (private window, storage blocked). */
export function saveTillCurrency(currency: ReceiptCurrency): boolean {
    try {
        localStorage.setItem(KEY, currency)
        if (localStorage.getItem(KEY) !== currency) return false
        window.dispatchEvent(new Event(CHANGED))
        return true
    } catch {
        return false
    }
}

function subscribe(onChange: () => void) {
    window.addEventListener('storage', onChange)
    window.addEventListener(CHANGED, onChange)
    return () => {
        window.removeEventListener('storage', onChange)
        window.removeEventListener(CHANGED, onChange)
    }
}

export function useTillCurrency(): ReceiptCurrency {
    return useSyncExternalStore(subscribe, readTillCurrency, () => 'THB')
}
