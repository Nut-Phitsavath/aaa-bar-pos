"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { FormattedNumberInput } from "@/components/ui/formatted-number-input"
import { ShoppingCart } from "lucide-react"
import { useTranslation } from "@/hooks/use-translation"
import { notify } from "@/components/ui/sonner"

interface DepositDialogProps {
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

export function DepositDialog({ open, onOpenChange, ingredient, onSuccess }: DepositDialogProps) {
    const { t } = useTranslation()
    const [quantity, setQuantity] = useState("")
    const [cost, setCost] = useState("")
    const [notes, setNotes] = useState("")
    const [isLoading, setIsLoading] = useState(false)

    const handleSubmit = async () => {
        if (!ingredient || !quantity || parseFloat(quantity) <= 0) {
            notify.warn(t.enter_valid_quantity)
            return
        }

        setIsLoading(true)
        try {
            const res = await fetch('/api/inventory/deposit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ingredientId: ingredient.id,
                    quantity: parseFloat(quantity),
                    cost: cost ? parseFloat(cost) : undefined,
                    notes: notes || undefined
                })
            })

            if (res.ok) {
                notify.success(t.deposited_successfully, { description: `${quantity} ${ingredient.unit} — ${ingredient.name}` })
                handleClose()
                onSuccess()
            } else {
                const error = await res.json()
                notify.error(t.deposit_failed, { description: error.error || t.unknown_error })
            }
        } catch (e) {
            console.error(e)
            notify.error(t.deposit_failed, { description: t.please_try_again })
        } finally {
            setIsLoading(false)
        }
    }

    const handleClose = () => {
        setQuantity("")
        setCost("")
        setNotes("")
        onOpenChange(false)
    }

    if (!ingredient) return null

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <ShoppingCart className="w-5 h-5 text-green-600" />
                        {t.deposit_stock}: {ingredient.name}
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
                        <p className="text-sm text-muted-foreground">{t.current_warehouse_stock}</p>
                        <p className="text-2xl font-bold text-blue-700">{ingredient.mainStock} {ingredient.unit}</p>
                    </div>

                    <div className="space-y-2">
                        <Label>{t.quantity_to_deposit} *</Label>
                        <FormattedNumberInput
                            value={quantity}
                            onChange={setQuantity}
                            allowDecimals={true}
                            placeholder={t.enter_quantity}
                        />
                        <p className="text-xs text-muted-foreground">
                            {t.new_stock_will_be} {ingredient.mainStock + (parseFloat(quantity) || 0)} {ingredient.unit}
                        </p>
                    </div>

                    <div className="space-y-2">
                        <Label>{t.cost_per_unit_optional}</Label>
                        <FormattedNumberInput
                            value={cost}
                            onChange={setCost}
                            allowDecimals={true}
                            placeholder={t.enter_cost_per_unit}
                        />
                        <p className="text-xs text-muted-foreground">
                            {t.for_tracking_purchase_costs}
                        </p>
                    </div>

                    <div className="space-y-2">
                        <Label>{t.notes_optional}</Label>
                        <Textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder={t.supplier_notes_placeholder}
                            rows={3}
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={handleClose} disabled={isLoading}>
                        Cancel
                    </Button>
                    <Button
                        className="bg-green-600 hover:bg-green-700"
                        onClick={handleSubmit}
                        disabled={isLoading || !quantity || parseFloat(quantity) <= 0}
                    >
                        {isLoading ? t.depositing : t.deposit_stock}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
