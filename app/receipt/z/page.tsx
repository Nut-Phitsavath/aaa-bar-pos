"use client"

import { useEffect, useRef, useState, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { useTranslation } from "@/hooks/use-translation"
import { formatTHB } from "@/lib/currency"
import { APP_NAME } from "@/lib/shop"

/** Same paper rules as the bill (app/receipt/page.tsx): the receipt printer's roll. */
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

type Z = {
    gross: number; discounts: number; net: number; received: number; comped: number; owed: number
    onOpenBills: number; unreconciled: number; tax: number; tickets: number
    voids: { count: number; value: number }; refunds: { count: number; value: number }
    byMethod: Record<string, { amount: number; count: number }>
    tabs: { table: string; customer: string; amount: number }[]
    cashTaken: number; expectedCash: number; live: boolean
    shift: {
        id: string; startTime: string; endTime: string | null; startCash: number
        actualCash: number | null; difference: number | null
        openedBy: string | null; responsiblePerson: string | null
    }
}

const stamp = (iso: string | Date) => {
    const d = new Date(iso)
    return `${d.toLocaleDateString("en-GB")} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
}

const ORDER = ["CASH", "ONEPAY", "TRANSFER", "OWNER_VIP"]

function Row({ label, value, bold, indent }: { label: React.ReactNode; value: React.ReactNode; bold?: boolean; indent?: boolean }) {
    return (
        <div className={`flex justify-between gap-3 ${bold ? "font-black" : ""} ${indent ? "ps-3" : ""}`}>
            <span>{label}</span><span className="tabular-nums whitespace-nowrap">{value}</span>
        </div>
    )
}

function Rule() {
    return <div className="border-b border-dashed border-slate-300 my-2.5" />
}

/**
 * The Z-report as it comes out of the receipt printer at shift close, the way
 * SambaPOS prints its work-period report when the period ends.
 *
 *   /receipt/z?shift=<id>              the slip, to look at or print
 *   &autoprint=1                       prints itself once the figures are in -
 *                                      only the close does this, because closing
 *                                      is the moment the staff member chose
 *   &reprint=1                         marked REPRINT, from the Shifts page
 *
 * An open shift prints marked LIVE - NOT FINAL: that is the X reading.
 * Under /receipt so it inherits the receipt's place outside the app chrome,
 * and it carries #printable-receipt so ReceiptDialog sizes and prints it the
 * same way as a bill.
 */
function ZSlip() {
    const { t } = useTranslation()
    const params = useSearchParams()
    const shiftId = params.get("shift")
    const autoprint = params.get("autoprint") === "1"
    const reprint = params.get("reprint") === "1"
    const [z, setZ] = useState<Z | null>(null)
    const [settings, setSettings] = useState<any>(null)
    const [error, setError] = useState<string | null>(null)
    const printed = useRef(false)
    const [printedAt] = useState(() => new Date())

    useEffect(() => {
        fetch("/api/settings").then((r) => (r.ok ? r.json() : {})).then(setSettings).catch(() => setSettings({}))
    }, [])
    useEffect(() => {
        fetch(`/api/reports/z${shiftId ? `?shift=${encodeURIComponent(shiftId)}` : ""}`)
            .then(async (r) => { if (r.ok) return r.json(); throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`) })
            .then(setZ)
            .catch((e) => setError(e.message))
    }, [shiftId])

    // Once, after the figures and the shop's name have rendered. Marked done
    // when it fires, not when it is scheduled: React may clear the timer and
    // run this again (it does in development), and a flag set early would
    // then stop the slip printing at all.
    useEffect(() => {
        if (!autoprint || printed.current || !z || !settings) return
        const id = setTimeout(() => { printed.current = true; window.print() }, 300)
        return () => clearTimeout(id)
    }, [autoprint, z, settings])

    if (error) return <p className="p-6 text-center text-rose-600">{t.error_label}: {error}</p>
    if (!z || !settings) {
        return <div className="flex justify-center p-10"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-900" /></div>
    }

    const methodLabel = (m: string) =>
        m === "CASH" ? t.pay_cash : m === "ONEPAY" ? t.pay_onepay : m === "TRANSFER" ? t.pay_transfer : m === "OWNER_VIP" ? t.owner_vip : m
    const rank = (m: string) => { const i = ORDER.indexOf(m); return i < 0 ? ORDER.length : i }
    const methods = Object.entries(z.byMethod).sort(([a], [b]) => rank(a) - rank(b))
    const manager = z.shift.responsiblePerson || z.shift.openedBy
    const counted = !z.live && z.shift.actualCash != null
    const difference = z.shift.difference ?? 0

    return (
        <div id="printable-receipt" className="w-[80mm] mx-auto bg-white text-slate-900 px-4 py-5 text-sm leading-relaxed">
            <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
            <div className="text-center">
                {settings?.shopLogo && (
                    <div className="flex justify-center mb-1">
                        <img src={settings.shopLogo} alt="" className="h-12 w-auto object-contain grayscale contrast-[1.6]" />
                    </div>
                )}
                <h2 className="text-lg font-black tracking-tight uppercase">{settings?.shopName || APP_NAME}</h2>
                <p className="text-2xl font-black mt-1">{t.z_report}</p>
                {z.live && <p className="mt-1 border-2 border-slate-900 px-2 py-0.5 text-xs font-black inline-block">{t.z_live}</p>}
                {!z.live && reprint && <p className="mt-1 text-xs font-black tracking-widest">{t.z_reprint}</p>}
                {manager && <p className="text-xs mt-1">{t.z_manager}: {manager}</p>}
            </div>
            <Rule />
            <Row label={t.opened_at} value={stamp(z.shift.startTime)} />
            {z.shift.endTime && <Row label={t.closed_at} value={stamp(z.shift.endTime)} />}
            <Rule />
            <Row label={t.gross_sales} value={formatTHB(z.gross)} />
            {z.discounts > 0 && <Row label={t.apply_discount} value={`-${formatTHB(z.discounts)}`} />}
            <Row label={t.net_sales} value={formatTHB(z.net)} bold />
            <Row label={t.tax_included} value={formatTHB(z.tax)} indent />
            <Row label={t.tickets} value={z.tickets > 0 ? `${z.tickets} · ${t.average} ${formatTHB(Math.round(z.net / z.tickets))}` : "0"} />
            <Row label={t.voids} value={`${z.voids.count} · ${formatTHB(z.voids.value)}`} />
            <Row label={t.refunded} value={`${z.refunds.count} · ${formatTHB(z.refunds.value)}`} />
            <Rule />
            <p className="font-bold">{t.settled_by}</p>
            {methods.length === 0 && <p className="ps-3 text-xs">{t.no_orders_yet}</p>}
            {methods.map(([m, r]) => <Row key={m} label={`${methodLabel(m)} ×${r.count}`} value={formatTHB(r.amount)} indent />)}
            <Row label={t.received} value={formatTHB(z.received)} />
            {z.comped > 0 && <Row label={t.comped} value={formatTHB(z.comped)} />}
            {z.owed > 0 && <Row label={`${t.tabs} · ${t.still_owed}`} value={formatTHB(z.owed)} />}
            {z.tabs.map((tab, i) => <Row key={i} label={`${tab.table} · ${tab.customer}`} value={formatTHB(tab.amount)} indent />)}
            {z.onOpenBills > 0 && <Row label={t.on_open_bills} value={formatTHB(z.onOpenBills)} />}
            {z.unreconciled !== 0 && (
                <div className="mt-1 border-2 border-slate-900 p-1.5 text-xs font-bold">
                    {t.unreconciled}: {formatTHB(z.unreconciled)}
                </div>
            )}
            <Rule />
            <p className="font-bold">{t.expected_cash}</p>
            <Row label={t.opening_float} value={formatTHB(z.shift.startCash)} indent />
            <Row label={`+ ${t.pay_cash}`} value={formatTHB(z.expectedCash - z.shift.startCash)} indent />
            <Row label={`= ${t.expected_cash}`} value={formatTHB(z.expectedCash)} indent />
            {counted && (
                <>
                    <Row label={t.counted} value={formatTHB(z.shift.actualCash!)} indent />
                    <Row label={t.difference_label} value={`${difference > 0 ? "+" : ""}${formatTHB(difference)}`} bold />
                </>
            )}
            <Rule />
            <p className="text-center text-[10px] opacity-70">{t.z_printed} {stamp(printedAt)}</p>
        </div>
    )
}

export default function ZSlipPage() {
    return (
        <Suspense fallback={null}>
            <div className="bg-white min-h-0">
                <ZSlip />
            </div>
        </Suspense>
    )
}
