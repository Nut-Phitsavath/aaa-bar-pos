"use client"

import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "@/hooks/use-translation"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Minus, Plus, PackageOpen } from "lucide-react"
import { toast } from "sonner"

type Item = {
    menuId: string
    variationSizeId: string | null
    name: string
    localName?: string | null
    quantity: number
}

/**
 * Counting back what the table never opened (req #10).
 *
 * Deliberately not a money screen. The bill does not move: the package was sold
 * and paid for, and two unopened beers going back in the fridge is a fact about
 * the shelf, not about what the customer owes. Staff reach for this while
 * clearing the table, which is why it lives on settle rather than behind a
 * manager PIN.
 *
 * Counts up from zero, unlike the exchange screen. There the question is "what
 * does this set deliver"; here it is "how many are you carrying back", and the
 * answer starts at none.
 */
export function ReturnsDialog({
    sessionId,
    open,
    onClose,
    onDone,
}: {
    sessionId: string
    open: boolean
    onClose: () => void
    onDone: () => void
}) {
    const { t } = useTranslation()
    const [items, setItems] = useState<Item[]>([])
    const [count, setCount] = useState<Record<string, number>>({})
    const [busy, setBusy] = useState(false)
    const [loaded, setLoaded] = useState(false)

    const load = useCallback(async () => {
        const res = await fetch(`/api/table-sessions/${sessionId}/returns`)
        if (res.ok) setItems((await res.json()).items ?? [])
        setLoaded(true)
    }, [sessionId])

    useEffect(() => {
        if (!open) return
        setCount({}); setLoaded(false)
        load()
    }, [open, load])

    const step = (menuId: string, max: number, delta: number) =>
        setCount((prev) => {
            const next = Math.min(max, Math.max(0, (prev[menuId] ?? 0) + delta))
            return { ...prev, [menuId]: next }
        })

    const chosen = Object.entries(count).filter(([, q]) => q > 0)
    const total = chosen.reduce((n, [, q]) => n + q, 0)

    const submit = async () => {
        if (chosen.length === 0) return
        setBusy(true)
        try {
            const res = await fetch(`/api/table-sessions/${sessionId}/returns`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ items: chosen.map(([menuId, quantity]) => ({ menuId, quantity })) }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) {
                toast.error(
                    data.error === "MORE_THAN_ORDERED" ? t.return_more_than_ordered
                        : data.error === "NOT_ON_THIS_BILL" ? t.return_not_on_bill
                            : data.error === "RETURN_OTHER_SHIFT" ? t.return_other_shift
                                : data.error === "NO_OPEN_SHIFT" ? t.no_open_shift_exchange
                                : t.save_failed,
                )
                return
            }
            toast.success(`${t.returned_to_stock} · ${data.returned}`)
            onDone()
            onClose()
        } finally { setBusy(false) }
    }

    return (
        <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <PackageOpen className="w-5 h-5 text-slate-500" />
                        {t.return_unopened}
                    </DialogTitle>
                </DialogHeader>

                <p className="text-sm text-slate-600">{t.return_unopened_desc}</p>

                <div className="rounded-xl border border-slate-200 overflow-hidden">
                    <div className="max-h-80 overflow-y-auto">
                        {!loaded ? (
                            <div className="h-24 bg-slate-50 animate-pulse" />
                        ) : items.length === 0 ? (
                            <p className="px-3 py-8 text-center text-sm text-slate-500">{t.nothing_to_return}</p>
                        ) : (
                            items.map((i) => {
                                const back = count[i.menuId] ?? 0
                                return (
                                    <div key={i.menuId} className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 last:border-0">
                                        <div className="min-w-0 flex-1">
                                            <p className="font-bold text-slate-900 truncate">{i.localName || i.name}</p>
                                            <p className="text-xs text-slate-500 tabular-nums">
                                                {t.served} {i.quantity}
                                            </p>
                                        </div>
                                        <Button variant="outline" size="icon" className="h-9 w-9 shrink-0"
                                            aria-label={`${t.remove} ${i.name}`}
                                            disabled={back === 0}
                                            onClick={() => step(i.menuId, i.quantity, -1)}>
                                            <Minus className="w-4 h-4" />
                                        </Button>
                                        <span className={`w-6 text-center font-black tabular-nums ${back > 0 ? "text-emerald-700" : "text-slate-400"}`}>
                                            {back}
                                        </span>
                                        <Button variant="outline" size="icon" className="h-9 w-9 shrink-0"
                                            aria-label={`${t.add} ${i.name}`}
                                            disabled={back === i.quantity}
                                            onClick={() => step(i.menuId, i.quantity, 1)}>
                                            <Plus className="w-4 h-4" />
                                        </Button>
                                    </div>
                                )
                            })
                        )}
                    </div>
                </div>

                {/* Says outright that the bill is untouched, because a screen
                    that moves stock at settle time looks like one that should. */}
                <p className="text-xs text-slate-500">{t.return_bill_unchanged}</p>

                <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" className="h-12" onClick={onClose} disabled={busy}>{t.cancel}</Button>
                    <Button
                        className="h-12 bg-emerald-600 hover:bg-emerald-700 font-bold"
                        onClick={submit}
                        disabled={busy || total === 0}
                    >
                        {busy ? t.processing : `${t.confirm}${total > 0 ? ` · ${total}` : ""}`}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
