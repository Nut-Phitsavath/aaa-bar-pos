"use client"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useShift } from "@/components/shift-provider"
import { useTranslation } from "@/hooks/use-translation"
import { notify } from "@/components/ui/sonner"

interface ShiftDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
}

export function ShiftDialog({ open, onOpenChange }: ShiftDialogProps) {
    const [startCash, setStartCash] = useState("")
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

    const handleOpenShift = async () => {
        if (!startCash) { notify.warn(t.please_enter_opening_cash); return }
        try {
            const res = await fetch('/api/shifts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    startCash: Number(startCash),
                    userId: userId,
                    responsiblePerson: responsiblePerson
                })
            })
            if (res.ok) {
                await checkShiftStatus() // Refresh context
                onOpenChange(false)
            } else {
                const err = await res.json()
                notify.error(err.error || t.open_shift_failed)
            }
        } catch (e) { notify.error(t.open_shift_error) }
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
                    </div>
                    <Button className="w-full bg-amber-600 hover:bg-amber-700" onClick={handleOpenShift}>
                        {t.open_status} {t.shifts}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
