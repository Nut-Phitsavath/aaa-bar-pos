"use client"

import { useState, useEffect, useCallback } from "react"
import { useTranslation } from "@/hooks/use-translation"
import { Card } from "@/components/ui/card"
import { AlertTriangle } from "lucide-react"
import { formatTHB } from "@/lib/currency"

type SwapRow = {
    id: string
    at: string
    staff: string | null
    table: string | null
    packageName: string | null
    outValue: number
    inValue: number
    charged: number
    returnedValue: number
    reversedAt: string | null
    reversedBy: string | null
    out: { name: string; quantity: number }[]
    in: { name: string; quantity: number }[]
}

type Payload = {
    swaps: SwapRow[]
    totals: { count: number; reversed: number; charged: number; returnedValue: number }
    byStaff: { staff: string; count: number; returnedValue: number; charged: number }[]
}

/**
 * The exchange audit report (req #9).
 *
 * This is the only control on the exchange screen. Swapping needs no manager
 * PIN - the owner's call, and the right one at 1am - so nobody is stopped at
 * the time and the morning is when a pattern shows. The column that matters is
 * what went back on the shelf: stock that returned to inventory on one staff
 * member's word, with no manager and no customer checking. When a count comes
 * up short, these are the rows to read.
 *
 * Leads with the per-staff summary for that reason. A list of events answers
 * "what happened"; only the totals answer "who keeps doing this".
 */
export function ExchangeAudit({ startDate, endDate }: { startDate: string; endDate: string }) {
    const { t } = useTranslation()
    const [data, setData] = useState<Payload | null>(null)
    const [loading, setLoading] = useState(true)

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const res = await fetch(`/api/reports/exchanges?startDate=${startDate}&endDate=${endDate}`)
            if (res.ok) setData(await res.json())
        } finally { setLoading(false) }
    }, [startDate, endDate])

    useEffect(() => { load() }, [load])

    if (loading) return <div className="h-64 rounded-xl bg-white border border-slate-200 animate-pulse" />

    if (!data || data.swaps.length === 0) {
        return (
            <Card className="py-16 text-center text-slate-500">{t.no_exchanges}</Card>
        )
    }

    const time = (iso: string) =>
        new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })

    const lines = (rows: { name: string; quantity: number }[]) =>
        rows.map((l) => `${l.quantity} × ${l.name}`).join(", ") || "—"

    return (
        <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Card className="p-5">
                    <p className="text-xs font-bold uppercase tracking-widest text-slate-500">{t.exchange_log}</p>
                    <p className="text-3xl font-black text-slate-900 tabular-nums mt-1">{data.totals.count}</p>
                </Card>
                {/* The number a manager is actually looking for. */}
                <Card className="p-5 border-amber-200 bg-amber-50">
                    <p className="text-xs font-bold uppercase tracking-widest text-amber-700">{t.value_returned_shelf}</p>
                    <p className="text-3xl font-black text-amber-900 tabular-nums mt-1">{formatTHB(data.totals.returnedValue)}</p>
                </Card>
                <Card className="p-5">
                    <p className="text-xs font-bold uppercase tracking-widest text-slate-500">{t.exchange_charge}</p>
                    <p className="text-3xl font-black text-emerald-700 tabular-nums mt-1">{formatTHB(data.totals.charged)}</p>
                </Card>
                <Card className="p-5">
                    <p className="text-xs font-bold uppercase tracking-widest text-slate-500">{t.exchange_reversed}</p>
                    <p className="text-3xl font-black text-slate-400 tabular-nums mt-1">{data.totals.reversed}</p>
                </Card>
            </div>

            <Card className="overflow-hidden p-0 gap-0">
                <div className="px-4 py-3 border-b bg-slate-50">
                    <h2 className="font-bold text-slate-900">{t.by_staff}</h2>
                </div>
                {data.byStaff.map((s) => (
                    <div key={s.staff} className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-100 last:border-0">
                        <span className="font-bold text-slate-900 min-w-0 flex-1 truncate">{s.staff}</span>
                        <span className="text-sm text-slate-500 tabular-nums">{s.count}</span>
                        <span className="w-28 text-right font-black tabular-nums text-amber-700">
                            {formatTHB(s.returnedValue)}
                        </span>
                    </div>
                ))}
            </Card>

            <Card className="overflow-hidden p-0 gap-0">
                <div className="px-4 py-3 border-b bg-slate-50">
                    <h2 className="font-bold text-slate-900">{t.exchange_log}</h2>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-[10px] uppercase tracking-widest text-slate-500 border-b">
                                <th className="text-left font-bold px-4 py-2">{t.date_label}</th>
                                <th className="text-left font-bold px-4 py-2">{t.table}</th>
                                <th className="text-left font-bold px-4 py-2">{t.staff}</th>
                                <th className="text-left font-bold px-4 py-2">{t.exchange_out}</th>
                                <th className="text-left font-bold px-4 py-2">{t.exchange_in}</th>
                                <th className="text-right font-bold px-4 py-2">{t.value_returned_shelf}</th>
                                <th className="text-right font-bold px-4 py-2">{t.exchange_charge}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.swaps.map((s) => (
                                <tr key={s.id} className={`border-b border-slate-100 ${s.reversedAt ? "text-slate-400" : "text-slate-700"}`}>
                                    <td className="px-4 py-2.5 whitespace-nowrap tabular-nums">{time(s.at)}</td>
                                    <td className="px-4 py-2.5 font-bold">{s.table ?? "—"}</td>
                                    <td className="px-4 py-2.5">{s.staff ?? "—"}</td>
                                    <td className={`px-4 py-2.5 ${s.reversedAt ? "line-through" : "text-rose-600"}`}>{lines(s.out)}</td>
                                    <td className={`px-4 py-2.5 ${s.reversedAt ? "line-through" : "text-emerald-700"}`}>{lines(s.in)}</td>
                                    <td className="px-4 py-2.5 text-right tabular-nums font-bold">
                                        {s.reversedAt ? "—" : s.returnedValue > 0 ? formatTHB(s.returnedValue) : "—"}
                                    </td>
                                    <td className="px-4 py-2.5 text-right tabular-nums">
                                        {s.reversedAt
                                            ? <span className="text-[11px] font-bold">{t.exchange_reversed}</span>
                                            : s.charged > 0 ? formatTHB(s.charged) : "—"}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>

            {data.totals.returnedValue > 0 && (
                <p className="flex items-start gap-2 text-xs text-slate-500">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    {t.exchange_audit_hint}
                </p>
            )}
        </div>
    )
}
