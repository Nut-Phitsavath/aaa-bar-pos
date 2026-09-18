"use client"

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useTranslation } from "@/hooks/use-translation"
import { formatTHB } from "@/lib/currency"
import { billLabel, orderBills, type BillIdentity } from "@/lib/table-ops"

export type PickableBill = BillIdentity & {
    status: string
    orderCount: number
    total: number
}

/**
 * "Which of these bills?" - asked from the floor plan and from the till.
 *
 * One component, two callers, because they are the same question and staff
 * should not have to learn it twice. It was written inline on the floor plan
 * first; when the till needed it too, copying the markup would have been two
 * dialogs free to drift apart in wording, ordering and letters.
 *
 * Listed oldest first, so the party who sat down first is at the top, and
 * lettered by the shared rule rather than by array position - "VIP 1-a" here
 * against "VIP 1-b" on the other screen would be a waiter charging a party
 * they can see is not the one they picked.
 */
export function BillPickerDialog({
    open,
    onClose,
    tableName,
    bills,
    currentId,
    onPick,
}: {
    open: boolean
    onClose: () => void
    tableName: string
    bills: PickableBill[]
    /** The bill already on screen, marked so nobody taps back to where they are. */
    currentId?: string
    onPick: (billId: string) => void
}) {
    const { t } = useTranslation()

    return (
        <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
            <DialogContent className="max-w-sm">
                <DialogHeader>
                    <DialogTitle>{tableName} · {t.which_bill}</DialogTitle>
                </DialogHeader>
                <div className="space-y-2">
                    {orderBills(bills).map((s) => {
                        const here = s.id === currentId
                        return (
                            <button
                                key={s.id}
                                onClick={() => { if (!here) onPick(s.id) }}
                                disabled={here}
                                aria-current={here ? "true" : undefined}
                                className={`w-full flex items-center gap-3 px-4 h-16 rounded-xl border-2 text-start transition-all ${here
                                    ? "border-slate-900 bg-slate-900/[0.04] cursor-default"
                                    : "border-slate-300 hover:border-amber-400 hover:bg-amber-50"
                                    }`}
                            >
                                <span className="text-lg font-black text-slate-900 shrink-0">
                                    {billLabel(tableName, bills, s.id)}
                                </span>
                                <span className="text-xs text-slate-500 min-w-0 truncate">
                                    {/* Says where you already are, rather than
                                        leaving two identical-looking rows and
                                        letting the tap find out. */}
                                    {here && <span className="font-bold text-slate-900">{t.this_bill} · </span>}
                                    {s.orderCount} {t.round_no}
                                    {s.status === "BILL_REQUESTED" && ` · ${t.bill_requested}`}
                                </span>
                                <span className="ms-auto text-lg font-bold tabular-nums text-slate-900 shrink-0">
                                    {formatTHB(s.total)}
                                </span>
                            </button>
                        )
                    })}
                </div>
            </DialogContent>
        </Dialog>
    )
}
