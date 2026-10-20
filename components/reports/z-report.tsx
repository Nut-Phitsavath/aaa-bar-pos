"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useTranslation } from "@/hooks/use-translation"

import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Printer, Banknote, QrCode, Gift, Clock3, AlertTriangle } from "lucide-react"
import { formatTHB } from "@/lib/currency"
import { APP_NAME } from "@/lib/shop"

type ZReport = {
    date: string
    gross: number
    discounts: number
    net: number
    received: number
    comped: number
    owed: number
    onOpenBills: number
    unreconciled: number
    byMethod: Record<string, { amount: number; count: number }>
    comps: { table: string; amount: number }[]
    tabs: { table: string; customer: string; amount: number }[]
    shift: {
        status: string; startCash: number; cashPayments: number
        actualCash: number | null; difference: number | null
        startTime: string; endTime: string | null
    } | null
    expectedCash: number
    /** VAT as charged, summed off the orders rather than recomputed. */
    tax: number
    /** Rounds that went out, so an average ticket needs no export. */
    tickets: number
    voids: { count: number; value: number }
    refunds: { count: number; value: number }
}

/**
 * Print rules for the Z-report.
 *
 * `window.print()` on its own printed the whole application: the sidebar, the
 * page header, all twelve report tabs, the date picker and the Print button
 * itself, with the figures somewhere in the middle. Nothing in this project had
 * print styles except the receipt, and those are scoped to the receipt.
 *
 * Everything that is neither the report nor one of the layers it sits inside
 * goes, and the report is re-anchored to the top-left so it does not print at
 * whatever offset the sidebar left it at. display:none, not visibility:hidden:
 * an invisible element still takes up its room, and the reports page around
 * the Z-report is three screens tall, so the one-page report printed with a
 * blank page after it. Ancestors are kept by `:has`, because hiding any one of
 * them would take the report with it.
 *
 * A4 portrait, not the receipt's 80mm roll: this is a document for an
 * accountant's file, not a slip for a customer's hand.
 */
const PRINT_CSS = `
  @media print {
    @page { size: A4 portrait; margin: 14mm; }
    body { background: #fff !important; }
    body *:not(:has(#z-report)):not(#z-report):not(#z-report *) { display: none !important; }
    #z-report {
      position: absolute !important;
      left: 0; top: 0; width: 100% !important;
    }
    /* The controls are how you got here, not part of what you are filing. */
    #z-report .no-print { display: none !important; }
    /* Flat on paper: a card's shadow prints as a grey smear. */
    #z-report [data-slot="card"], #z-report .rounded-xl {
      box-shadow: none !important;
      border-color: #cbd5e1 !important;
      break-inside: avoid;
    }
  }
`

const METHOD_ICON: Record<string, any> = {
    CASH: Banknote,
    ONEPAY: QrCode,
    TRANSFER: QrCode,
    OWNER_VIP: Gift,
}

/**
 * End of day (requirement #25).
 *
 * The report exists to answer one question - does the drawer hold what it
 * should - so the cash line is the loudest thing on it, and anything that
 * cannot be explained is shown rather than hidden.
 */
