"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useTranslation } from "@/hooks/use-translation"

import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Printer, Banknote, QrCode, Gift, Clock3, AlertTriangle } from "lucide-react"
import { formatTHB } from "@/lib/currency"

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
}

const METHOD_ICON: Record<string, any> = {
    CASH: Banknote,
    ONEPAY: QrCode,
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
        m === "CASH" ? t.pay_cash : m === "ONEPAY" ? t.pay_onepay : m === "OWNER_VIP" ? t.owner_vip : m

    return (
        <div className="space-y-4">
            {/* Its own single-date control: a Z-report is one day by
                definition, where the tabs around it read a range. */}
            <div className="flex items-center justify-between gap-2">
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

            <div className="max-w-3xl space-y-4">
                {loading || !z ? (
                    <>
                        <div className="h-32 rounded-xl bg-white border border-slate-200 animate-pulse" />
                        <div className="h-48 rounded-xl bg-white border border-slate-200 animate-pulse" />
                    </>
                ) : (
                    <>
                        {/* The question the report exists to answer. */}
                        <Card className="p-5">
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
