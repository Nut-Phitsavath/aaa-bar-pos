"use client"

import { useState, useEffect } from "react"
import { useTranslation } from "@/hooks/use-translation"
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card"
import { Trophy, AlertTriangle } from "lucide-react"
import { formatTHB } from "@/lib/currency"

type ServerRow = {
    id: string; name: string
    revenue: number; orders: number; items: number; tables: number
    voids: number; voidValue: number; discounts: number
    avgOrder: number; share: number
}

/**
 * Who served the most (requirement #23).
 *
 * Built for one conversation: which server earns a bonus. So it leads with a
 * ranking rather than a chart, and shows voids and discounts beside the
 * takings - a big number is a different fact from a clean one, and the manager
 * paying the bonus needs both in the same glance.
 */
export function ServerPerformance({ startDate, endDate }: { startDate: string; endDate: string }) {
    const { t } = useTranslation()
    const [rows, setRows] = useState<ServerRow[]>([])
    const [total, setTotal] = useState(0)
    const [loading, setLoading] = useState(true)
    // Req #23 asks for this per shift, and a shift is not a date: the night
    // crosses midnight, so "5 Sep" cuts one night's takings in two. The dates
    // stay the default because they are what the rest of the reports page is
    // showing; picking a shift overrides them.
    const [shifts, setShifts] = useState<{ id: string; startTime: string; endTime: string | null }[]>([])
    const [shiftId, setShiftId] = useState("")

    // Only the shifts inside the dates chosen at the top of the page. The
    // calendar stays the one thing that sets the period; this narrows it to a
    // single night within it, rather than being a second, disagreeing filter.
    useEffect(() => {
        const from = new Date(startDate).getTime()
        const to = new Date(endDate).getTime()
        fetch('/api/shifts')
            .then((r) => (r.ok ? r.json() : []))
            .then((s: any[]) => {
                const inRange = (Array.isArray(s) ? s : []).filter((x) => {
                    const began = new Date(x.startTime).getTime()
                    // An open shift runs up to now, so it counts against a range
                    // that ends today.
                    const ended = x.endTime ? new Date(x.endTime).getTime() : Date.now()
                    return began <= to && ended >= from
                })
                setShifts(inRange)
                // The picked shift may have just fallen outside the new dates.
                setShiftId((id) => (inRange.some((x) => x.id === id) ? id : ""))
            })
            .catch(() => setShifts([]))
    }, [startDate, endDate])

    useEffect(() => {
        setLoading(true)
        const query = shiftId
            ? `shiftId=${shiftId}`
            : `startDate=${startDate}&endDate=${endDate}`
        fetch(`/api/reports/servers?${query}`)
            .then((r) => (r.ok ? r.json() : { servers: [], totalRevenue: 0 }))
            .then((d) => { setRows(d.servers ?? []); setTotal(d.totalRevenue ?? 0) })
            .catch(() => setRows([]))
            .finally(() => setLoading(false))
    }, [startDate, endDate, shiftId])

    const stamp = (iso: string) => new Date(iso).toLocaleString(undefined, {
        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    })

    // ponytail: a native select. One control, no popover, and it is already
    // the right thing on a touch till. Nothing to drill into when the chosen
    // dates hold no shifts, so the control does not appear at all.
    const scope = shifts.length === 0 ? null : (
        <div className="flex items-center gap-2">
            <label htmlFor="server-scope" className="text-xs font-bold uppercase tracking-widest text-slate-500">
                {t.report_scope}
            </label>
            <select
                id="server-scope"
                value={shiftId}
                onChange={(e) => setShiftId(e.target.value)}
                className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 max-w-full"
            >
                <option value="">{t.scope_selected_dates}</option>
                {shifts.map((s) => (
                    <option key={s.id} value={s.id}>
                        {stamp(s.startTime)} → {s.endTime ? stamp(s.endTime) : t.shift_in_progress}
                    </option>
                ))}
            </select>
        </div>
    )

    if (loading) {
        return (
            <div className="space-y-6">
                {scope}
                <div className="h-64 rounded-xl bg-white border border-slate-200 animate-pulse" />
            </div>
        )
    }

    if (rows.length === 0) {
        return (
            <div className="space-y-6">
                {scope}
                <Card>
                    <CardContent className="py-16 text-center text-slate-500">
                        {t.no_server_sales}
                    </CardContent>
                </Card>
            </div>
        )
    }

    const top = rows[0]
    const best = Math.max(...rows.map((r) => r.revenue), 1)

    return (
        <div className="space-y-6">
            {scope}
            <Card className="border-amber-200 bg-amber-50">
                <CardContent className="py-5 flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-amber-500 grid place-items-center shrink-0">
                        <Trophy className="w-6 h-6 text-white" />
                    </div>
                    <div className="min-w-0">
                        <p className="text-xs font-bold uppercase tracking-widest text-amber-800">
                            {t.top_server}
                        </p>
                        <p className="text-2xl font-black text-slate-900 leading-none mt-1 truncate">
                            {top.name}
                        </p>
                        <p className="text-sm text-slate-600 mt-1 tabular-nums">
                            {formatTHB(top.revenue)} · {top.share}% {t.of_takings} · {top.tables} {t.tables}
                        </p>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>{t.server_ranking}</CardTitle>
                    <CardDescription>{t.server_ranking_desc}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {rows.map((r, i) => (
                        <div key={r.id}>
                            <div className="flex items-baseline gap-3">
                                <span className="w-6 text-sm font-black text-slate-400 tabular-nums shrink-0">
                                    {i + 1}
                                </span>
                                <span className="font-bold text-slate-900 truncate">{r.name}</span>
                                <span className="ms-auto font-black text-slate-900 tabular-nums shrink-0">
                                    {formatTHB(r.revenue)}
                                </span>
                                <span className="w-12 text-right text-xs text-slate-400 tabular-nums shrink-0">
                                    {r.share}%
                                </span>
                            </div>

                            {/* Bar beneath the row rather than a separate chart:
                                the comparison is the point, and a reader should
                                not have to look in two places for it. */}
                            <div className="h-2 rounded-full bg-slate-100 mt-1.5 ms-9 overflow-hidden">
                                <div
                                    className="h-full rounded-full bg-amber-500"
                                    style={{ width: `${(r.revenue / best) * 100}%` }}
                                />
                            </div>

                            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500 mt-1.5 ms-9 tabular-nums">
                                <span>{r.tables} {t.tables}</span>
                                <span>{r.orders} {t.orders}</span>
                                <span>{r.items} {t.item}</span>
                                <span>{t.avg_order_value}: {formatTHB(r.avgOrder)}</span>
                                {r.discounts > 0 && (
                                    <span className="text-rose-600">
                                        {t.apply_discount}: {formatTHB(r.discounts)}
                                    </span>
                                )}
                                {r.voids > 0 && (
                                    <span className="text-orange-700 font-semibold inline-flex items-center gap-1">
                                        <AlertTriangle className="w-3 h-3" />
                                        {r.voids} {t.state_void} ({formatTHB(r.voidValue)})
                                    </span>
                                )}
                            </div>
                        </div>
                    ))}

                    <div className="flex justify-between pt-4 border-t font-bold text-slate-900">
                        <span>{t.total_caps}</span>
                        <span className="tabular-nums">{formatTHB(total)}</span>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
