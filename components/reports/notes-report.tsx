"use client"

import { useState, useEffect, useCallback } from "react"
import { useTranslation } from "@/hooks/use-translation"
import { Card } from "@/components/ui/card"
import { StickyNote, ShoppingBag } from "lucide-react"

type RankedNote = {
    note: string
    count: number
    lastAt: string | null
    items: { name: string; count: number }[]
}

type RecentNote = {
    id: string
    at: string | null
    note: string
    item: string
    quantity: number
    isTakeaway: boolean
    voided: boolean
    staff: string | null
    table: string | null
    orderNumber: string | null
}

type Payload = {
    ranked: RankedNote[]
    recent: RecentNote[]
    summary: { total: number; distinct: number; capped: boolean }
}

/**
 * What the bar keeps being asked for.
 *
 * Sits beside the void audit because it is the same kind of report: staff act
 * freely during service - nobody stops a bartender to approve "no ice" - and
 * the manager sees the pattern the next morning.
 *
 * The ranking is the point, not the log. A note typed twice is one customer's
 * preference. A note typed two hundred times is the system telling you it
 * should be a one-tap choice rather than something five people spell five
 * different ways. The log underneath is for reading one in context when a
 * particular bill is in question.
 *
 * Says nothing about stock, deliberately. A note is free text in two languages
 * and cannot drive a deduction; an exclusion that should move stock has to
 * become a structured choice with a recipe behind it. Finding which ones
 * deserve that is what this screen is for.
 */
export function NotesReport({ startDate, endDate }: { startDate: string; endDate: string }) {
    const { t } = useTranslation()
    const [data, setData] = useState<Payload | null>(null)
    const [loading, setLoading] = useState(true)

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const res = await fetch(`/api/reports/notes?startDate=${startDate}&endDate=${endDate}`)
            if (res.ok) setData(await res.json())
        } finally {
            setLoading(false)
        }
    }, [startDate, endDate])

    useEffect(() => { load() }, [load])

    const time = (iso: string | null) =>
        iso
            ? new Date(iso).toLocaleString("en-GB", {
                day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
            })
            : "—"

    if (loading) {
        return <div className="h-40 rounded-xl bg-white border border-slate-200 animate-pulse" />
    }

    if (!data || data.summary.total === 0) {
        return (
            <div className="text-center py-20">
                <div className="w-12 h-12 rounded-full bg-slate-100 grid place-items-center mx-auto mb-3">
                    <StickyNote className="w-6 h-6 text-slate-400" />
                </div>
                <p className="text-slate-900 font-semibold">{t.no_prep_notes}</p>
            </div>
        )
    }

    // The widest bar in the ranking, so every other bar is drawn relative to
    // the busiest request rather than to an invented ceiling.
    const busiest = data.ranked[0]?.count ?? 1

    return (
        <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Card className="p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{t.prep_notes}</p>
                    <p className="text-3xl font-black text-slate-900 tabular-nums mt-1">{data.summary.total}</p>
                </Card>
                <Card className="p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{t.distinct_requests}</p>
                    <p className="text-3xl font-black text-slate-900 tabular-nums mt-1">{data.summary.distinct}</p>
                </Card>
            </div>

            {/* The ranking. Bars rather than bare numbers because the question
                a manager is answering here is comparative - is this one request
                dwarfing the rest, or is it a long flat tail of one-offs? */}
            <Card className="p-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">{t.most_asked}</p>
                <div className="space-y-2.5">
                    {data.ranked.map((r) => (
                        <div key={r.note}>
                            <div className="flex items-baseline justify-between gap-3">
                                <span className="text-sm font-bold text-slate-900 truncate">{r.note}</span>
                                <span className="text-sm font-black tabular-nums text-slate-900 shrink-0">{r.count}</span>
                            </div>
                            <div className="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                <div
                                    className="h-full rounded-full bg-amber-500"
                                    style={{ width: `${Math.max(4, (r.count / busiest) * 100)}%` }}
                                />
                            </div>
                            <p className="text-[11px] text-slate-500 mt-1 truncate">
                                {r.items.map((i) => `${i.name} (${i.count})`).join(" · ")}
                            </p>
                        </div>
                    ))}
                </div>
            </Card>

            {/* The log. Second, because one note read in isolation is a
                curiosity; it earns its place when a specific bill is disputed. */}
            <Card className="p-0 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{t.details}</p>
                </div>
                <div className="divide-y divide-slate-100">
                    {data.recent.map((r) => (
                        <div key={r.id} className={`px-4 py-2.5 flex items-baseline gap-3 text-sm ${r.voided ? "opacity-50" : ""}`}>
                            <span className="text-[11px] tabular-nums text-slate-400 shrink-0 w-24">{time(r.at)}</span>
                            <span className="text-[11px] font-bold text-slate-500 shrink-0 w-12 truncate">{r.table ?? "—"}</span>
                            <span className={`text-slate-900 truncate ${r.voided ? "line-through" : ""}`}>
                                {r.quantity} × {r.item}
                            </span>
                            <span className="flex items-center gap-1 text-amber-800 min-w-0 ms-auto">
                                {r.isTakeaway && <ShoppingBag className="w-3 h-3 shrink-0 text-blue-700" />}
                                <StickyNote className="w-3 h-3 shrink-0" />
                                <span className="truncate">{r.note}</span>
                            </span>
                            <span className="text-[11px] text-slate-400 shrink-0 w-20 truncate text-right">{r.staff ?? "—"}</span>
                        </div>
                    ))}
                </div>
                {data.summary.capped && (
                    <p className="px-4 py-2 text-[11px] text-slate-400 border-t border-slate-100">
                        {t.showing_latest_500}
                    </p>
                )}
            </Card>
        </div>
    )
}
