"use client"

import { useState, useEffect } from "react"
import { useTranslation } from "@/hooks/use-translation"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"
import { formatTHB } from "@/lib/currency"
import { VOID_REASONS, type VoidReason } from "@/lib/voids"

export type VoidTarget = {
    orderId: string
    /** Omitted for a whole round; one id when a single line is struck. */
    itemIds?: string[]
    label: string
    value: number
}

/**
 * Why is this being struck? (req #5: mandatory void reason selection.)
 *
 * The reason is a choice, not a sentence. Typing is what happens at 1am when a
 * table is waiting, and "asdf" in the audit log is the same as no audit log;
 * six buttons take one tap and make the report groupable. The note beside them
 * is optional and carries the detail a fixed list cannot.
 *
 * Nothing is submitted until a reason is picked, so there is no path through
 * this dialog that produces an unexplained void.
 */
export function VoidDialog({
    target,
    onClose,
    onVoided,
}: {
    target: VoidTarget | null
    onClose: () => void
    onVoided: () => void
}) {
    const { t } = useTranslation()
    const [reason, setReason] = useState<VoidReason | null>(null)
    const [note, setNote] = useState("")
    const [busy, setBusy] = useState(false)

    useEffect(() => {
        if (target) { setReason(null); setNote("") }
    }, [target])

    const label: Record<VoidReason, string> = {
        DUPLICATE: t.void_duplicate,
        WRONG_ITEM: t.void_wrong_item,
        CUSTOMER_CHANGED: t.void_customer_changed,
        SPILLED: t.void_spilled,
        WRONG_TABLE: t.void_wrong_table,
        OTHER: t.void_other,
    }

    const submit = async () => {
        if (!target || !reason) return
        setBusy(true)
        try {
            const res = await fetch(`/api/orders/${target.orderId}/void`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ itemIds: target.itemIds, reason, note }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) { toast.error(data.error || t.error); return }
            toast.success(t.voided)
            onClose()
            onVoided()
        } finally { setBusy(false) }
    }

    return (
        <Dialog open={!!target} onOpenChange={(o) => { if (!o) onClose() }}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>{t.void_reason_required}</DialogTitle>
                </DialogHeader>

                {target && (
                    <div className="space-y-4">
                        <div className="flex items-baseline justify-between gap-3 rounded-xl bg-slate-100 px-4 py-3">
                            <span className="font-bold text-slate-900 truncate">{target.label}</span>
                            <span className="tabular-nums font-black text-rose-600 shrink-0">
                                −{formatTHB(target.value)}
                            </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            {VOID_REASONS.map((r) => (
                                <button
                                    key={r}
                                    onClick={() => setReason(r)}
                                    className={`h-14 rounded-xl border-2 text-sm font-bold transition-colors duration-150 ${r === reason
                                        ? "bg-slate-900 border-slate-900 text-white"
                                        : "border-slate-200 text-slate-700 hover:border-rose-300 hover:bg-rose-50"
                                        }`}
                                >
                                    {label[r]}
                                </button>
                            ))}
                        </div>

                        <Input
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder={t.void_note_optional}
                            className="h-12 rounded-xl border-2"
                        />

                        {/* Disabled until a reason is chosen: the requirement is
                            that no void is ever recorded without one. */}
                        <button
                            onClick={submit}
                            disabled={!reason || busy}
                            className="w-full h-14 rounded-xl bg-rose-600 text-white text-lg font-black hover:bg-rose-700 disabled:opacity-40 disabled:hover:bg-rose-600 transition-colors duration-150"
                        >
                            {busy ? "…" : t.confirm_void}
                        </button>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}
