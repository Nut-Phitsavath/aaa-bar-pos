"use client"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ManagerApproval } from "@/components/manager-approval"
import { NumberPad } from "@/components/number-pad"
import { useShift } from "@/components/shift-provider"
import { useTranslation } from "@/hooks/use-translation"
import { notify } from "@/components/ui/sonner"

interface ShiftDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
}

export function ShiftDialog({ open, onOpenChange }: ShiftDialogProps) {
    const [startCash, setStartCash] = useState("")
    // The float set here is what every later count is measured against, so a
    // manager signs for it - the same approval comps and tabs already use.
    const [approving, setApproving] = useState(false)
    const [approvalError, setApprovalError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const [userId, setUserId] = useState<string | null>(null)
    const { checkShiftStatus } = useShift()
    const { t } = useTranslation()
    const [responsiblePerson, setResponsiblePerson] = useState("Staff")

    useEffect(() => {
        if (open) {
            // Fetch user when dialog opens to ensure we have current user
            fetch('/api/auth/me')
                .then(res => res.json())
                .then(data => {
                    if (data.user) {
                        setUserId(data.user.id)
                        setResponsiblePerson(data.user.name || "Staff")
                    }
                })
                .catch(() => { })
            setStartCash("")
        }
    }, [open])

    const handleOpenShift = () => {
        if (!startCash) { notify.warn(t.please_enter_opening_cash); return }
        setApprovalError(null)
        setApproving(true)
    }

    const openApproved = async (creds: { managerUsername: string; managerPin: string }) => {
        setBusy(true)
        setApprovalError(null)
        try {
            const res = await fetch('/api/shifts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    startCash: Number(startCash),
                    userId: userId,
                    responsiblePerson: responsiblePerson,
                    ...creds,
                })
            })
            if (res.ok) {
                setApproving(false)
                await checkShiftStatus() // Refresh context
                onOpenChange(false)
                return
            }
            const err = await res.json().catch(() => ({}))
            // A wrong PIN keeps the approval open to retry; anything else is a
            // real failure and closes it rather than looking like a bad PIN.
            if (res.status === 403 || res.status === 429) {
                setApprovalError(err.error === 'TOO_MANY_ATTEMPTS' ? t.too_many_attempts : t.invalid_approval)
                return
            }
            setApproving(false)
            notify.error(err.error || t.open_shift_failed)
        } catch (e) {
            setApproving(false)
            notify.error(t.open_shift_error)
        } finally { setBusy(false) }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md pointer-events-auto !top-[15%] !translate-y-0">
                <DialogHeader>
                    <DialogTitle>{t.open_status} {t.shifts}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                    <div className="p-4 bg-amber-50 rounded-lg text-amber-900 text-sm">
                        <p className="font-bold">👋 Good Morning!</p>
                        <p>{t.please_open_shift_first}</p>
                    </div>

                    <div className="space-y-2">
                        <Label>{t.responsible_person || "Responsible Person"}</Label>
                        <Input
                            value={responsiblePerson}
                            disabled
                            className="bg-slate-100"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>{t.start_cash_label || "Starting Cash Amount"}</Label>
                        <Input
                            type="text"
                            placeholder="0"
                            value={startCash ? Number(startCash).toLocaleString() : ""}
                            onChange={e => {
                                const val = e.target.value.replace(/\D/g, "")
                                setStartCash(val)
                            }}
                            className="text-lg font-bold"
                        />
                        <NumberPad value={startCash} onChange={setStartCash} maxLength={9} label={t.start_cash_label} />
                    </div>
                    <Button className="w-full h-12 bg-amber-600 hover:bg-amber-700" onClick={handleOpenShift}>
                        {t.open_status} {t.shifts}
                    </Button>
                </div>
            </DialogContent>

            <ManagerApproval
                open={approving}
                title={t.open_shift}
                description={t.manager_opens_shift}
                busy={busy}
                error={approvalError}
                onCancel={() => { setApproving(false); setApprovalError(null) }}
                onApprove={openApproved}
            />
        </Dialog>
    )
}
