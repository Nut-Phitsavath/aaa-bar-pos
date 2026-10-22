"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { ArrowLeft, Printer, ClipboardCheck, AlertTriangle } from "lucide-react"
// The app's own toast vocabulary: title stands alone, specifics go in the
// description, durations are set per severity in one place.
import { notify } from "@/components/ui/sonner"
import { useTranslation } from "@/hooks/use-translation"
import { APP_NAME } from "@/lib/shop"
import { formatTHB } from "@/lib/currency"
import { formatStockOf, toBase, type MeasureType } from "@/lib/units"

/**
 * Entering the count sheet (requirement #22, the half that was missing).
 *
 * The sheet has printed and somebody has walked the room with a pen. This is
 * where the pen meets the database, and until it existed the loop had no end:
 * StockCount could be written, the variance report could read it, and no screen
 * in the app ever put a row in the table.
 *
 * Built for the moment it is used - two or three people at the bar top at 2am,
 * one reading figures off paper and one typing on a tablet. That forces almost
 * every decision here: rows in the same order the sheet prints them, the system
 * figure sitting beside the box you type in so nobody walks back to a screen,
 * touch-sized inputs, and a running total that stays on screen so a long sheet
 * never loses its place.
 *
 * THE RULE THIS SCREEN IS BUILT AROUND: blank is not zero.
 *
 * An empty box means "I did not count this". A typed 0 means "this shelf is
 * empty", which is a serious and useful reading. Collapsing the two would let a
 * half-finished sheet zero out every item nobody reached, and the submit would
 * dutifully write the shelf to nothing. Every line is held as the string that
 * was typed, and only lines with something in them are ever sent.
 */

type Row = {
    id: string
    name: string
    subStock: number
    cost: number
    measureType: MeasureType
    purchaseUnit: string
    purchaseMultiplier: number
    category?: { name: string } | null
}

type Shift = { id: string; startTime: string }

