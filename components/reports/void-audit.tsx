"use client"

import { useState, useEffect, useCallback } from "react"
import { useTranslation } from "@/hooks/use-translation"
import { Card } from "@/components/ui/card"
import { Ban } from "lucide-react"
import { formatTHB } from "@/lib/currency"

type VoidRow = {
    id: string
    voidedAt: string
    table: string | null
    round: number | null
    orderNumber: string
    item: string
    quantity: number
    value: number
    waiter: string | null
    voidedBy: string | null
    reason: string | null
    note: string | null
    wholeRound: boolean
}

type Payload = {
    rows: VoidRow[]
    byReason: { reason: string; count: number; value: number }[]
    byStaff: { name: string; count: number; value: number }[]
    totalCount: number
    totalValue: number
}

/**
 * The void audit report (req #24).
 *
 * Two names per row on purpose: the waiter who took the round and the staff
 * member who struck it. Collapsing them would hide the only pattern worth
 * hunting - one person doing the striking, over and over.
 *
 * Reads voided LINES rather than cancelled orders, so a manager sees that it
 * was five Chivas sets rather than five anonymous "orders".
 */
export function VoidAudit({ startDate, endDate }: { startDate: string; endDate: string }) {
    const { t } = useTranslation()
    const [data, setData] = useState<Payload | null>(null)
    const [loading, setLoading] = useState(true)

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const res = await fetch(`/api/reports/voids?startDate=${startDate}&endDate=${endDate}`)
            if (res.ok) setData(await res.json())
        } finally {
            setLoading(false)
        }
    }, [startDate, endDate])

    useEffect(() => { load() }, [load])

    const reasonLabel = (code: string | null) =>
        code ? ((t[`void_${code.toLowerCase()}` as keyof typeof t] as string) ?? code) : "—"

    const time = (iso: string) =>
        new Date(iso).toLocaleString("en-GB", {
            day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
        })

    if (loading) {
        return <div className="h-40 rounded-xl bg-white border border-slate-200 animate-pulse" />
    }

    if (!data || data.totalCount === 0) {
        return (
            <div className="text-center py-20">
                <div className="w-12 h-12 rounded-full bg-slate-100 grid place-items-center mx-auto mb-3">
                    <Ban className="w-6 h-6 text-slate-400" />
                </div>
                <p className="text-slate-900 font-semibold">{t.no_voids}</p>
            </div>
        )
    }

    return (
        <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Card className="p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{t.voids}</p>
                    <p className="text-3xl font-black text-slate-900 tabular-nums mt-1">{data.totalCount}</p>
                    <p className="text-sm font-bold text-rose-600 tabular-nums mt-1">
                        {formatTHB(data.totalValue)}
                    </p>
                </Card>

                {/* The reason the requirement asks for a fixed list rather than
                    free text: this breakdown is what tells a manager what keeps
                    going wrong, and typed prose could never be grouped. */}
                <Card className="p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">{t.by_reason}</p>
                    <div className="space-y-1.5">
                        {data.byReason.map((r) => (
                            <div key={r.reason} className="flex items-baseline justify-between gap-3 text-sm">
                                <span className="text-slate-700 truncate">{reasonLabel(r.reason)}</span>
                                <span className="tabular-nums font-bold text-slate-900 shrink-0">
                                    {r.count} · {formatTHB(r.value)}
                                </span>
                            </div>
                        ))}
                    </div>
                </Card>

                <Card className="p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">{t.by_staff}</p>
                    <div className="space-y-1.5">
                        {data.byStaff.map((s) => (
                            <div key={s.name} className="flex items-baseline justify-between gap-3 text-sm">
                                <span className="text-slate-700 truncate">{s.name}</span>
                                <span className="tabular-nums font-bold text-slate-900 shrink-0">
                                    {s.count} · {formatTHB(s.value)}
                                </span>
                            </div>
                        ))}
                    </div>
                </Card>
            </div>

            {/* Wide table, so it scrolls inside its own box rather than pushing
                the page sideways. */}
            <Card className="overflow-x-auto">
                <table className="w-full text-sm min-w-[820px]">
                    <thead>
                        <tr className="border-b border-slate-200 text-left">
                            {[t.time, t.table, t.item, t.qty, t.amount, t.server_staff, t.voided_by, t.void_reason, t.void_note]
                                .map((h, i) => (
                                    <th key={i} className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-wide text-slate-500 whitespace-nowrap">
                                        {h}
                                    </th>
                                ))}
                        </tr>
                    </thead>
                    <tbody>
                        {data.rows.map((r) => (
                            <tr key={r.id} className="border-b border-slate-100 last:border-0">
                                <td className="px-3 py-2.5 tabular-nums text-slate-500 whitespace-nowrap">{time(r.voidedAt)}</td>
                                <td className="px-3 py-2.5 font-semibold text-slate-800 whitespace-nowrap">
                                    {r.table ?? r.orderNumber}
                                    {r.round != null && <span className="text-slate-400"> #{r.round}</span>}
                                    {/* A whole round struck at once reads differently
                                        from one line coming back, so say which. */}
                                    {r.wholeRound && (
                                        <span className="ms-1.5 text-[10px] font-bold text-rose-600">{t.void_round}</span>
                                    )}
                                </td>
                                <td className="px-3 py-2.5 text-slate-900">{r.item}</td>
                                <td className="px-3 py-2.5 tabular-nums text-slate-700">{r.quantity}</td>
                                <td className="px-3 py-2.5 tabular-nums font-bold text-rose-600 whitespace-nowrap">
                                    {formatTHB(r.value)}
                                </td>
                                <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{r.waiter ?? "—"}</td>
                                <td className="px-3 py-2.5 font-semibold text-slate-800 whitespace-nowrap">{r.voidedBy ?? "—"}</td>
                                <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{reasonLabel(r.reason)}</td>
                                <td className="px-3 py-2.5 text-slate-500 max-w-[220px] truncate">{r.note ?? ""}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </Card>
        </div>
    )
}
