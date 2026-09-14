"use client"

import { useState, useEffect } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Plus, Edit, Trash2, Tag, Percent } from "lucide-react"
import Link from "next/link"
import { Header } from "@/components/header"
import { formatTHB } from "@/lib/currency"

type Promotion = {
  id: string
  name: string
  description: string
  code: string
  discountType: "percentage" | "fixed"
  discountValue: number
  startDate: string
  endDate: string
  isActive: boolean
  staffPickable: boolean
  minItems: number | null
}

import { useTranslation } from "@/hooks/use-translation"
import { notify } from "@/components/ui/sonner"
import { useDiscardGuard } from "@/components/confirm-provider"

export default function PromotionsPage() {
  const { t } = useTranslation()
  const [promotions, setPromotions] = useState<Promotion[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  // Overlay, Escape, × and Cancel all ask before throwing away typing.
  const { requestClose, markDirty } = useDiscardGuard(isDialogOpen, setIsDialogOpen)
  const [editingPromo, setEditingPromo] = useState<Promotion | null>(null)

  useEffect(() => {
    fetchPromotions()
  }, [])

  const fetchPromotions = async () => {
    try {
      const res = await fetch('/api/promotions')
      if (res.ok) setPromotions(await res.json())
    } catch (e) {
      console.error(e)
    } finally {
      setIsLoading(false)
    }
  }

  const activePromotions = promotions.filter((p) => p.isActive).length
  const isExpired = (p: Promotion) => new Date(p.endDate) < new Date()

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const data = {
      name: formData.get('name'),
      description: formData.get('description'),
      code: formData.get('code'),
      discountType: formData.get('discountType'),
      discountValue: Number(formData.get('discountValue')),
      startDate: new Date(formData.get('startDate') as string).toISOString(),
      endDate: new Date(formData.get('endDate') as string).toISOString(),
      isActive: formData.get('isActive') === 'active',
      staffPickable: formData.get('staffPickable') === 'yes',
      minItems: formData.get('minItems')
    }

    const url = editingPromo ? `/api/promotions/${editingPromo.id}` : '/api/promotions'
    const method = editingPromo ? 'PUT' : 'POST'

    try {
      const res = await fetch(url, {
        method,
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' }
      })
      if (res.ok) {
        notify.success(t.saved_success, { description: String(data.name || '') })
        setIsDialogOpen(false)
        fetchPromotions()
      } else {
        const err = await res.json()
        notify.error(err.error || t.save_promotion_failed)
      }
    } catch (e) {
      notify.error(t.save_promotion_failed)
    }
  }

  const handleEdit = (promo: Promotion) => {
    setEditingPromo(promo)
    setIsDialogOpen(true)
  }

  const handleAddNew = () => {
    setEditingPromo(null)
    setIsDialogOpen(true)
  }

  return (
    <div className="min-h-screen bg-background">
      <Header title={t.promotions} />

      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="p-6">
            <p className="text-sm text-muted-foreground mb-1">{t.total_promotions}</p>
            <p className="text-3xl font-bold">{promotions.length}</p>
          </Card>
          <Card className="p-6">
            <p className="text-sm text-muted-foreground mb-1">{t.active}</p>
            <p className="text-3xl font-bold text-green-600">{activePromotions}</p>
          </Card>
          <Card className="p-6">
            <p className="text-sm text-muted-foreground mb-1">{t.inactive}</p>
            <p className="text-3xl font-bold text-red-600">{promotions.length - activePromotions}</p>
          </Card>
        </div>

        <div className="flex justify-end">
          <Dialog open={isDialogOpen} onOpenChange={requestClose}>
            <DialogTrigger asChild>
              <Button className="bg-amber-600 hover:bg-amber-700" onClick={handleAddNew}>
                <Plus className="w-4 h-4 mr-2" /> {t.create_promotion}
              </Button>
            </DialogTrigger>
            <DialogContent onInput={markDirty} className="max-w-2xl">
              <form onSubmit={handleSave}>
                <DialogHeader>
                  <DialogTitle>{editingPromo ? t.edit_promotion : t.create_promotion}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">{t.promotion_name}</Label>
                    <Input id="name" name="name" required defaultValue={editingPromo?.name} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="description">{t.description}</Label>
                    <Textarea id="description" name="description" defaultValue={editingPromo?.description || ""} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="code">{t.promo_code}</Label>
                      <Input id="code" name="code" required defaultValue={editingPromo?.code} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="discountType">{t.discount_type}</Label>
                      <select name="discountType" className="w-full h-10 px-3 rounded-md border" defaultValue={editingPromo?.discountType || "percentage"}>
                        <option value="percentage">{t.percentage}</option>
                        <option value="fixed">{t.fixed_amount}</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="discountValue">{t.discount_value}</Label>
                      <Input id="discountValue" name="discountValue" type="number" required defaultValue={editingPromo?.discountValue} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="minItems">{t.min_items}</Label>
                      <Input id="minItems" name="minItems" type="number" min={1} placeholder={t.min_items_any} defaultValue={editingPromo?.minItems ?? ""} />
                      <p className="text-xs text-muted-foreground">{t.min_items_hint}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="startDate">{t.start_date}</Label>
                      <Input id="startDate" name="startDate" type="date" required defaultValue={editingPromo?.startDate?.split('T')[0]} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="endDate">{t.end_date}</Label>
                      <Input id="endDate" name="endDate" type="date" required defaultValue={editingPromo?.endDate?.split('T')[0]} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="isActive">{t.status}</Label>
                      <select name="isActive" id="isActive" className="w-full h-10 px-3 rounded-md border" defaultValue={editingPromo?.isActive ? "active" : "inactive"}>
                        <option value="active">{t.active}</option>
                        <option value="inactive">{t.inactive}</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="staffPickable">{t.staff_pickable}</Label>
                      <select name="staffPickable" id="staffPickable" className="w-full h-10 px-3 rounded-md border" defaultValue={editingPromo && editingPromo.staffPickable === false ? "no" : "yes"}>
                        <option value="yes">{t.staff_pickable_yes}</option>
                        <option value="no">{t.staff_pickable_no}</option>
                      </select>
                      <p className="text-xs text-muted-foreground">{t.staff_pickable_hint}</p>
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => requestClose(false)}>{t.cancel}</Button>
                  <Button type="submit" className="bg-amber-600">{t.save}</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <Card className="p-6">
          <h2 className="text-lg font-bold mb-4">{t.all_promotions}</h2>
          <div className="space-y-3">
            {promotions.map((promo) => (
              <div key={promo.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <div className={`${promo.discountType === "percentage" ? "bg-purple-100" : "bg-green-100"} p-2 rounded-lg`}>
                      {promo.discountType === "percentage" ? <Percent className="w-5 h-5 text-purple-600" /> : <Tag className="w-5 h-5 text-green-600" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{promo.name}</h3>
                        {promo.isActive ? <Badge className="bg-green-600">{t.active}</Badge> : <Badge variant="secondary">{t.inactive}</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground">{promo.description}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground ml-14">
                    <span>{t.promo_code}: <span className="font-semibold text-foreground">{promo.code}</span></span>
                    <span>{t.discount_value}: <span className="font-semibold text-foreground">{promo.discountType === "percentage" ? `${promo.discountValue}%` : formatTHB(promo.discountValue)}</span></span>
                    {promo.minItems ? <span>{t.min_items}: <span className="font-semibold text-foreground">{promo.minItems}</span></span> : null}
                    {promo.staffPickable === false ? <span>{t.staff_pickable_no}</span> : null}
                    {/* The window is the thing that silently switches a promo off,
                        so it belongs on the row, not hidden in the edit dialog. */}
                    <span className={isExpired(promo) ? "text-red-600 font-medium" : undefined}>
                      {promo.startDate?.split('T')[0]} → {promo.endDate?.split('T')[0]}
                      {isExpired(promo) ? ` · ${t.promo_expired_label}` : ""}
                    </span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="icon" onClick={() => handleEdit(promo)}><Edit className="w-4 h-4" /></Button>
                </div>
              </div>
            ))}
            {promotions.length === 0 && !isLoading && <p className="text-center py-10 text-muted-foreground">{t.no_promotions_found}</p>}
          </div>
        </Card>
      </div>
    </div>
  )
}
