"use client"

import { useState, useEffect, useCallback } from "react"
import { useTranslation } from "@/hooks/use-translation"
import { Card } from "@/components/ui/card"
import { ClipboardCheck } from "lucide-react"
import { formatTHB } from "@/lib/currency"
import { formatDual, type MeasureType } from "@/lib/stock"

type VarianceRow = {
    id: string
    countedAt: string
    countedBy: string
    ingredient: string
    measureType: MeasureType
    purchaseUnit: string
    purchaseMultiplier: number
    theoretical: number
    actual: number
    difference: number
    valueAtCost: number
    notes: string | null
}

type Payload = {
    rows: VarianceRow[]
    shrinkage: number
    overage: number
}

/**
 * Stock variance: what the shelf said against what the till thought.
 *
 * The data has been collected since the audit sheet shipped and nothing ever
 * read it back. Quantities print the same way the audit sheet does - "3 bottles
 * + 250 ml" - because this report is read next to that piece of paper.
 */
export function VarianceReport({ startDate, endDate }: { startDate: string; endDate: string }) {
    const { t } = useTranslation()
    const [data, setData] = useState<Payload | null>(null)
    const [loading, setLoading] = useState(true)

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const res = await fetch(`/api/reports/variance?startDate=${startDate}&endDate=${endDate}`)
            if (res.ok) setData(await res.json())
        } finally {
            setLoading(false)
        }
    }, [startDate, endDate])

    useEffect(() => { load() }, [load])

    const qty = (row: VarianceRow, value: number) =>
        formatDual(value, {
            measureType: row.measureType,
            purchaseUnit: row.purchaseUnit,
            multiplier: row.purchaseMultiplier,
        })

    if (loading) {
        return <div className="h-40 rounded-2xl bg-slate-100 animate-pulse" aria-hidden />
    }

    if (!data || data.rows.length === 0) {
        // An empty state that teaches the loop rather than saying "nothing here".
        return (
            <Card className="p-12 flex flex-col items-center text-center gap-3 border-dashed">
                <ClipboardCheck className="w-10 h-10 text-slate-200" />
                <p className="max-w-sm text-sm text-slate-400 leading-relaxed">{t.no_counts_yet}</p>
            </Card>
        )
    }

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Kept apart rather than netted: a night that lost 5,000 and
                    found 5,000 is not a night that balanced. */}
                <Card className="p-5">
                    <p className="text-xs font-black uppercase tracking-widest text-slate-400">{t.shrinkage}</p>
                    <p className="text-3xl font-black text-rose-600 tabular-nums mt-1">
                        {formatTHB(data.shrinkage)}
                    </p>
                </Card>
                <Card className="p-5">
                    <p className="text-xs font-black uppercase tracking-widest text-slate-400">{t.overage}</p>
                    <p className="text-3xl font-black text-emerald-700 tabular-nums mt-1">
                        {formatTHB(data.overage)}
                    </p>
                </Card>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm min-w-[720px]">
                    <thead>
                        <tr className="border-y border-slate-200 text-[10px] uppercase tracking-widest text-slate-500">
                            <th className="text-left font-bold py-2.5">{t.item}</th>
                            <th className="text-right font-bold py-2.5">{t.system_qty}</th>
                            <th className="text-right font-bold py-2.5">{t.counted_qty}</th>
                            <th className="text-right font-bold py-2.5">{t.difference_label}</th>
                            <th className="text-right font-bold py-2.5">{t.value}</th>
                            <th className="text-left font-bold py-2.5 ps-6">{t.counted_by}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.rows.map((row) => (
                            <tr key={row.id} className="border-b border-slate-100">
                                <td className="py-2.5 font-semibold text-slate-900">{row.ingredient}</td>
                                <td className="py-2.5 text-right tabular-nums text-slate-500">{qty(row, row.theoretical)}</td>
                                <td className="py-2.5 text-right tabular-nums text-slate-900">{qty(row, row.actual)}</td>
                                <td className={`py-2.5 text-right tabular-nums font-bold ${
                                    row.difference < 0 ? "text-rose-600" : row.difference > 0 ? "text-emerald-700" : "text-slate-400"
                                }`}>
                                    {row.difference > 0 ? "+" : ""}{qty(row, row.difference)}
                                </td>
                                <td className={`py-2.5 text-right tabular-nums font-bold ${
                                    row.valueAtCost < 0 ? "text-rose-600" : row.valueAtCost > 0 ? "text-emerald-700" : "text-slate-400"
                                }`}>
                                    {formatTHB(row.valueAtCost)}
                                </td>
                                <td className="py-2.5 ps-6 text-slate-500">
                                    {row.countedBy}
                                    <span className="block text-[10px] text-slate-400">
                                        {new Date(row.countedAt).toLocaleString("en-US", {
                                            month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
                                        })}
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