export function ZReport() {
    const { t } = useTranslation()
    const router = useRouter()
    const [date, setDate] = useState(() => new Date().toISOString().split("T")[0])
    const [z, setZ] = useState<ZReport | null>(null)
    const [loading, setLoading] = useState(true)

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const res = await fetch(`/api/reports/z?date=${date}`)
            if (res.ok) setZ(await res.json())
        } finally {
            setLoading(false)
        }
    }, [date])

    useEffect(() => { load() }, [load])

    const methodLabel = (m: string) =>
        m === "CASH" ? t.pay_cash
            : m === "ONEPAY" ? t.pay_onepay
                : m === "TRANSFER" ? t.pay_transfer
                    : m === "OWNER_VIP" ? t.owner_vip
                        : m

    /** The day, written the way a person files it rather than 2026-09-15. */
    const printedDate = new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", {
        weekday: "long", day: "numeric", month: "long", year: "numeric",
    })

    return (
        <div id="z-report" className="space-y-4">
            <style>{PRINT_CSS}</style>

            {/* Only on paper. On screen the date is in the picker and the tab
                says where you are; printed, both are gone, and a Z-report with
                no date or business on it is not a document anybody can file. */}
            <div className="hidden print:block mb-4 pb-3 border-b border-slate-300">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-500">
                    {APP_NAME} · Z-Report
                </p>
                <p className="text-2xl font-black text-slate-900">{printedDate}</p>
            </div>

            {/* Its own single-date control: a Z-report is one day by
                definition, where the tabs around it read a range. */}
            <div className="flex items-center justify-between gap-2 no-print">
                <div className="flex items-center gap-2">
                    <Input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="h-10 w-[150px]"
                    />
                    <Button variant="outline" className="h-10" onClick={() => window.print()}>
                        <Printer className="w-4 h-4 sm:mr-2" />
                        <span className="hidden sm:inline">{t.print}</span>
                    </Button>
                </div>
            </div>

            {/* Two columns on a wide screen, one on a narrow one, and always
                one when printed. The cap was max-w-3xl, which kept the document
                feel but left half a manager's monitor empty while they scrolled
                a reconciliation they could have read at once. Columns rather
                than a wider single column: the money reads top-to-bottom, and
                stretching a two-figure row to 1400px puts its label and its
                number too far apart to pair by eye.

                `break-inside: avoid` on each card so a card is never split
                across a page break on the printed copy. */}
            <div className="grid gap-4 items-start lg:grid-cols-2 xl:max-w-6xl
                            print:block print:max-w-full *:break-inside-avoid">
                {loading || !z ? (
                    <>
                        <div className="h-32 rounded-xl bg-white border border-slate-200 animate-pulse" />
                        <div className="h-48 rounded-xl bg-white border border-slate-200 animate-pulse" />
                    </>
                ) : (
                    <>
                        {/* The question the report exists to answer, so it
                            spans the full width and nothing sits beside it. */}
                        <Card className="p-5 lg:col-span-2">
                            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
                                {t.expected_cash}
                            </p>
                            <p className="text-4xl font-black text-slate-900 tabular-nums mt-1">
                                {formatTHB(z.expectedCash)}
                            </p>
                            {z.shift ? (
                                <p className="text-sm text-slate-500 mt-2 tabular-nums">
                                    {formatTHB(z.shift.startCash)} {t.opening_float} + {formatTHB(z.byMethod.CASH?.amount ?? 0)} {t.pay_cash}
                                    {z.shift.actualCash != null && (
                                        <span className={`ms-2 font-bold ${(z.shift.difference ?? 0) === 0 ? "text-emerald-600" : "text-rose-600"}`}>
                                            · {t.counted}: {formatTHB(z.shift.actualCash)}
                                            {(z.shift.difference ?? 0) !== 0 && ` (${(z.shift.difference ?? 0) > 0 ? "+" : ""}${formatTHB(z.shift.difference ?? 0)})`}
                                        </span>
                                    )}
                                </p>
                            ) : (
                                <p className="text-sm text-slate-400 mt-2">{t.no_shift_today}</p>
                            )}
                        </Card>

                        <Card className="p-5 space-y-2">
                            <div className="flex justify-between text-slate-600">
                                <span>{t.gross_sales}</span>
                                <span className="tabular-nums">{formatTHB(z.gross)}</span>
                            </div>
                            {z.discounts > 0 && (
                                <div className="flex justify-between text-rose-600">
                                    <span>{t.apply_discount}</span>
                                    <span className="tabular-nums">− {formatTHB(z.discounts)}</span>
                                </div>
                            )}
                            <div className="flex justify-between font-bold text-slate-900 pt-2 border-t">
                                <span>{t.net_sales}</span>
                                <span className="text-xl tabular-nums">{formatTHB(z.net)}</span>
                            </div>
                            {/* VAT is inclusive, so this is the portion of net
                                sales that is tax rather than an addition to it.
                                Said quietly, under the total it came out of -
                                but said, because it is the figure an accountant
                                opens this report for. */}
                            <div className="flex justify-between text-sm text-slate-500 pt-1">
                                <span>{t.tax_included}</span>
                                <span className="tabular-nums">{formatTHB(z.tax)}</span>
                            </div>
                            {z.tickets > 0 && (
                                <div className="flex justify-between text-sm text-slate-400">
                                    <span>{t.tickets}</span>
                                    <span className="tabular-nums">
                                        {z.tickets} · {formatTHB(Math.round(z.net / z.tickets))} {t.average}
                                    </span>
                                </div>
                            )}
                        </Card>

                        {/* What was rung up and then taken back. Zero is a
                            result worth printing, not a row to hide: a manager
                            signing off on a day wants to see that nothing was
                            struck, not to wonder whether the report checked. */}
                        <Card className="p-5 space-y-2">
                            <h2 className="text-sm font-bold text-slate-900 mb-1">{t.taken_back}</h2>
                            <div className={`flex justify-between ${z.voids.count > 0 ? "text-rose-600" : "text-slate-400"}`}>
                                <span>{t.voids} {z.voids.count > 0 && <span className="tabular-nums opacity-70">×{z.voids.count}</span>}</span>
                                <span className="tabular-nums">{formatTHB(z.voids.value)}</span>
                            </div>
                            <div className={`flex justify-between ${z.refunds.count > 0 ? "text-rose-600" : "text-slate-400"}`}>
                                <span>{t.refunded} {z.refunds.count > 0 && <span className="tabular-nums opacity-70">×{z.refunds.count}</span>}</span>
                                <span className="tabular-nums">{formatTHB(z.refunds.value)}</span>
                            </div>
                        </Card>

                        <Card className="p-5">
                            <h2 className="text-sm font-bold text-slate-900 mb-3">{t.settled_by}</h2>
                            <div className="space-y-2">
                                {Object.entries(z.byMethod).length === 0 && (
                                    <p className="text-sm text-slate-400">{t.no_orders_yet}</p>
                                )}
                                {Object.entries(z.byMethod).map(([m, r]) => {
                                    const Icon = METHOD_ICON[m] ?? Banknote
                                    return (
                                        <div key={m} className="flex items-center gap-3">
                                            <Icon className="w-4 h-4 text-slate-400 shrink-0" />
                                            <span className="text-slate-700">{methodLabel(m)}</span>
                                            <span className="text-xs text-slate-400">×{r.count}</span>
                                            <span className="ms-auto font-semibold tabular-nums text-slate-900">
                                                {formatTHB(r.amount)}
                                            </span>
                                        </div>
                                    )
                                })}
                            </div>

                            <div className="mt-4 pt-3 border-t space-y-2 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-slate-500">{t.received}</span>
                                    <span className="tabular-nums font-semibold text-emerald-700">{formatTHB(z.received)}</span>
                                </div>
                                {z.comped > 0 && (
                                    <div className="flex justify-between">
                                        <span className="text-slate-500">{t.comped}</span>
                                        <span className="tabular-nums text-purple-700">{formatTHB(z.comped)}</span>
                                    </div>
                                )}
                                {z.owed > 0 && (
                                    <div className="flex justify-between">
                                        <span className="text-slate-500">{t.still_owed}</span>
                                        <span className="tabular-nums text-sky-700">{formatTHB(z.owed)}</span>
                                    </div>
                                )}
                                {z.onOpenBills > 0 && (
                                    <div className="flex justify-between">
                                        <span className="text-slate-500">{t.on_open_bills}</span>
                                        <span className="tabular-nums text-slate-700">{formatTHB(z.onOpenBills)}</span>
                                    </div>
                                )}
                            </div>
                        </Card>

                        {/* Should be zero. A non-zero figure is a bill that closed
                            without its money accounted for, which is exactly what
                            a manager needs put in front of them. */}
                        {z.unreconciled !== 0 && (
                            <Card className="p-5 border-2 border-amber-400 bg-amber-50">
                                <div className="flex items-start gap-3">
                                    <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                                    <div>
                                        <p className="font-bold text-amber-900">
                                            {t.unreconciled}: {formatTHB(z.unreconciled)}
                                        </p>
                                        <p className="text-sm text-amber-800 mt-1">{t.unreconciled_help}</p>
                                    </div>
                                </div>
                            </Card>
                        )}

                        {z.comps.length > 0 && (
                            <Card className="p-5">
                                <h2 className="text-sm font-bold text-slate-900 mb-3">{t.owner_vip}</h2>
                                <div className="space-y-1.5">
                                    {z.comps.map((c, i) => (
                                        <div key={i} className="flex justify-between text-sm">
                                            <span className="text-slate-600">{c.table}</span>
                                            <span className="tabular-nums text-slate-900">{formatTHB(c.amount)}</span>
                                        </div>
                                    ))}
                                </div>
                            </Card>
                        )}

                        {z.tabs.length > 0 && (
                            <Card className="p-5">
                                <div className="flex items-center justify-between mb-3">
                                    <h2 className="text-sm font-bold text-slate-900">{t.tabs}</h2>
                                    <Button variant="outline" size="sm" onClick={() => router.push("/tabs")}>
                                        <Clock3 className="w-3.5 h-3.5 mr-1.5" />
                                        {t.outstanding}
                                    </Button>
                                </div>
                                <div className="space-y-1.5">
                                    {z.tabs.map((tab, i) => (
                                        <div key={i} className="flex justify-between text-sm">
                                            <span className="text-slate-600">{tab.table} · {tab.customer}</span>
                                            <span className="tabular-nums text-slate-900">{formatTHB(tab.amount)}</span>
                                        </div>
                                    ))}
                                </div>
                            </Card>
                        )}
                    </>
                )}
            </div>
        </div>
    )
}
