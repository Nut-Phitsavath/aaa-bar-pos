"use client"

import { useEffect, useState, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Printer, ArrowLeft } from "lucide-react"
import { BillReceipt, type ReceiptData } from "@/components/bill-receipt"
import { useTranslation } from "@/hooks/use-translation"
import { APP_NAME } from "@/lib/shop"
import { summariseSwaps } from "@/lib/packages"
import { tendersOf, counterTenders } from "@/lib/bills"
import { splitSuffix } from "@/lib/table-ops"

/** One set of print rules, whether the slip is a page or inside the dialog. */
const PRINT_CSS = `
  @media print {
    @page { margin: 0; size: 80mm auto; }
    body { background: white !important; margin: 0 !important; padding: 0 !important; min-height: auto !important; }
    #printable-receipt {
      box-shadow: none !important; border: none !important;
      width: 100% !important; max-width: 80mm !important;
      padding: 2mm !important; margin: 0 auto !important;
    }
    button, a { display: none !important; }
  }
`

const stamp = (iso: string) => {
    const d = new Date(iso)
    return `${d.toLocaleDateString("en-GB")} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
}

/**
 * Every printed slip in the app.
 *
 * `?id=` is a counter sale, `?session=` is a table bill, and both render the
 * same BillReceipt - previously the same sale printed one way from the POS
 * success dialog and another from here, which a customer notices and nobody
 * can explain.
 */
function ReceiptContent() {
    const { t } = useTranslation()
    const searchParams = useSearchParams()
    const orderId = searchParams.get("id")
    const sessionId = searchParams.get("session")
    // Rendered inside the till's preview dialog: the slip alone, no page chrome.
    const embed = searchParams.get("embed") === "1"

    const [data, setData] = useState<ReceiptData | null>(null)
    const [settings, setSettings] = useState<any>(null)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        fetch("/api/settings")
            .then((r) => (r.ok ? r.json() : {}))
            .then(setSettings)
            .catch((e) => console.error(e))
    }, [])

    useEffect(() => {
        if (!orderId) return
        document.title = `Receipt | ${APP_NAME}`
        fetch(`/api/orders/${orderId}`)
            .then((res) => { if (res.ok) return res.json(); throw new Error("Order not found") })
            .then((order) => {
                setData({
                    heading: order.orderNumber,
                    headingLabel: t.order_no,
                    date: new Date(order.createdAt).toLocaleString(),
                    staffName: order.user?.name ?? null,
                    beeperNumber: order.beeperNumber ?? null,
                    lines: (order.items ?? []).map((i: any) => ({
                        name: i.name,
                        quantity: i.quantity,
                        total: i.price * i.quantity,
                        variation: i.variation ?? null,
                        size: i.cupSize ?? i.size ?? null,
                        sugar: i.sugarLevel ?? null,
                        shot: i.shotType ?? null,
                        isTakeaway: i.isTakeaway,
                        note: i.note ?? null,
                    })),
                    discount: order.discount ?? 0,
                    tax: order.taxAmount ?? order.tax ?? 0,
                    total: order.total,
                    paymentMethod: order.paymentMethod === "BANK_NOTE" ? "CASH" : order.paymentMethod,
                    cashReceived: order.cashReceived ?? null,
                    // Struck at the sale; null on sales from before it was kept,
                    // which then print no kip line.
                    fxRateLAK: order.fxRateLAK ?? null,
                    tenders: counterTenders(order),
                })
            })
            .catch((e) => { console.error(e); setError(e.message) })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [orderId])

    useEffect(() => {
        if (!sessionId) return
        document.title = `Bill | ${APP_NAME}`
        fetch(`/api/table-sessions/${sessionId}`)
            .then((res) => { if (res.ok) return res.json(); throw new Error("Bill not found") })
            .then((bill) => {
                const live = (bill.orders ?? []).filter(
                    (o: any) => o.status !== "CANCELLED" && o.status !== "HOLD"
                )

                // One list, repeats merged, keyed on name AND unit price so the
                // same drink at two sizes stays two lines. At the point of paying
                // nobody checks which round a drink came from.
                const merged = new Map<string, any>()
                for (const o of live) {
                    // A round can survive while one of its lines was struck, so
                    // filtering cancelled ORDERS is not enough - a voided line
                    // would otherwise still be printed on, and charged for, a
                    // bill whose total no longer includes it.
                    for (const i of o.items.filter((x: any) => !x.voidedAt)) {
                        const unit = i.quantity > 0 ? i.total / i.quantity : 0
                        // The note is part of the key: "no ice" is why one of
                        // the two is different, so merging them would lose it.
                        // So is the exchange: two identical sets, one of which
                        // had its Heinekens swapped for water, are two lines.
                        const swap = summariseSwaps(i.swaps ?? [])
                        const swapKey = [...swap.out, ...swap.in]
                            .map((l) => `${l.direction}${l.name}${l.quantity}`).join("|")
                        const key = `${i.name}::${unit}::${i.note ?? ""}::${swapKey}`
                        const at = merged.get(key)
                        if (at) { at.quantity += i.quantity; at.total += i.total }
                        else merged.set(key, {
                            name: i.name, quantity: i.quantity, total: i.total,
                            note: i.note ?? null,
                            swapOut: swap.out, swapIn: swap.in,
                        })
                    }
                }

                const opened = new Date(bill.openedAt)
                const reference = `${bill.table.name.replace(/\s+/g, "")}-${String(opened.getDate()).padStart(2, "0")}${String(opened.getMonth() + 1).padStart(2, "0")}-${bill.id.slice(0, 4).toUpperCase()}`

                const posStaff = Array.from(new Set(live.map((o: any) => o.user?.name).filter(Boolean)))
                const servers = Array.from(new Set(live.map((o: any) => o.waiter?.name).filter(Boolean)))
                const paid = bill.total - bill.balance
                const qr = (bill.payments ?? []).find(
                    (p: any) => p.method === "ONEPAY" && p.paymentStatus === "PENDING" && p.qrCodeData
                )
                // The bill's own VAT rate, not today's: the API hands back the
                // rate stamped at close for a settled bill and the live one
                // while it is open. Null means a bill from before the rate was
                // stamped - it prints no VAT line rather than inventing one.
                const taxRate = bill.taxRate
                const tax = taxRate ? Math.round(bill.total - bill.total / (1 + taxRate / 100)) : 0

                // A split party walks away with two slips for one table; each
                // says which half it is, by the letter saved at the split, so a
                // reprint after the other half has paid still says T1-b.
                const split = bill.splitIndex != null
                setData({
                    heading: split ? `${bill.table.name}-${splitSuffix(bill.splitIndex)}` : bill.table.name,
                    headingLabel: split ? "ໂຕະ / TABLE · ແຍກບິນ / SPLIT BILL" : "ໂຕະ / TABLE",
                    subheading: reference,
                    date: stamp(bill.openedAt),
                    staffName: posStaff.join(", ") || null,
                    serverNames: servers.join(", ") || null,
                    openedAt: stamp(bill.openedAt),
                    closedAt: bill.closedAt ? stamp(bill.closedAt) : null,
                    lines: Array.from(merged.values()),
                    gross: bill.gross,
                    discount: bill.discount ?? 0,
                    tax,
                    taxRate,
                    total: bill.total,
                    paid,
                    balance: bill.balance,
                    tenders: tendersOf(bill.payments ?? []),
                    fxRateLAK: bill.fxRateLAK,
                    qrCodeData: qr?.qrCodeData ?? null,
                })
            })
            .catch((e) => { console.error(e); setError(e.message) })
        // No longer waits on settings: the VAT rate arrives on the bill itself.
    }, [sessionId])

    if (error) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center p-4">
                <p className="text-rose-600 mb-4">{t.error_label}: {error}</p>
                <Button variant="outline" onClick={() => window.close()}>{t.close_window}</Button>
            </div>
        )
    }

    if (!data) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-900" />
                <p className="ml-3">{t.generating_receipt}</p>
            </div>
        )
    }

    // Shown inside the till's own preview dialog rather than as a page: the
    // frame around it and the buttons under it belong to the dialog, so this
    // renders the slip alone and nothing else.
    if (embed) {
        return (
            <div className="bg-white">
                <BillReceipt data={data} settings={settings} />
                <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
            </div>
        )
    }

    return (
        <div className="flex flex-col items-center min-h-screen bg-gray-200 py-12 px-4 print:bg-white print:p-0">
            <Card className="bg-white shadow-2xl border-none print:shadow-none print:p-0">
                <BillReceipt data={data} settings={settings} />
            </Card>

            {/* The slip is shown and then it waits. It used to fire the browser's
                print dialog 500ms after loading, which meant a window nobody
                asked for landed on top of a dialog nobody asked for - and on a
                till with no printer attached there was nothing to do with it but
                dismiss it. Printing is a decision the staff member makes. */}
            <div className="mt-8 flex gap-3 print:hidden">
                <Button
                    onClick={() => window.print()}
                    className="h-14 px-8 text-lg font-black bg-slate-900 hover:bg-slate-800"
                >
                    <Printer className="w-5 h-5 mr-2" />
                    {t.print}
                </Button>
                <Button
                    variant="outline"
                    onClick={() => window.close()}
                    className="h-14 px-6 text-lg"
                >
                    <ArrowLeft className="w-5 h-5 mr-2" />
                    {t.close_and_back}
                </Button>
            </div>

            <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
        </div>
    )
}

export default function ReceiptPage() {
    return (
        <Suspense fallback={<div />}>
            <ReceiptContent />
        </Suspense>
    )
}
