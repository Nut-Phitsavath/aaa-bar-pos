"use client"

import { useEffect, useState, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Printer, ArrowLeft } from "lucide-react"
import { BillReceipt, type ReceiptData } from "@/components/bill-receipt"
import { useTranslation } from "@/hooks/use-translation"
import { APP_NAME } from "@/lib/shop"

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
                        variation: i.variation ?? i.variationSize?.variation?.type ?? null,
                        size: i.cupSize ?? i.size ?? i.variationSize?.size ?? null,
                        sugar: i.sugarLevel ?? null,
                        shot: i.shotType ?? null,
                        isTakeaway: i.isTakeaway,
                    })),
                    discount: order.discount ?? 0,
                    tax: order.taxAmount ?? order.tax ?? 0,
                    total: order.total,
                    paymentMethod: order.paymentMethod === "BANK_NOTE" ? "CASH" : order.paymentMethod,
                    cashReceived: order.cashReceived ?? null,
                })
                // A second job when asked, so a printer set to cut does it twice.
                const mode = searchParams.get("mode")
                setTimeout(() => {
                    window.print()
                    if (mode === "double") setTimeout(() => window.print(), 1000)
                }, 500)
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
                        const key = `${i.name}::${unit}`
                        const at = merged.get(key)
                        if (at) { at.quantity += i.quantity; at.total += i.total }
                        else merged.set(key, { name: i.name, quantity: i.quantity, total: i.total })
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
                const taxRate = Number(settings?.taxRate) || 0
                const tax = taxRate > 0 ? Math.round(bill.total - bill.total / (1 + taxRate / 100)) : 0

                setData({
                    heading: bill.table.name,
                    headingLabel: "ໂຕະ / TABLE",
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
                    total: bill.total,
                    paid,
                    balance: bill.balance,
                    fxRateLAK: bill.fxRateLAK,
                    fxRateUSD: bill.fxRateUSD,
                    showUsd: bill.showUsd,
                    qrCodeData: qr?.qrCodeData ?? null,
                })
                setTimeout(() => window.print(), 500)
            })
            .catch((e) => { console.error(e); setError(e.message) })
        // Waits on settings so the VAT rate is known before the slip renders.
    }, [sessionId, settings])

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

    return (
        <div className="flex flex-col items-center min-h-screen bg-gray-200 py-12 px-4 print:bg-white print:p-0">
            <Card className="bg-white shadow-2xl border-none print:shadow-none print:p-0">
                <BillReceipt data={data} settings={settings} />
            </Card>

            <div className="mt-8 flex gap-3 print:hidden">
                <Button variant="outline" onClick={() => window.print()}>
                    <Printer className="w-4 h-4 mr-2" />
                    {t.re_print}
                </Button>
                <Button className="bg-amber-600 hover:bg-amber-700" onClick={() => window.close()}>
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    {t.close_and_back}
                </Button>
            </div>

            <style dangerouslySetInnerHTML={{
                __html: `
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
      ` }} />
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