export default function StockCountPage() {
    const { t } = useTranslation()
    const router = useRouter()

    const [rows, setRows] = useState<Row[]>([])
    const [shift, setShift] = useState<Shift | null>(null)
    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState(false)
    const [confirming, setConfirming] = useState(false)

    /** Raw strings, exactly as typed. See the rule above. */
    const [entries, setEntries] = useState<Record<string, string>>({})
    const [notes, setNotes] = useState<Record<string, string>>({})

    useEffect(() => {
        document.title = `${t.enter_count} | ${APP_NAME}`
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

    // Same grouping as the printed sheet, because that is the order someone
    // walks the room in: the fridge, then the spirits shelf, then the kitchen.
    const groups = useMemo(() => {
        const m = new Map<string, Row[]>()
        for (const r of rows) {
            const key = r.category?.name ?? "—"
            if (!m.has(key)) m.set(key, [])
            m.get(key)!.push(r)
        }
        return Array.from(m.entries())
    }, [rows])

    /** What a line resolves to, or null when the box is empty. */
    const readLine = (r: Row) => {
        const raw = entries[r.id]
        if (raw == null || raw.trim() === "") return null
        const n = Number(raw)
        if (!Number.isFinite(n) || n < 0) return { invalid: true as const }
        const multiplier = r.purchaseMultiplier || 1
        const actual = toBase(n, multiplier)
        const difference = actual - r.subStock
        return {
            invalid: false as const,
            actual,
            difference,
            value: difference * (r.cost / multiplier),
        }
    }

    const summary = useMemo(() => {
        let counted = 0, shrinkage = 0, overage = 0, invalid = 0, discrepancies = 0
        for (const r of rows) {
            const line = readLine(r)
            if (!line) continue
            if (line.invalid) { invalid += 1; continue }
            counted += 1
            if (line.difference !== 0) discrepancies += 1
            // Kept apart, never netted: a night that lost 5,000 and found 5,000
            // is not a night that balanced, it is two problems.
            if (line.value < 0) shrinkage += line.value
            else overage += line.value
        }
        return { counted, shrinkage, overage, invalid, discrepancies, total: rows.length }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rows, entries])

    const submit = async () => {
        setBusy(true)
        try {
            const counts = rows.flatMap((r) => {
                const line = readLine(r)
                if (!line || line.invalid) return []
                return [{ ingredientId: r.id, actualStock: line.actual, notes: notes[r.id]?.trim() || undefined }]
            })

            const res = await fetch("/api/inventory/stock-count", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ counts }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) { notify.error(t.count_failed); return }

            notify.success(t.count_submitted, {
                description: t.count_submitted_desc
                    .replace("{counted}", String(data.counted ?? counts.length))
                    .replace("{discrepancies}", String(data.discrepancies ?? 0)),
            })
            // Straight to the report the count was taken for. Landing back on
            // the inventory list would leave the person who just walked the
            // room to go and find the thing they did it for.
            router.push("/reports")
        } catch {
            notify.error(t.count_failed)
        } finally {
            setBusy(false)
            setConfirming(false)
        }
    }

    const canSubmit = summary.counted > 0 && summary.invalid === 0 && !busy

    return (
        <div className="min-h-screen bg-slate-50 pb-32">
            <style dangerouslySetInnerHTML={{ __html: REDUCED_MOTION_CSS }} />

            <header className="sticky top-0 z-20 border-b bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
                <div className="mx-auto max-w-5xl px-4 py-3 flex items-center gap-3">
                    <Button
                        variant="ghost" size="icon"
                        onClick={() => router.push("/inventory")}
                        aria-label={t.back}
                        className="h-10 w-10 shrink-0"
                    >
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <div className="min-w-0">
                        <h1 className="text-lg font-black tracking-tight text-slate-900 truncate">
                            {t.enter_count}
                        </h1>
                        <p className="text-xs text-slate-500 truncate">{t.enter_count_desc}</p>
                    </div>
                    <Button
                        variant="outline"
                        onClick={() => router.push("/inventory/audit-sheet")}
                        className="ms-auto h-10 hidden sm:inline-flex"
                    >
                        <Printer className="h-4 w-4 mr-2" /> {t.print_count_sheet}
                    </Button>
                </div>
            </header>

            <main className="mx-auto max-w-5xl px-4 pt-5">
                {!loading && !shift && (
                    <p className="mb-5 flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-slate-900">
                        <AlertTriangle className="h-4 w-4 shrink-0 text-orange-600" />
                        {t.no_shift_warning}
                    </p>
                )}

                {loading ? (
                    // A skeleton in the shape of the rows, not a spinner: the
                    // page it becomes is a list, and the list should not jump.
                    <div className="space-y-2" aria-hidden>
                        {Array.from({ length: 8 }).map((_, i) => (
                            <div key={i} className="h-16 rounded-xl bg-slate-200/60 animate-pulse" />
                        ))}
                    </div>
                ) : (
                    groups.map(([category, items]) => (
                        <section key={category} className="mb-7">
                            <h2 className="mb-2 text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">
                                {category}
                            </h2>
                            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
                                {items.map((r) => (
                                    <CountRow
                                        key={r.id}
                                        row={r}
                                        raw={entries[r.id] ?? ""}
                                        note={notes[r.id] ?? ""}
                                        line={readLine(r)}
                                        onChange={(v) => setEntries((s) => ({ ...s, [r.id]: v }))}
                                        onNote={(v) => setNotes((s) => ({ ...s, [r.id]: v }))}
                                        t={t}
                                    />
                                ))}
                            </div>
                        </section>
                    ))
                )}
            </main>

            {/* Stays on screen because the sheet is long and the question
                "how far am I" should never need a scroll to answer. */}
            <div
                className={`fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur
                            transition-transform duration-200 ease-out motion-safe:will-change-transform
                            ${summary.counted > 0 ? "translate-y-0" : "translate-y-full"}`}
            >
                <div className="mx-auto max-w-5xl px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
                    <p className="text-sm font-bold text-slate-700 tabular-nums">
                        {t.lines_counted
                            .replace("{done}", String(summary.counted))
                            .replace("{total}", String(summary.total))}
                    </p>
                    <p className="text-sm tabular-nums">
                        <span className="text-slate-500">{t.shrinkage} </span>
                        <span className="font-black text-rose-600">{formatTHB(Math.abs(summary.shrinkage))}</span>
                    </p>
                    <p className="text-sm tabular-nums">
                        <span className="text-slate-500">{t.overage} </span>
                        <span className="font-black text-emerald-700">{formatTHB(summary.overage)}</span>
                    </p>
                    <Button
                        onClick={() => setConfirming(true)}
                        disabled={!canSubmit}
                        className="ms-auto h-12 px-6 bg-amber-600 hover:bg-amber-700 font-bold"
                    >
                        <ClipboardCheck className="h-4 w-4 mr-2" />
                        {busy ? t.submitting_count : t.submit_count}
                    </Button>
                </div>
            </div>

            {/* A modal is usually laziness, but this one is earned: the action
                moves physical stock and cannot be undone from this screen. */}
            <AlertDialog open={confirming} onOpenChange={setConfirming}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t.count_confirm_title}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t.count_confirm_body}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm tabular-nums space-y-1">
                        <p className="text-slate-700">
                            {t.lines_counted
                                .replace("{done}", String(summary.counted))
                                .replace("{total}", String(summary.total))}
                            {summary.discrepancies > 0 && (
                                <span className="text-slate-500"> · {summary.discrepancies} ≠</span>
                            )}
                        </p>
                        <p>
                            <span className="text-slate-500">{t.shrinkage} </span>
                            <span className="font-bold text-rose-600">{formatTHB(Math.abs(summary.shrinkage))}</span>
                            <span className="text-slate-300"> | </span>
                            <span className="text-slate-500">{t.overage} </span>
                            <span className="font-bold text-emerald-700">{formatTHB(summary.overage)}</span>
                        </p>
                    </div>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="h-11">{t.cancel}</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(e) => { e.preventDefault(); submit() }}
                            disabled={busy}
                            className="h-11 bg-amber-600 hover:bg-amber-700 font-bold"
                        >
                            {busy ? t.submitting_count : t.confirm}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}

