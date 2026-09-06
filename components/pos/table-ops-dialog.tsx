"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslation } from "@/hooks/use-translation"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { ArrowRightLeft, Merge, SplitSquareHorizontal, Users } from "lucide-react"
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
    const [picked, setPicked] = useState<Set<string>>(new Set())
    const [busy, setBusy] = useState(false)

    const load = useCallback(async () => {
        const res = await fetch("/api/tables")
        if (res.ok) setTables(await res.json())
    }, [])

    useEffect(() => {
        if (!open) return
        setMode("MOVE"); setPicked(new Set())
        load()
    }, [open, load])

    const errorText = (code: string) =>
        code === "TABLE_OCCUPIED" ? t.op_table_occupied
            : code === "ALREADY_PAID" ? t.op_already_paid
                : code === "CANNOT_SPLIT_EVERYTHING" ? t.op_split_everything
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

    const splitTotal = lines
        .filter((l) => picked.has(l.id))
        .reduce((sum, l) => sum + l.total, 0)
    const stayingTotal = lines
        .filter((l) => !picked.has(l.id))
        .reduce((sum, l) => sum + l.total, 0)

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
                            {lines.map((l) => {
                                const on = picked.has(l.id)
                                return (
                                    <button
                                        key={l.id}
                                        onClick={() => setPicked((prev) => {
                                            const next = new Set(prev)
                                            next.has(l.id) ? next.delete(l.id) : next.add(l.id)
                                            return next
                                        })}
                                        className={`w-full flex items-center gap-3 px-3 py-2.5 text-start border-b border-slate-100 last:border-0 transition-colors duration-150 ${on ? "bg-amber-50" : "bg-white hover:bg-slate-50"
                                            }`}
                                    >
                                        <span className={`w-5 h-5 rounded border-2 grid place-items-center shrink-0 ${on ? "bg-amber-600 border-amber-600" : "border-slate-300"}`}>
                                            {on && <span className="w-2 h-2 rounded-sm bg-white" />}
                                        </span>
                                        <span className="w-8 tabular-nums font-bold text-slate-500 shrink-0">{l.quantity}</span>
                                        <span className="min-w-0 flex-1 truncate text-slate-900">{l.localName || l.name}</span>
                                        <span className="tabular-nums text-slate-700 shrink-0">{formatTHB(l.total)}</span>
                                    </button>
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
                                disabled={busy || picked.size === 0 || picked.size >= lines.length}
                                onClick={() => run(`/api/table-sessions/${sessionId}/split`, { itemIds: [...picked] }, (d) => {
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
