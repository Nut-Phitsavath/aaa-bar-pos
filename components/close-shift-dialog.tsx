"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslation } from "@/hooks/use-translation"
import { useShift } from "@/components/shift-provider"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ManagerApproval } from "@/components/manager-approval"
import { ReceiptDialog } from "@/components/receipt-dialog"
import { NumberPad } from "@/components/number-pad"
import { formatTHB } from "@/lib/currency"
import { cn } from "@/lib/utils"

/**
 * Close the shift: count the drawer, a manager signs, and the Z-report prints.
 *
 * The one place a shift closes. The sidebar had its own dialog that sent no
 * manager PIN, so once the API started requiring one (3eb773f) every close
 * from it was refused; the Shifts page had a dialog with the PIN that nothing
 * opened. This is the second one, opened from the sidebar.
 *
 * On success the Z slip (/receipt/z) opens and prints itself, the way SambaPOS
 * prints its work-period report when the period ends. Any closed shift can be
 * printed again from the Shifts page.
 */
export function CloseShiftDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const { t } = useTranslation()
    const router = useRouter()
    const {
        startCash, cashPayments, onePayPayments, onePayCount, transferPayments, transferCount,
        activeShiftId, checkShiftStatus,
    } = useShift()
    const [actualCash, setActualCash] = useState("")
    const [approving, setApproving] = useState(false)
    const [approvalError, setApprovalError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    // Which tables are holding the close open. Empty until the server says so.
    const [blocking, setBlocking] = useState<{ id: string; table: string; balance: number }[]>([])
    const [zSrc, setZSrc] = useState<string | null>(null)

    const expected = (startCash || 0) + (cashPayments || 0)

    const close = async (creds: { managerUsername: string; managerPin: string }) => {
        if (!activeShiftId) return
        setBusy(true)
        try {
            const res = await fetch("/api/shifts", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: activeShiftId, actualCash: Number(actualCash), ...creds }),
            })
            if (res.status === 403 || res.status === 429) {
                const err = await res.json().catch(() => ({}))
                setApprovalError(err.error === "TOO_MANY_ATTEMPTS" ? t.too_many_attempts : t.invalid_approval)
                return
            }
            if (res.status === 409) {
                // Live tables, not a bad PIN: close the approval so the list of
                // what is holding the close is what the manager looks at.
                setApproving(false)
                const data = await res.json().catch(() => ({}))
                setBlocking(Array.isArray(data.tables) ? data.tables : [])
                return
            }
            if (!res.ok) {
                setApprovalError(t.close_shift_failed)
                return
            }
            setApproving(false)
            setBlocking([])
            setActualCash("")
            onOpenChange(false)
            await checkShiftStatus()
            setZSrc(`/receipt/z?shift=${encodeURIComponent(activeShiftId)}&autoprint=1`)
            router.push("/dashboard")
        } catch (e) {
            console.error(e)
            setApprovalError(t.close_shift_error)
        } finally {
            setBusy(false)
        }
    }

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                {/* Wide enough for the figures beside the keypad, so it fits a
                    1024x768 till; it scrolls rather than run off a smaller one. */}
                <DialogContent className="sm:max-w-2xl max-h-[95vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{t.end_current_shift}</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-4 py-4 md:grid-cols-2">
                        <div className="space-y-4">
                            <div className="p-4 bg-slate-50 rounded-lg space-y-2 border border-slate-100 font-mono text-sm leading-relaxed">
                                <div className="flex justify-between">
                                    <span>{t.starting_cash_with_colon}</span>
                                    <span>{formatTHB(startCash || 0)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>{t.cash_sales_with_colon}</span>
                                    <span>{formatTHB(cashPayments || 0)}</span>
                                </div>
                                <div className="flex justify-between font-bold border-t border-slate-200 pt-2 pb-1">
                                    <span>{t.expected_cash_with_colon}</span>
                                    <span className="text-amber-800">{formatTHB(expected)}</span>
                                </div>
                                <div className="flex justify-between border-t border-slate-100 pt-2 text-slate-600">
                                    <span>{t.onepay_total}: ({onePayCount || 0})</span>
                                    <span>{formatTHB(onePayPayments || 0)}</span>
                                </div>
                                <div className="flex justify-between text-slate-600">
                                    <span>{t.transfer_total}: ({transferCount || 0})</span>
                                    <span>{formatTHB(transferPayments || 0)}</span>
                                </div>
                            </div>

                            {/* What is holding the close, each one a way in to go and
                                deal with it - not a refusal that leaves staff hunting
                                the floor at 3am. */}
                            {blocking.length > 0 && (
                                <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3 space-y-2">
                                    <p className="text-sm font-bold text-amber-900">{t.tables_still_open}</p>
                                    {blocking.map((b) => (
                                        <div key={b.id} className="flex items-center gap-3 text-sm">
                                            <span className="font-bold text-slate-900">{b.table}</span>
                                            <span className="tabular-nums text-slate-700">{formatTHB(b.balance)}</span>
                                            <Button
                                                size="sm"
                                                className="ms-auto h-9 bg-amber-600 hover:bg-amber-700 text-amber-950"
                                                onClick={() => { onOpenChange(false); router.push(`/pos/settle?session=${b.id}`) }}
                                            >
                                                {t.settle_bill}
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <p className="text-xs text-slate-600">{t.z_prints_at_close}</p>
                        </div>

                        <div className="space-y-3">
                            <div className="space-y-2">
                                <Label htmlFor="actualCash">{t.actual_cash_counted}</Label>
                                <Input
                                    id="actualCash"
                                    type="text"
                                    inputMode="numeric"
                                    placeholder={t.enter_cash_drawer}
                                    value={actualCash ? Number(actualCash).toLocaleString() : ""}
                                    onChange={(e) => setActualCash(e.target.value.replace(/\D/g, ""))}
                                    className="text-lg font-bold"
                                />
                            </div>
                            {actualCash && (
                                <div className={cn(
                                    "p-3 rounded-md text-sm font-medium",
                                    Number(actualCash) - expected >= 0 ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700",
                                )}>
                                    {t.difference_label}: {formatTHB(Number(actualCash) - expected)}
                                </div>
                            )}
                            {/* No keyboard on the till: the drawer count is tapped in. */}
                            <NumberPad value={actualCash} onChange={setActualCash} maxLength={9} label={t.actual_cash_counted} />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => onOpenChange(false)}>{t.cancel}</Button>
                        <Button
                            variant="destructive"
                            className="font-bold"
                            disabled={!actualCash || busy}
                            onClick={() => { setApprovalError(null); setApproving(true) }}
                        >
                            {busy ? t.ending_shift_status : t.confirm_close_shift}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <ManagerApproval
                open={approving}
                title={t.confirm_close_shift}
                description={t.manager_closes_shift}
                busy={busy}
                error={approvalError}
                onCancel={() => { setApproving(false); setApprovalError(null) }}
                onApprove={close}
            />

            <ReceiptDialog src={zSrc} onClose={() => setZSrc(null)} />
        </>
    )
}
