"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Printer, ArrowLeft } from "lucide-react"
import { useTranslation } from "@/hooks/use-translation"
import { APP_NAME } from "@/lib/shop"
import { formatStock } from "@/lib/stock"

/**
 * The stock count sheet (requirement #22).
 *
 * A piece of paper on a clipboard, not a screen: the person counting is
 * standing at the fridge with a pen, and the whole point is to find what the
 * till never saw - a bottle that went out unkeyed leaves no record to read
 * back, so the count has to start from the shelf.
 *
 * The system figure is printed beside a blank box on purpose. Hiding it would
 * make the count "blind" and harder to fudge, but this bar counts with two or
 * three people at 2am and a blind count means walking back to the screen for
 * every line; the signature lines at the foot are what makes it accountable.
 *
 * Shop stock only. The warehouse is counted on delivery day, not per shift.
 */

const PRINT_CSS = `
  @media print {
    @page { margin: 12mm 10mm; size: A4 portrait; }
    body { background: white !important; }
    /* The app chrome is not part of the form: the sidebar is a fixed panel and
       would print as a black stripe down every page. */
    aside, .no-print { display: none !important; }
    /* ...and the padding the layout leaves for it goes with it. */
    main { padding-left: 0 !important; }
    .sheet { box-shadow: none !important; border: none !important; padding: 0 !important; max-width: none !important; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; }
  }
`

type Row = {
    id: string
    name: string
    unit: string
    subStock: number
    category?: { name: string } | null
}

type Shift = { id: string; startTime: string; responsiblePerson: string | null }

export default function AuditSheetPage() {
    const { t } = useTranslation()
    const router = useRouter()
    const [rows, setRows] = useState<Row[]>([])
    const [shift, setShift] = useState<Shift | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        document.title = `${t.audit_sheet} | ${APP_NAME}`
        Promise.all([
            fetch("/api/inventory").then((r) => (r.ok ? r.json() : [])),
            fetch("/api/shifts?status=OPEN").then((r) => (r.ok ? r.json() : [])),
        ])
            .then(([items, shifts]) => {
                setRows(Array.isArray(items) ? items : [])
                setShift(Array.isArray(shifts) && shifts[0] ? shifts[0] : null)
            })
            .catch(() => setRows([]))
            .finally(() => setLoading(false))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Grouped, because that is the order someone walks the room in: the fridge,
    // then the spirits shelf, then the kitchen.
    const groups = new Map<string, Row[]>()
    for (const r of rows) {
        const key = r.category?.name ?? "—"
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key)!.push(r)
    }

    const printedAt = new Date().toLocaleString("en-GB", {
        day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    })

    return (
        <div className="min-h-screen bg-slate-200 py-8 px-4 print:bg-white print:p-0">
            <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

            <div className="no-print max-w-[210mm] mx-auto mb-6 flex gap-3">
                <Button onClick={() => window.print()} className="h-11 bg-slate-900 hover:bg-slate-800">
                    <Printer className="w-4 h-4 mr-2" /> {t.print}
                </Button>
                <Button variant="outline" onClick={() => router.push("/inventory")} className="h-11 bg-white">
                    <ArrowLeft className="w-4 h-4 mr-2" /> {t.back}
                </Button>
                <span className="self-center text-sm text-slate-600">{t.audit_sheet_desc}</span>
            </div>

            <div className="sheet max-w-[210mm] mx-auto bg-white shadow-xl p-10 text-slate-900">
                <div className="flex items-end justify-between border-b-2 border-slate-900 pb-3">
                    <div>
                        <h1 className="text-2xl font-black tracking-tight">{APP_NAME}</h1>
                        <p className="text-sm font-bold uppercase tracking-[0.2em] text-slate-500">
                            {t.audit_sheet}
                        </p>
                    </div>
                    <div className="text-right text-xs leading-relaxed text-slate-600">
                        <p>{printedAt}</p>
                        <p>
                            {shift
                                ? `${t.shift_started}: ${new Date(shift.startTime).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`
                                : t.no_shift_open}
                        </p>
                        {shift?.responsiblePerson && <p>{shift.responsiblePerson}</p>}
                    </div>
                </div>

                {loading ? (
                    <p className="py-16 text-center text-slate-400">…</p>
                ) : (
                    Array.from(groups.entries()).map(([category, items]) => (
                        <div key={category} className="mt-6">
                            <h2 className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500 mb-1">
                                {category}
                            </h2>
                            <table className="w-full border-collapse text-sm">
                                <thead>
                                    <tr className="border-y border-slate-300 text-[10px] uppercase tracking-widest text-slate-500">
                                        <th className="text-left font-bold py-1.5">{t.item}</th>
                                        <th className="text-left font-bold py-1.5 w-20">{t.unit}</th>
                                        <th className="text-right font-bold py-1.5 w-24">{t.system_qty}</th>
                                        <th className="text-right font-bold py-1.5 w-28">{t.counted_qty}</th>
                                        <th className="text-right font-bold py-1.5 w-28">{t.difference_label}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {items.map((r) => (
                                        <tr key={r.id} className="border-b border-slate-200">
                                            <td className="py-2 font-semibold">{r.name}</td>
                                            <td className="py-2 text-slate-500">{r.unit}</td>
                                            <td className="py-2 text-right tabular-nums">{formatStock(r.subStock)}</td>
                                            {/* Ruled boxes, wide enough to write in with a pen. */}
                                            <td className="py-2">
                                                <div className="h-6 border-b border-slate-400 ms-3" />
                                            </td>
                                            <td className="py-2">
                                                <div className="h-6 border-b border-slate-400 ms-3" />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ))
                )}

                <div className="mt-12 grid grid-cols-2 gap-10 text-xs text-slate-600">
                    <div>
                        <div className="h-10 border-b border-slate-400" />
                        <p className="mt-1 font-bold uppercase tracking-widest">{t.counted_by}</p>
                    </div>
                    <div>
                        <div className="h-10 border-b border-slate-400" />
                        <p className="mt-1 font-bold uppercase tracking-widest">{t.checked_by}</p>
                    </div>
                </div>
            </div>
        </div>
    )
}