/**
 * One shelf, one box to type in.
 *
 * The system figure sits directly beside the input rather than behind a
 * disclosure: the sheet prints it that way on purpose, and hiding it here would
 * make the screen disagree with the paper it is being read from.
 */
function CountRow({ row, raw, note, line, onChange, onNote, t }: {
    row: Row
    raw: string
    note: string
    line: ReturnType<typeof Object> | any
    onChange: (v: string) => void
    onNote: (v: string) => void
    t: any
}) {
    const counted = line && !line.invalid
    const diff = counted ? line.difference : 0

    const state = !counted ? "none" : diff === 0 ? "exact" : diff < 0 ? "short" : "over"
    const chip = {
        none: "text-slate-400",
        exact: "text-slate-500",
        short: "text-rose-600",
        over: "text-emerald-700",
    }[state]

    return (
        <div className="px-3 py-2.5 sm:px-4 sm:py-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                    <p className="font-bold text-slate-900 leading-tight">{row.name}</p>
                    <p className="text-xs text-slate-500 tabular-nums">
                        {t.system_qty} {formatStockOf(row.subStock, row)}
                    </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    <Input
                        value={raw}
                        onChange={(e) => onChange(e.target.value)}
                        inputMode="decimal"
                        // A number input's spinners and scroll-to-change are a
                        // liability on a tablet next to a wet bar.
                        type="text"
                        placeholder={t.not_counted}
                        aria-label={`${row.name} — ${t.counted_qty} (${row.purchaseUnit})`}
                        aria-invalid={line?.invalid || undefined}
                        className={`h-12 w-28 text-right text-base font-bold tabular-nums
                                    ${line?.invalid ? "border-rose-400 focus-visible:ring-rose-400" : ""}`}
                    />
                    <span className="w-14 text-xs text-slate-500">{row.purchaseUnit}</span>
                </div>

                <p className={`w-24 shrink-0 text-right text-sm font-black tabular-nums transition-colors duration-150 ${chip}`}>
                    {!counted
                        ? "—"
                        : diff === 0
                            ? t.exact_label
                            : `${diff > 0 ? "+" : ""}${formatStockOf(Math.abs(diff), row).replace(/^/, diff < 0 ? "−" : "")}`}
                </p>

                <p className={`w-24 shrink-0 text-right text-sm tabular-nums ${chip}`}>
                    {counted && diff !== 0 ? formatTHB(Math.abs(line.value)) : ""}
                </p>
            </div>

            {/* The note appears only where one is worth writing. A field on
                every line would crowd the sheet and get skipped; a field that
                shows up the moment a shelf disagrees gets filled in. */}
            {counted && diff !== 0 && (
                <Input
                    value={note}
                    onChange={(e) => onNote(e.target.value)}
                    placeholder={t.reason_example}
                    aria-label={`${row.name} — ${t.notes}`}
                    className="mt-2 h-10 text-sm bg-slate-50 border-slate-200"
                />
            )}
        </div>
    )
}

const REDUCED_MOTION_CSS = `
  @media (prefers-reduced-motion: reduce) {
    /* The summary bar still arrives, it just stops sliding. */
    .fixed.inset-x-0.bottom-0 { transition: none !important; }
  }
`
