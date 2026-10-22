"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FormattedNumberInput } from "@/components/ui/formatted-number-input"
import { AlertTriangle } from "lucide-react"
import { useTranslation } from "@/hooks/use-translation"
import { notify } from "@/components/ui/sonner"
import { formatStockOf, toBase, type UnitBearing } from "@/lib/units"

interface ShopAdjustDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    ingredient: (UnitBearing & {
        id: string
        name: string
        subStock: number
    }) | null
    onSuccess: () => void
}

export function ShopAdjustDialog({ open, onOpenChange, ingredient, onSuccess }: ShopAdjustDialogProps) {
    const { t } = useTranslation()
    const [actualStock, setActualStock] = useState("")
    const [reason, setReason] = useState("")
    const [notes, setNotes] = useState("")
    const [isLoading, setIsLoading] = useState(false)

    // Staff count in whatever they pick up - bottles, kilos - and the shelf is
    // held in base units, so the count converts before anything is compared.
    const actualBase = ingredient ? toBase(parseFloat(actualStock) || 0, ingredient.purchaseMultiplier) : 0
    const discrepancy = ingredient ? actualBase - ingredient.subStock : 0

    const handleSubmit = async () => {
        if (!ingredient || actualStock === "") {
            notify.warn(t.enter_actual_stock_amount)
            return
        }

        if (!reason) {
            notify.warn(t.select_reason_adjustment)
            return
        }

        setIsLoading(true)
        try {
            const res = await fetch('/api/inventory/shop-adjust', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ingredientId: ingredient.id,
                    actualStock: actualBase,
                    reason,
                    notes: notes || undefined
                })
            })

            if (res.ok) {
                notify.success(t.adjusted_successfully, { description: ingredient.name })
                handleClose()
                onSuccess()
            } else {
                const error = await res.json()
                notify.error(t.adjust_failed, { description: error.error || t.unknown_error })
            }
        } catch (e) {
            console.error(e)
            notify.error(t.adjust_failed, { description: t.please_try_again })
        } finally {
            setIsLoading(false)
        }
    }

    const handleClose = () => {
        setActualStock("")
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
                        <AlertTriangle className="w-5 h-5 text-orange-600" />
                        {t.adjust_shop_stock}: {ingredient.name}
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="p-3 bg-slate-50 rounded-lg border">
                            <p className="text-xs text-muted-foreground">{t.system_stock}</p>
                            <p className="text-xl font-bold text-slate-700 tabular-nums">
                                {formatStockOf(ingredient.subStock, ingredient)}
                            </p>
                        </div>
                        <div className="p-3 bg-amber-50 rounded-lg border border-amber-100">
                            <p className="text-xs text-muted-foreground">{t.actual_stock}</p>
                            <p className="text-xl font-bold text-amber-800 tabular-nums">
                                {actualStock ? formatStockOf(actualBase, ingredient) : "—"}
                            </p>
                        </div>
                    </div>

                    {actualStock && discrepancy !== 0 && (
                        <div className={`p-3 rounded-lg border ${discrepancy > 0 ? 'bg-green-50 border-green-100' : 'bg-rose-50 border-rose-100'}`}>
                            <p className="text-xs text-muted-foreground">{t.discrepancy}</p>
                            <p className={`text-lg font-bold tabular-nums ${discrepancy > 0 ? 'text-green-700' : 'text-rose-700'}`}>
                                {discrepancy > 0 ? '+' : ''}{formatStockOf(discrepancy, ingredient)}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                                {discrepancy > 0 ? t.more_than_expected : t.less_than_expected}
                            </p>
                        </div>
                    )}

                    <div className="space-y-2">
                        <Label>{t.actual_physical_stock} ({ingredient.purchaseUnit}) *</Label>
                        <div className="relative">
                            <FormattedNumberInput
                                value={actualStock}
                                onChange={setActualStock}
                                allowDecimals={true}
                                className="pr-20 tabular-nums"
                                placeholder={t.enter_actual_stock}
                            />
                            <span className="absolute right-4 top-1/2 -translate-y-1/2 font-black text-slate-300 pointer-events-none uppercase text-xs tracking-widest">
                                {ingredient.purchaseUnit}
                            </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            {t.count_physical_hint}
                        </p>
                    </div>

                    <div className="space-y-2">
                        <Label>{t.reason_for_discrepancy} *</Label>
                        <Select value={reason} onValueChange={setReason}>
                            <SelectTrigger>
                                <SelectValue placeholder={t.select_reason} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="SPILLAGE">{t.reason_spillage}</SelectItem>
                                <SelectItem value="THEFT">{t.reason_theft}</SelectItem>
                                <SelectItem value="COUNTING_ERROR">{t.reason_counting_error}</SelectItem>
                                <SelectItem value="SYSTEM_ERROR">{t.reason_system_deduction}</SelectItem>
                                <SelectItem value="EXPIRED">{t.reason_expired_damaged}</SelectItem>
                                <SelectItem value="OTHER">{t.other}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label>{t.notes_optional}</Label>
                        <Textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder={t.adjustment_notes_placeholder}
                            rows={3}
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={handleClose} disabled={isLoading}>
                        {t.cancel}
                    </Button>
                    <Button
                        className="bg-amber-600 hover:bg-amber-700"
                        onClick={handleSubmit}
                        disabled={isLoading || actualStock === "" || !reason}
                    >
                        {isLoading ? t.adjusting : t.adjust_stock}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
