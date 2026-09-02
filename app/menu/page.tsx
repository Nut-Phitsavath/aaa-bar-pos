"use client"

import { useState, useEffect, useMemo } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog"
import { formatTHB } from "@/lib/currency"
import { Header } from "@/components/header"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Plus, Edit, Trash2, Search, ImageIcon, X, Check, Minus } from "lucide-react"
import Link from "next/link"
import Image from "next/image"
import { useTranslation } from "@/hooks/use-translation"
import { notify } from "@/components/ui/sonner"
import { useConfirm } from "@/components/confirm-provider"
import { PriceInput } from "@/components/ui/PriceInput"

// --- Types ---
type SizeItem = {
  id?: string
  size: string
  price: number
  isAvailable: boolean
  displayOrder: number
}

type VariationItem = {
  id?: string
  type: string // e.g., HOT, COLD, FRAPPE, BOTTLE (Editable)
  isEnabled: boolean
  displayOrder: number
  sizes: SizeItem[]
}

type MenuItem = {
  id: string
  name: string
  localName?: string
  description: string
  // price is removed from top level in DB, but UI might still have it in type definition for legacy, ignoring it.
  category: string
  isAvailable: boolean
  image?: string
  variations: VariationItem[]
}

const DEFAULT_SIZES = [
  { size: "Standard", price: 0, isAvailable: true, displayOrder: 1 },
  { size: "0 Cal Sweetener", price: 0, isAvailable: true, displayOrder: 2 },
]

