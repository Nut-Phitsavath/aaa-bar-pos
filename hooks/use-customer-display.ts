"use client"

import { useEffect } from "react"

type DisplayOrder = {
    status: string
    items: {
        id: string; name: string; localName: string | null
        quantity: number; total: number
        image: string | null; category: string | null
    }[]
}

type DisplayBill = {
    id: string
    table: { name: string }
    orders: DisplayOrder[]
    total: number
    balance: number
} | null

/**
 * Mirror a table bill onto the customer screen.
 *
 * Uses the same BroadcastChannel and message shapes the walk-in till already
 * sends, so /customer-view needs no protocol of its own. It only reaches a
 * display on this machine: opening a bill on a tablet at the table will not
 * drive the screen at the counter.
 *
 * Lives in a hook because both the bill view and the settle screen show the
 * customer the same thing, and two copies of this would drift.
 */
export function useCustomerDisplay(bill: DisplayBill) {
    useEffect(() => {
        if (!bill) return

        // A customer checking their bill wants "12x Beer Lao", not the same
        // drink on six lines. Keyed on name AND unit price, so the same drink
        // at two sizes stays two lines rather than merging into a wrong total.
        type Line = {
            name: string; quantity: number; total: number
            image: string | null; localName: string | null; category: string | null
        }
        const lines = new Map<string, Line>()
        for (const order of bill.orders) {
            if (order.status === "CANCELLED" || order.status === "HOLD") continue
            for (const item of order.items) {
                const unit = item.quantity > 0 ? item.total / item.quantity : 0
                const key = `${item.name}::${unit}`
                const at = lines.get(key)
                if (at) {
                    at.quantity += item.quantity
                    at.total += item.total
                } else {
                    lines.set(key, {
                        name: item.name,
                        quantity: item.quantity,
                        total: item.total,
                        image: item.image ?? null,
                        localName: item.localName ?? null,
                        category: item.category ?? null,
                    })
                }
            }
        }

        const channel = new BroadcastChannel("pos_channel")
        channel.postMessage({
            type: "CART_UPDATE",
            cart: Array.from(lines.values()).map((line, i) => ({
                id: `${bill.id}-${i}`,
                name: line.name,
                price: line.quantity > 0 ? line.total / line.quantity : 0,
                quantity: line.quantity,
                modifiers: [],
                // The display groups on category and renders the photo; both
                // must survive or every drink lands under "Other" with no image.
                category: line.category || "",
                image: line.image || undefined,
                localName: line.localName || undefined,
            })),
            subtotal: bill.total,
            tax: 0,
            total: bill.balance,
            discount: 0,
            promoDiscount: 0,
            loyaltyPoints: 0,
            // Without this a part-paid bill shows a figure lower than the items
            // add up to, and nothing on screen explains the gap.
            amountPaid: bill.total - bill.balance,
            tableName: bill.table.name,
            customer: null,
            isComplimentary: false,
        })
        channel.close()
    }, [bill])

    // Leaving the screen returns the customer display to idle.
    useEffect(() => {
        return () => {
            const channel = new BroadcastChannel("pos_channel")
            channel.postMessage({ type: "ORDER_RESET" })
            channel.close()
        }
    }, [])
}
