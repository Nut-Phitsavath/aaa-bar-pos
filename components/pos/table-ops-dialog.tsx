"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslation } from "@/hooks/use-translation"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { ArrowRightLeft, Merge, Minus, Plus, SplitSquareHorizontal, Users } from "lucide-react"
import { toast } from "sonner"
import { formatTHB } from "@/lib/currency"

type FloorTable = {
    id: string
    name: string
    area: string
    seats: number
    sessions: { id: string; total: number; orderCount: number }[]
}

type Line = { id: string; name: string; localName: string | null; quantity: number; total: number }

type Mode = "MOVE" | "MERGE" | "SPLIT"

/**
 * Move, merge and split (req #2).
 *
 * Three operations behind one door because they are the same question asked
 * three ways - "this bill is not shaped like the room any more" - and staff
 * reach for them in the same moment. Keeping them apart would mean three
 * buttons on a ticket header that already carries a print and a settle.
 *
 * None asks for a manager PIN, by the owner's decision. What the screen owes
 * them instead is that nothing is ambiguous before it happens: which table,
 * which lines, and what each bill is worth after.
 */
export function TableOpsDialog({
    sessionId,
    tableName,
    lines,
    open,
    onClose,
    onDone,
}: {
    sessionId: string
    tableName: string
    lines: Line[]
    open: boolean
    onClose: () => void
    onDone: () => void
}) {
    const { t } = useTranslation()
    const router = useRouter()
    const [mode, setMode] = useState<Mode>("MOVE")
    const [tables, setTables] = useState<FloorTable[]>([])
    // Line id -> how many of its units are leaving. A Map rather than a Set,
    // because "which drinks" is now a count and not a yes/no.
    const [picked, setPicked] = useState<Map<string, number>>(new Map())
    const [busy, setBusy] = useState(false)

    const load = useCallback(async () => {
        const res = await fetch("/api/tables")
        if (res.ok) setTables(await res.json())
    }, [])

    useEffect(() => {
        if (!open) return
        setMode("MOVE"); setPicked(new Map())
        load()
    }, [open, load])

    const errorText = (code: string) =>
        code === "TABLE_OCCUPIED" ? t.op_table_occupied
            : code === "ALREADY_PAID" ? t.op_already_paid
                : code === "CANNOT_SPLIT_EVERYTHING" ? t.op_split_everything
                    : code === "SWAPPED_LINE_MOVES_WHOLE" ? t.op_swapped_whole
                    : code === "NO_OPEN_SHIFT" ? t.no_open_shift_exchange
                        : t.save_failed

    const run = async (url: string, body: unknown, done: (data: any) => void) => {
        setBusy(true)
        try {
            const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) { toast.error(errorText(data.error)); return }
            done(data)
        } finally { setBusy(false) }
    }

    const free = tables.filter((x) => x.sessions.length === 0)
    // One row per BILL, not per table: a split table holds two of them, and a
    // merge has to name which one is being poured in.
    const otherBills = tables.flatMap((x) =>
        x.sessions.filter((s) => s.id !== sessionId).map((bill) => ({ table: x, bill })))

    // Per drink, not per row: a line of two whiskeys with one leaving is half
    // its value on each bill. total is price x quantity on every line, so this
    // divides exactly.
    const unitPrice = (l: Line) => (l.quantity > 0 ? l.total / l.quantity : 0)
    const taking = (l: Line) => picked.get(l.id) ?? 0

    const splitTotal = lines.reduce((sum, l) => sum + unitPrice(l) * taking(l), 0)
    const stayingTotal = lines.reduce((sum, l) => sum + unitPrice(l) * (l.quantity - taking(l)), 0)

    const unitsOnBill = lines.reduce((sum, l) => sum + l.quantity, 0)
    const unitsMoving = lines.reduce((sum, l) => sum + taking(l), 0)
    // The same rule the route refuses on, so the button is dead rather than the
    // tap being rejected: at least one drink stays behind.
    const splitAllowed = unitsMoving > 0 && unitsMoving < unitsOnBill

    /** Tick the row: all of it, or none. The stepper trims from there. */
    const toggleLine = (l: Line) => setPicked((prev) => {
        const next = new Map(prev)
        next.has(l.id) ? next.delete(l.id) : next.set(l.id, l.quantity)
        return next
    })

    const setTaking = (l: Line, n: number) => setPicked((prev) => {
        const next = new Map(prev)
        const clamped = Math.max(0, Math.min(l.quantity, n))
        clamped === 0 ? next.delete(l.id) : next.set(l.id, clamped)
        return next
    })

    const tabs: { key: Mode; label: string; icon: React.ReactNode }[] = [
        { key: "MOVE", label: t.op_move, icon: <ArrowRightLeft className="w-4 h-4" /> },
        { key: "MERGE", label: t.op_merge, icon: <Merge className="w-4 h-4" /> },
        { key: "SPLIT", label: t.op_split, icon: <SplitSquareHorizontal className="w-4 h-4" /> },
    ]

    return (
        <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{t.table_operations} · {tableName}</DialogTitle>
                </DialogHeader>

                <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
                    {tabs.map((tab) => (
                        <button
                            key={tab.key}
                            onClick={() => setMode(tab.key)}
                            className={`h-11 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition-colors duration-150 ${mode === tab.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                                }`}
                        >
                            {tab.icon}
                            {tab.label}
                        </button>
                    ))}
                </div>

                {mode === "MOVE" && (
                    <>
                        <p className="text-sm text-slate-600">{t.op_move_desc}</p>
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-72 overflow-y-auto">
                            {free.length === 0 && (
                                <p className="col-span-full py-8 text-center text-sm text-slate-500">{t.op_no_free_table}</p>
                            )}
                            {free.map((x) => (
                                <Button
                                    key={x.id}
                                    variant="outline"
                                    disabled={busy}
                                    className="h-16 flex-col gap-0.5"
                                    onClick={() => run(`/api/table-sessions/${sessionId}/move`, { tableId: x.id }, (d) => {
                                        toast.success(`${t.op_moved} ${d.table}`)
                                        onDone(); onClose()
                                    })}
                                >
                                    <span className="text-lg font-black">{x.name}</span>
                                    <span className="text-[10px] text-slate-500 inline-flex items-center gap-1">
                                        <Users className="w-3 h-3" />{x.seats}
                                    </span>
                                </Button>
                            ))}
                        </div>
                    </>
                )}

                {mode === "MERGE" && (
                    <>
                        {/* Says which way the money travels before anyone taps: the
                            other table's rounds come here, not the reverse. */}
                        <p className="text-sm text-slate-600">{t.op_merge_desc.replace("{table}", tableName)}</p>
                        <div className="rounded-xl border border-slate-200 overflow-hidden max-h-72 overflow-y-auto">
                            {otherBills.length === 0 && (
                                <p className="py-8 text-center text-sm text-slate-500">{t.op_no_other_bill}</p>
                            )}
                            {otherBills.map(({ table: x, bill }) => (
                                <div key={bill.id} className="flex items-center gap-3 px-3 py-2.5 border-b border-slate-100 last:border-0">
                                    <span className="text-lg font-black text-slate-900 w-16">{x.name}</span>
                                    <span className="text-sm text-slate-500 flex-1 min-w-0 truncate">
                                        {bill.orderCount} {t.round_no}
                                    </span>
                                    <span className="tabular-nums font-bold text-slate-800">{formatTHB(bill.total)}</span>
                                    <Button
                                        variant="outline" size="sm" className="h-10 shrink-0"
                                        disabled={busy}
                                        onClick={() => run(`/api/table-sessions/${sessionId}/merge`, { fromSessionId: bill.id }, (d) => {
                                            toast.success(`${t.op_merged} ${d.from}`)
                                            onDone(); onClose()
                                        })}
                                    >
                                        {t.op_merge}
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </>
                )}

                {mode === "SPLIT" && (
                    <>
                        <p className="text-sm text-slate-600">{t.op_split_desc}</p>
                        <div className="rounded-xl border border-slate-200 overflow-hidden max-h-64 overflow-y-auto">
                            {/* A row, not a button: the stepper lives inside it
                                and a button cannot nest inside a button. */}
                            {lines.map((l) => {
                                const n = taking(l)
                                const on = n > 0
                                return (
                                    <div
                                        key={l.id}
                                        className={`flex items-center gap-3 px-3 py-2.5 border-b border-slate-100 last:border-0 transition-colors duration-150 ${on ? "bg-amber-50" : "bg-white"
                                            }`}
                                    >
                                        {/* Tapping the name takes the whole line,
                                            which is what usually happens. */}
                                        <button
                                            type="button"
                                            onClick={() => toggleLine(l)}
                                            aria-pressed={on}
                                            className="flex items-center gap-3 min-w-0 flex-1 text-start"
                                        >
                                            <span className={`w-5 h-5 rounded border-2 grid place-items-center shrink-0 ${on ? "bg-amber-600 border-amber-600" : "border-slate-300"}`}>
                                                {on && <span className="w-2 h-2 rounded-sm bg-white" />}
                                            </span>
                                            <span className="min-w-0 flex-1 truncate text-slate-900">
                                                {l.localName || l.name}
                                            </span>
                                        </button>

                                        {/* Only where there is something to
                                            divide. A stepper on a single drink
                                            is two dead buttons. */}
                                        {l.quantity > 1 ? (
                                            <div className="flex items-center gap-1 shrink-0">
                                                <button
                                                    type="button"
                                                    onClick={() => setTaking(l, n - 1)}
                                                    disabled={n === 0}
                                                    aria-label={t.op_take_fewer}
                                                    className="w-9 h-9 rounded-md border-2 border-slate-300 grid place-items-center text-slate-700 font-black disabled:opacity-30 hover:border-slate-400 transition-colors"
                                                >
                                                    <Minus className="w-4 h-4" />
                                                </button>
                                                {/* n of quantity, so the split
                                                    and the remainder are both
                                                    readable without arithmetic. */}
                                                <span className="w-12 text-center tabular-nums font-bold text-slate-900">
                                                    {n}<span className="text-slate-400">/{l.quantity}</span>
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() => setTaking(l, n + 1)}
                                                    disabled={n >= l.quantity}
                                                    aria-label={t.op_take_more}
                                                    className="w-9 h-9 rounded-md border-2 border-slate-300 grid place-items-center text-slate-700 font-black disabled:opacity-30 hover:border-slate-400 transition-colors"
                                                >
                                                    <Plus className="w-4 h-4" />
                                                </button>
                                            </div>
                                        ) : (
                                            <span className="w-[136px] text-center tabular-nums text-slate-400 shrink-0">1</span>
                                        )}

                                        <span className="w-20 text-end tabular-nums text-slate-700 shrink-0">
                                            {formatTHB(unitPrice(l) * (on ? n : l.quantity))}
                                        </span>
                                    </div>
                                )
                            })}
                        </div>

                        {/* Both halves, before the button that creates them. */}
                        <div className="flex items-center gap-4 flex-wrap rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-sm">
                            <span className="text-slate-600">
                                {t.op_new_bill} <strong className="text-slate-900 tabular-nums">{formatTHB(splitTotal)}</strong>
                            </span>
                            <span className="text-slate-600">
                                {tableName} <strong className="text-slate-900 tabular-nums">{formatTHB(stayingTotal)}</strong>
                            </span>
                            <Button
                                className="ms-auto h-11 bg-amber-600 hover:bg-amber-700 font-bold"
                                disabled={busy || !splitAllowed}
                                onClick={() => run(`/api/table-sessions/${sessionId}/split`, {
                                    items: [...picked].map(([itemId, quantity]) => ({ itemId, quantity })),
                                }, (d) => {
                                    toast.success(t.op_split_done)
                                    onDone(); onClose()
                                    // Straight to the new bill: it exists to be
                                    // settled now, by the guest standing there.
                                    router.push(`/pos?session=${d.sessionId}`)
                                })}
                            >
                                {busy ? t.processing : t.op_split}
                            </Button>
                        </div>
                    </>
                )}
            </DialogContent>
        </Dialog>
    )
}