export default function MenuPage() {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const [searchQuery, setSearchQuery] = useState("")
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null)
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [categories, setCategories] = useState<{ id: string, name: string, hasSugarLevel: boolean, hasShotType: boolean }[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState("")
  const [newCatSugar, setNewCatSugar] = useState(false)
  const [newCatShot, setNewCatShot] = useState(false)
  const [editingCategory, setEditingCategory] = useState<{ id: string, name: string, hasSugarLevel: boolean, hasShotType: boolean } | null>(null)
  const [newVariationType, setNewVariationType] = useState("")
  const [activeCategory, setActiveCategory] = useState<string>("All")

  // Form states
  const [formData, setFormData] = useState<Partial<MenuItem>>({})

  // Variation form state
  const [formVariations, setFormVariations] = useState<VariationItem[]>([])

  useEffect(() => {
    fetchMenuItems()
    fetchCategories()
  }, [])

  const fetchMenuItems = async () => {
    try {
      const res = await fetch('/api/menu')
      if (res.ok) {
        const data = await res.json()
        setMenuItems(data)
      }
    } catch (error) {
      console.error("Failed to fetch menu items", error)
    }
  }

  const fetchCategories = async () => {
    try {
      const res = await fetch('/api/menu/categories')
      if (res.ok) {
        setCategories(await res.json())
      }
    } catch (e) {
      console.error("Failed to fetch categories", e)
    }
  }

  const handleCreateCategory = async () => {
    if (!newCategoryName) return
    try {
      const res = await fetch('/api/menu/categories', {
        method: 'POST',
        body: JSON.stringify({
          name: newCategoryName,
          hasSugarLevel: newCatSugar,
          hasShotType: newCatShot
        }),
        headers: { 'Content-Type': 'application/json' }
      })
      if (res.ok) {
        notify.success(t.saved_success, { description: newCategoryName })
        setNewCategoryName("")
        setNewCatSugar(false)
        setNewCatShot(false)
        fetchCategories()
      } else {
        notify.error((await res.json()).error || t.save_failed)
      }
    } catch (e) {
      console.error("Failed to create category", e)
      notify.error(t.save_failed)
    }
  }

  const handleUpdateCategory = async () => {
    if (!editingCategory || !editingCategory.name) return
    try {
      const res = await fetch(`/api/menu/categories/${editingCategory.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: editingCategory.name,
          hasSugarLevel: editingCategory.hasSugarLevel,
          hasShotType: editingCategory.hasShotType
        }),
        headers: { 'Content-Type': 'application/json' }
      })
      if (res.ok) {
        notify.success(t.saved_success, { description: editingCategory.name })
        setEditingCategory(null)
        fetchCategories()
      } else {
        notify.error((await res.json()).error || t.save_failed)
      }
    } catch (e) {
      console.error("Failed to update category", e)
      notify.error(t.save_failed)
    }
  }

  const handleDeleteCategory = async (id: string) => {
    if (!(await confirm({ title: t.delete_category_confirm, description: t.delete_category_desc, confirmLabel: t.delete, destructive: true }))) return
    try {
      const res = await fetch(`/api/menu/categories/${id}`, {
        method: 'DELETE'
      })
      if (res.ok) {
        notify.success(t.deleted_success)
        fetchCategories()
      } else {
        const data = await res.json()
        notify.error(data.error || t.delete_category_failed)
      }
    } catch (e) {
      console.error("Failed to delete category", e)
    }
  }

  const filteredItems = useMemo(() => {
    return menuItems.filter((item) =>
      (activeCategory === "All" || item.category === activeCategory) &&
      (item.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.localName?.toLowerCase().includes(searchQuery.toLowerCase()))
    )
  }, [menuItems, searchQuery, activeCategory])

  const handleEdit = (item: MenuItem) => {
    setEditingItem(item)
    setFormData({
      id: item.id,
      name: item.name,
      localName: item.localName,
      description: item.description,
      category: item.category,
      isAvailable: item.isAvailable,
      image: item.image
    })

    // Load existing variations directly
    // If no variations exist (legacy item), maybe initialize with empty or standard? 
    // Let's just load what is there.
    if (!item.variations || item.variations.length === 0) {
      // Option: Initialize with standard types for convenience if empty? 
      // User asked for dynamic, so maybe start empty or with just one default?
      // Let's start with empty and let them add.
      setFormVariations([])
    } else {
      setFormVariations(item.variations.map(v => ({ ...v })))
    }

    setIsDialogOpen(true)
  }

  const handleAddNew = () => {
    setEditingItem(null)
    setFormData({
      name: "",
      localName: "",
      description: "",
      category: categories[0]?.name || "Coffee",
      isAvailable: true,
      image: ""
    })

    // Start with empty variations or maybe a default "Regular"?
    // User requested dynamic. Let's start empty and provide "Add Variation" UI.
    setFormVariations([])
    setIsDialogOpen(true)
  }

  const handleDelete = async (id: string) => {
    if (!(await confirm({ title: t.delete_confirm_title, description: t.cannot_be_undone, confirmLabel: t.delete, destructive: true }))) return
    try {
      const res = await fetch(`/api/menu/${id}`, { method: 'DELETE' })
      if (res.ok) {
        notify.success(t.deleted_success)
        fetchMenuItems()
      } else {
        // Was completely silent: a refused delete looked exactly like a successful
        // one, so the item simply stayed on screen with no explanation.
        notify.error((await res.json()).error || t.delete_failed)
      }
    } catch (error) {
      console.error("Failed to delete", error)
      notify.error(t.delete_failed)
    }
  }

  const handleSubmit = async () => {
    setIsLoading(true)

    const finalVariations = formVariations.map(v => ({
      ...v,
      sizes: v.sizes.map(s => ({
        ...s,
        price: Number(s.price)
      }))
    }))

    const payload = {
      ...formData,
      variations: finalVariations
    }

    try {
      if (editingItem) {
        // Update
        const res = await fetch(`/api/menu/${editingItem.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
          headers: { 'Content-Type': 'application/json' }
        })
        if (res.ok) {
          notify.success(t.saved_success, { description: formData.name })
          setIsDialogOpen(false)
          fetchMenuItems()
        } else {
          notify.error((await res.json()).error || t.save_failed)
        }
      } else {
        // Create
        const res = await fetch('/api/menu', {
          method: 'POST',
          body: JSON.stringify(payload),
          headers: { 'Content-Type': 'application/json' }
        })
        if (res.ok) {
          notify.success(t.saved_success, { description: formData.name })
          setIsDialogOpen(false)
          fetchMenuItems()
        } else {
          notify.error((await res.json()).error || t.save_failed)
        }
      }
    } catch (error) {
      console.error("Failed to save", error)
      notify.error(t.save_failed)
    } finally {
      setIsLoading(false)
    }
  }

  // --- Variation Helpers ---
  const addVariationType = () => {
    if (!newVariationType) return;
    setFormVariations([...formVariations, {
      type: newVariationType,
      isEnabled: true,
      displayOrder: formVariations.length + 1,
      sizes: DEFAULT_SIZES.map(s => ({ ...s }))
    }])
    setNewVariationType("")
  }

  const removeVariationType = (index: number) => {
    const next = [...formVariations]
    next.splice(index, 1)
    setFormVariations(next)
  }

  const toggleVariation = (index: number) => {
    const next = [...formVariations]
    next[index].isEnabled = !next[index].isEnabled
    setFormVariations(next)
  }

  const updateSizePrice = (varIndex: number, sizeIndex: number, newPrice: number) => {
    const next = [...formVariations]
    next[varIndex].sizes[sizeIndex].price = newPrice
    setFormVariations(next)
  }



  const addSize = (varIndex: number) => {
    const next = [...formVariations]
    next[varIndex].sizes.push({
      size: "XL",
      price: 0,
      isAvailable: true,
      displayOrder: next[varIndex].sizes.length + 1
    })
    setFormVariations(next)
  }

  const removeSize = (varIndex: number, sizeIndex: number) => {
    const next = [...formVariations]
    next[varIndex].sizes.splice(sizeIndex, 1)
    setFormVariations(next)
  }

  const updateSizeLabel = (varIndex: number, sizeIndex: number, newLabel: string) => {
    const next = [...formVariations]
    next[varIndex].sizes[sizeIndex].size = newLabel
    setFormVariations(next)
  }

  const updateOrder = (type: 'variation' | 'size', vIndex: number, value: string, sIndex?: number) => {
    const next = [...formVariations]
    const val = Math.max(1, parseInt(value) || 1)
    if (type === 'variation') {
      next[vIndex].displayOrder = val
    } else if (type === 'size' && sIndex !== undefined) {
      next[vIndex].sizes[sIndex].displayOrder = val
    }
    setFormVariations(next)
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* Header */}

      <Header title={t.menu_management}>
        <Link href="/menu/recipes">
          <Button variant="outline" size="lg" className="text-md">{t.recipes}</Button>
        </Link>
      </Header>

      <div className="p-6 space-y-6">
        {/* Search and Add */}
        <div className="flex gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              placeholder={t.search_menu_items}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Dialog open={isCategoryDialogOpen} onOpenChange={setIsCategoryDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="border-amber-600 text-amber-600 hover:bg-amber-50">
                <Plus className="w-4 h-4 mr-2" />
                {t.new_category}
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{t.manage_categories || "Manage Categories"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-6 py-4">
                {/* Create New */}
                <div className="space-y-3">
                  <Label htmlFor="catName">{t.add_new_category || "Add New Category"}</Label>
                  <div className="flex gap-2">
                    <Input
                      id="catName"
                      value={newCategoryName}
                      onChange={e => setNewCategoryName(e.target.value)}
                      placeholder={t.category_name}
                    />
                    <Button className="bg-amber-600 shrink-0" onClick={handleCreateCategory}>
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="flex gap-4 pt-1">
                    <div className="flex items-center space-x-2">
                      <Switch id="sugar-new" checked={newCatSugar} onCheckedChange={setNewCatSugar} />
                      <Label htmlFor="sugar-new" className="text-xs">{t.sugar_level}</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Switch id="shot-new" checked={newCatShot} onCheckedChange={setNewCatShot} />
                      <Label htmlFor="shot-new" className="text-xs">{t.shot_type}</Label>
                    </div>
                  </div>
                </div>

                {/* List Existing */}
                <div className="space-y-3">
                  <Label>{t.existing_categories || "Existing Categories"}</Label>
                  <div className="max-h-[350px] overflow-y-auto space-y-3 pr-2 border rounded-md p-2">
                    {categories.map((cat) => (
                      <div key={cat.id} className="p-3 rounded-lg border bg-slate-50 space-y-2">
                        {editingCategory?.id === cat.id ? (
                          <>
                            <div className="flex items-center gap-2">
                              <Input
                                value={editingCategory.name}
                                onChange={e => setEditingCategory({ ...editingCategory, name: e.target.value })}
                                className="h-8"
                                autoFocus
                              />
                              <Button size="sm" variant="ghost" className="text-green-600 h-11 w-11 p-0" onClick={handleUpdateCategory}>
                                <Check className="w-4 h-4" />
                              </Button>
                              <Button size="sm" variant="ghost" className="text-slate-400 h-11 w-11 p-0" onClick={() => setEditingCategory(null)}>
                                <X className="w-4 h-4" />
                              </Button>
                            </div>
                            <div className="flex gap-4">
                              <div className="flex items-center space-x-2">
                                <Switch id={`sugar-${cat.id}`} checked={editingCategory.hasSugarLevel} onCheckedChange={(val) => setEditingCategory({ ...editingCategory, hasSugarLevel: val })} />
                                <Label htmlFor={`sugar-${cat.id}`} className="text-xs">{t.sugar}</Label>
                              </div>
                              <div className="flex items-center space-x-2">
                                <Switch id={`shot-${cat.id}`} checked={editingCategory.hasShotType} onCheckedChange={(val) => setEditingCategory({ ...editingCategory, hasShotType: val })} />
                                <Label htmlFor={`shot-${cat.id}`} className="text-xs">{t.shot}</Label>
                              </div>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-amber-900">{cat.name}</span>
                              <div className="flex gap-1">
                                <Button size="sm" variant="ghost" className="text-slate-500 h-11 w-11 p-0" onClick={() => setEditingCategory({ ...cat })}>
                                  <Edit className="w-4 h-4" />
                                </Button>
                                <Button size="sm" variant="ghost" className="text-red-500 h-11 w-11 p-0" onClick={() => handleDeleteCategory(cat.id)}>
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>
                            <div className="flex gap-3">
                              {cat.hasSugarLevel && <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-200">{t.sugar_level}</Badge>}
                              {cat.hasShotType && <Badge variant="outline" className="text-[10px] bg-purple-50 text-purple-700 border-purple-200">{t.shot_type}</Badge>}
                              {!cat.hasSugarLevel && !cat.hasShotType && <span className="text-[10px] text-muted-foreground italic">{t.no_customizations}</span>}
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" className="w-full" onClick={() => setIsCategoryDialogOpen(false)}>{t.close || "Close"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-amber-600 hover:bg-amber-700" onClick={handleAddNew}>
                <Plus className="w-4 h-4 mr-2" />
                {t.add_item}
              </Button>
            </DialogTrigger>
            <DialogContent className="w-[95vw] max-w-7xl max-h-[95vh] overflow-y-auto" size="xl">
              <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
                <DialogHeader>
                  <DialogTitle>{editingItem ? t.edit_menu_item : t.add_menu_item}</DialogTitle>
                </DialogHeader>

                <div className="space-y-6 py-4">
                  {/* Basic Info Section */}
                  <div className="grid grid-cols-2 gap-6 p-4 border rounded-lg bg-slate-50">
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="name">{t.item_name} (EN)</Label>
                        <Input
                          id="name"
                          value={formData.name || ""}
                          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                          required
                          placeholder={t.english_name}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="localName">{t.item_name} (LAO)</Label>
                        <Input
                          id="localName"
                          value={formData.localName || ""}
                          onChange={(e) => setFormData({ ...formData, localName: e.target.value })}
                          placeholder="ຊື່ພາສາລາວ"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="category">{t.category}</Label>
                        <select
                          id="category"
                          className="w-full h-10 px-3 rounded-md border border-input bg-background"
                          value={formData.category || (categories[0]?.name || "")}
                          onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                        >
                          {categories.map((cat) => (
                            <option key={cat.id} value={cat.name}>
                              {cat.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="description">{t.description}</Label>
                        <Textarea
                          id="description"
                          value={formData.description || ""}
                          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        />
                      </div>
                    </div>

                    <div className="space-y-4">
                      <Label>{t.item_image}</Label>
                      <div className="flex gap-4 items-start">
                        <div className="w-32 h-32 bg-white rounded-lg flex items-center justify-center overflow-hidden border shadow-sm">
                          {formData.image ? (
                            <Image src={formData.image} alt="Preview" width={128} height={128} className="object-cover" />
                          ) : (
                            <ImageIcon className="w-10 h-10 text-slate-300" />
                          )}
                        </div>
                        <div className="flex-1 space-y-2">
                          <Input
                            type="file"
                            accept="image/*"
                            onChange={async (e) => {
                              const file = e.target.files?.[0]
                              if (!file) return

                              const uploadFormData = new FormData()
                              uploadFormData.append("file", file)

                              try {
                                setIsLoading(true)
                                const res = await fetch("/api/upload", {
                                  method: "POST",
                                  body: uploadFormData,
                                })
                                if (res.ok) {
                                  const { url } = await res.json()
                                  setFormData({ ...formData, image: url })
                                  notify.success(t.image_uploaded)
                                } else {
                                  // Staff send whatever the camera roll gives them, so
                                  // say which problem it is -- "failed" alone leaves a
                                  // non-technical user with nothing to try.
                                  const err = await res.json().catch(() => ({}))
                                  notify.error(
                                    err.code === "TOO_LARGE" ? t.image_too_large
                                      : err.code === "NOT_IMAGE" ? t.image_not_readable
                                        : t.image_upload_failed
                                  )
                                }
                              } catch (e) {
                                console.error("Upload failed", e)
                                notify.error(t.image_upload_failed)
                              } finally {
                                setIsLoading(false)
                              }
                            }}
                          />
                          <p className="text-xs text-muted-foreground">{t.recommended_image_msg}</p>
                          {formData.image && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-red-600 h-auto p-0 hover:bg-transparent hover:text-red-700"
                              onClick={() => setFormData({ ...formData, image: "" })}
                            >
                              {t.remove_image}
                            </Button>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center space-x-2 pt-2">
                        <Switch
                          id="availability"
                          checked={formData.isAvailable ?? true}
                          onCheckedChange={(checked) => setFormData({ ...formData, isAvailable: checked })}
                        />
                        <Label htmlFor="availability">{t.available}</Label>
                      </div>
                    </div>
                  </div>

                  {/* Variations & Pricing Section */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold">{t.variations_pricing}</h3>
                    </div>

                    {/* Dynamic Variation Adder */}
                    <div className="flex gap-2">
                      <Input
                        placeholder={t.variation_name_placeholder}

                        value={newVariationType}
                        onChange={(e) => setNewVariationType(e.target.value.toUpperCase())}
                        className="max-w-[300px]"
                      />
                      <Button type="button" onClick={addVariationType} disabled={!newVariationType}>
                        <Plus className="w-4 h-4 mr-2" /> {t.add_variation_type}
                      </Button>
                    </div>

                    <div className="space-y-4">
                      {formVariations.map((variation, vIndex) => (
                        <Card key={vIndex} className={`p-4 border ${variation.isEnabled ? 'border-amber-200 bg-amber-50/10' : 'border-slate-200 opacity-70'}`}>
                          <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-3">
                              <Switch
                                checked={variation.isEnabled}
                                onCheckedChange={() => toggleVariation(vIndex)}
                              />
                              <Label className="text-base font-bold">{variation.type}</Label>
                            </div>
                            <div className="flex gap-2 items-center">
                              {variation.isEnabled && (
                                <>
                                  <div className="flex items-center gap-1">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-11 w-11 p-0 text-amber-600 border-amber-200"
                                      onClick={() => updateOrder("variation", vIndex, (variation.displayOrder - 1).toString())}
                                      disabled={variation.displayOrder <= 1}
                                    >
                                      <Minus className="w-3 h-3" />
                                    </Button>
                                    <div className="w-8 h-8 flex items-center justify-center bg-white border rounded font-bold text-xs">
                                      {variation.displayOrder}
                                    </div>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-11 w-11 p-0 text-amber-600 border-amber-200"
                                      onClick={() => updateOrder("variation", vIndex, (variation.displayOrder + 1).toString())}
                                    >
                                      <Plus className="w-3 h-3" />
                                    </Button>
                                  </div>
                                  <Button type="button" variant="ghost" size="sm" onClick={() => addSize(vIndex)} className="text-amber-600">
                                    <Plus className="w-4 h-4 mr-2" /> {t.add_choice}
                                  </Button>
                                </>
                              )}
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="text-red-500 hover:text-red-700 hover:bg-red-50"
                                onClick={() => removeVariationType(vIndex)}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>

                          {variation.isEnabled && (
                            <div className="grid grid-cols-1 gap-3">
                              {variation.sizes.map((size, sIndex) => (
                                <div key={sIndex} className="flex items-center gap-2 bg-white p-2 rounded border shadow-sm">
                                  <div className="flex items-center gap-1">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-10 w-10 p-0 text-slate-500 border-slate-200"
                                      onClick={() => updateOrder("size", vIndex, (size.displayOrder - 1).toString(), sIndex)}
                                      disabled={size.displayOrder <= 1}
                                    >
                                      <Minus className="w-5 h-5" />
                                    </Button>
                                    <div className="w-10 h-10 flex items-center justify-center bg-white border rounded font-bold text-sm">
                                      {size.displayOrder}
                                    </div>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-10 w-10 p-0 text-slate-500 border-slate-200"
                                      onClick={() => updateOrder("size", vIndex, (size.displayOrder + 1).toString(), sIndex)}
                                    >
                                      <Plus className="w-5 h-5" />
                                    </Button>
                                  </div>
                                  <div className="flex-[2]">
                                    <Input
                                      value={size.size}
                                      onChange={(e) => updateSizeLabel(vIndex, sIndex, e.target.value)}
                                      className="h-10 text-left font-bold"
                                      placeholder={t.size_label}
                                    />
                                  </div>
                                  <div className="w-32">
                                    <PriceInput
                                      value={size.price}
                                      onChange={(num) => updateSizePrice(vIndex, sIndex, num)}
                                      className="h-10 text-right font-mono"
                                      placeholder={t.price_lak}
                                      currency="₭"
                                    />
                                  </div>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-9 w-9 text-red-400 hover:text-red-600"
                                    onClick={() => removeSize(vIndex, sIndex)}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          )}
                        </Card>
                      ))}
                    </div>
                  </div>
                </div>

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                    {t.cancel}
                  </Button>
                  <Button type="submit" className="bg-amber-600 hover:bg-amber-700" disabled={isLoading}>
                    {isLoading ? t.processing : t.save}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {/* Categories Bar */}
        <div className="flex flex-wrap gap-2 p-1 overflow-x-auto pb-2 no-scrollbar border-b">
          <Button
            variant={activeCategory === "All" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveCategory("All")}
            className={activeCategory === "All" ? "bg-amber-600 hover:bg-amber-700 h-11 px-4 rounded-full" : "h-11 px-4 rounded-full"}
          >
            {t.all_categories || "All Categories"}
          </Button>
          {categories.map((cat) => (
            <Button
              key={cat.id}
              variant={activeCategory === cat.name ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveCategory(cat.name)}
              className={activeCategory === cat.name ? "bg-amber-600 hover:bg-amber-700 h-11 px-4 rounded-full" : "h-11 px-4 rounded-full"}
            >
              {cat.name}
            </Button>
          ))}
        </div>

        {/* Menu Items Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
          {filteredItems.map((item) => (
            <Card
              key={item.id}
              className="flex flex-col group overflow-hidden border-2 border-slate-100 hover:border-amber-200 transition-all duration-300 shadow-sm hover:shadow-xl bg-white"
            >
              {/* Image Container */}
              <div className="relative aspect-square overflow-hidden bg-slate-50">
                {item.image ? (
                  <Image
                    src={item.image}
                    alt={item.name}
                    fill
                    sizes="(max-width: 768px) 50vw, (max-width: 1200px) 33vw, 20vw"
                    className="object-cover transition-transform duration-500 group-hover:scale-110"
                  />
                ) : (
                  <div className="flex items-center justify-center w-full h-full text-4xl bg-gradient-to-br from-amber-50 to-orange-100">
                    ☕
                  </div>
                )}
                
                {/* Status Badge */}
                {!item.isAvailable && (
                  <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center z-10">
                    <Badge variant="destructive" className="px-3 py-1 font-bold tracking-widest uppercase">
                      {t.unavailable}
                    </Badge>
                  </div>
                )}

                {/* Quick actions overlay */}
                {/* Hover-reveal on anything with a mouse, always visible on touch.
                    Tailwind gates hover: behind @media (hover:hover), so a plain
                    hover-reveal is unreachable on the till -- pointer-fine: scopes
                    the hiding to devices that can actually hover. */}
                <div className="absolute bottom-2 right-2 flex gap-2 z-20 transition-all duration-300
                                pointer-fine:opacity-0 pointer-fine:translate-y-2
                                pointer-fine:group-hover:opacity-100 pointer-fine:group-hover:translate-y-0">
                  <Button 
                    variant="secondary" 
                    size="icon" 
                    className="h-11 w-11 rounded-full shadow-lg bg-white/95 backdrop-blur hover:bg-white"
                    onClick={() => handleEdit(item)}
                  >
                    <Edit className="w-5 h-5 text-amber-600" />
                  </Button>
                  <Button 
                    variant="secondary" 
                    size="icon" 
                    className="h-11 w-11 rounded-full shadow-lg bg-white/95 backdrop-blur hover:bg-red-50"
                    onClick={() => handleDelete(item.id)}
                  >
                    <Trash2 className="w-5 h-5 text-red-600" />
                  </Button>
                </div>
              </div>

              {/* Info Container */}
              <div className="p-3 flex-1 flex flex-col justify-between">
                <div>
                  <div className="flex items-start justify-between gap-1 mb-1">
                    <h3 className="font-black text-amber-950 leading-tight line-clamp-1">{item.localName || item.name}</h3>
                  </div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest line-clamp-1 mb-2">{item.name}</p>
                </div>

                <div className="flex items-center justify-between mt-1">
                  <Badge variant="outline" className="text-[9px] font-bold bg-slate-50 border-slate-200 text-slate-500 uppercase">
                    {item.category}
                  </Badge>
                  <div className="flex -space-x-1">
                    {item.variations?.filter(v => v.isEnabled).slice(0, 3).map((v, i) => (
                      <div 
                        key={i} 
                        className="w-5 h-5 rounded-full border border-white bg-amber-100 flex items-center justify-center text-[8px] font-black text-amber-700 shadow-sm"
                        title={v.type}
                      >
                        {v.type[0]}
                      </div>
                    ))}
                    {(item.variations?.filter(v => v.isEnabled).length || 0) > 3 && (
                      <div className="w-5 h-5 rounded-full border border-white bg-slate-100 flex items-center justify-center text-[8px] font-black text-slate-500">
                        +{(item.variations?.filter(v => v.isEnabled).length || 0) - 3}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div >
  )
}
