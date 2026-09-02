"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FormattedNumberInput } from "@/components/ui/formatted-number-input"
import { Minus } from "lucide-react"
import { useTranslation } from "@/hooks/use-translation"
import { notify } from "@/components/ui/sonner"

interface WithdrawDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    ingredient: {
        id: string
        name: string
        unit: string
        mainStock: number
    } | null
    onSuccess: () => void
}

export function WithdrawDialog({ open, onOpenChange, ingredient, onSuccess }: WithdrawDialogProps) {
    const { t } = useTranslation()
    const [quantity, setQuantity] = useState("")
    const [reason, setReason] = useState("")
    const [notes, setNotes] = useState("")
    const [isLoading, setIsLoading] = useState(false)

    const handleSubmit = async () => {
        if (!ingredient || !quantity || parseFloat(quantity) <= 0) {
            notify.warn(t.enter_valid_quantity)
            return
        }

        if (!reason) {
            notify.warn(t.select_reason_withdrawal)
            return
        }

        if (parseFloat(quantity) > ingredient.mainStock) {
            notify.warn(t.cannot_withdraw_more_than, { description: `${ingredient.mainStock} ${ingredient.unit}` })
            return
        }

        setIsLoading(true)
        try {
            const res = await fetch('/api/inventory/withdraw', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ingredientId: ingredient.id,
                    quantity: parseFloat(quantity),
                    reason,
                    notes: notes || undefined
                })
            })

            if (res.ok) {
                notify.success(t.withdrew_successfully, { description: `${quantity} ${ingredient.unit} — ${ingredient.name}` })
                handleClose()
                onSuccess()
            } else {
                const error = await res.json()
                notify.error(t.withdraw_failed, { description: error.error || t.unknown_error })
            }
        } catch (e) {
            console.error(e)
            notify.error(t.withdraw_failed, { description: t.please_try_again })
        } finally {
            setIsLoading(false)
        }
    }

    const handleClose = () => {
        setQuantity("")
        setReason("")
        setNotes("")
        onOpenChange(false)
    }

    if (!ingredient) return null

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Minus className="w-5 h-5 text-rose-600" />
                        {t.withdraw_stock}: {ingredient.name}
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="p-3 bg-rose-50 rounded-lg border border-rose-100">
                        <p className="text-sm text-muted-foreground">{t.current_warehouse_stock}</p>
                        <p className="text-2xl font-bold text-rose-700">{ingredient.mainStock} {ingredient.unit}</p>
                    </div>

                    <div className="space-y-2">
                        <Label>{t.quantity_to_withdraw} *</Label>
                        <FormattedNumberInput
                            value={quantity}
                            onChange={setQuantity}
                            allowDecimals={true}
                            placeholder={t.enter_quantity}
                        />
                        <p className="text-xs text-muted-foreground">
                            {t.remaining_stock_will_be} {Math.max(0, ingredient.mainStock - (parseFloat(quantity) || 0))} {ingredient.unit}
                        </p>
                    </div>

                    <div className="space-y-2">
                        <Label>{t.reason_for_withdrawal} *</Label>
                        <Select value={reason} onValueChange={setReason}>
                            <SelectTrigger>
                                <SelectValue placeholder={t.select_reason} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="CORRECTION">{t.reason_inventory_correction}</SelectItem>
                                <SelectItem value="DAMAGED">{t.reason_damaged_expired}</SelectItem>
                                <SelectItem value="SAMPLE">{t.reason_sample_testing}</SelectItem>
                                <SelectItem value="OTHER_USE">{t.reason_other_use}</SelectItem>
                                <SelectItem value="LOST">{t.reason_lost_missing}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label>{t.notes_optional}</Label>
                        <Textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder={t.withdrawal_notes_placeholder}
                            rows={3}
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={handleClose} disabled={isLoading}>
                        Cancel
                    </Button>
                    <Button
                        className="bg-rose-600 hover:bg-rose-700"
                        onClick={handleSubmit}
                        disabled={isLoading || !quantity || parseFloat(quantity) <= 0 || !reason}
                    >
                        {isLoading ? t.withdrawing : t.withdraw_stock}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
