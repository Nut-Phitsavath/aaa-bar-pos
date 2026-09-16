"use client"

import { useState, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog"
import { Plus, Edit, Trash2, Package, ShoppingCart, Minus, Settings, Search, ArrowUpDown, Store, Warehouse, Printer, Pencil, ClipboardCheck } from "lucide-react"
import { formatTHB } from "@/lib/currency"
import { formatStock } from "@/lib/stock"
import { formatStockOf, toBase, fromBase } from "@/lib/units"
import { UnitFields } from "@/components/inventory/unit-fields"
import { canEditUnits } from "@/lib/ingredient-form"
import type { MeasureType } from "@/lib/units"
import { Header } from "@/components/header"
import { FormattedNumberInput } from "@/components/ui/formatted-number-input"
import { FormattedTextInput } from "@/components/ui/formatted-text-input"
import { DepositDialog } from "@/components/inventory/deposit-dialog"
import { WithdrawDialog } from "@/components/inventory/withdraw-dialog"
import { ShopAdjustDialog } from "@/components/inventory/shop-adjust-dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useTranslation } from "@/hooks/use-translation"
import { notify } from "@/components/ui/sonner"
import { useConfirm, useDiscardGuard } from "@/components/confirm-provider"

type Ingredient = {
  id: string
  name: string
  unit: string
  measureType: MeasureType
  baseUnit: string
  purchaseUnit: string
  purchaseMultiplier: number
  mainStock: number
  subStock: number
  minStock: number
  maxStock: number
  minStockSub: number
  maxStockSub: number
  cost: number
  categoryId: string | null
  category?: { id: string, name: string }
}

type Category = {
  id: string
  name: string
  _count?: { ingredients: number }
}

type SortConfig = {
  key: keyof Ingredient | 'status' | null
  direction: 'asc' | 'desc'
}

export default function InventoryPage() {
  const { t } = useTranslation()
  const router = useRouter()
  const confirm = useConfirm()
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  // Overlay, Escape, × and Cancel all ask before throwing away typing.
  const { requestClose, markDirty } = useDiscardGuard(isDialogOpen, (open) => { setIsDialogOpen(open); if (!open) resetForm() })
  const [isCatDialogOpen, setIsCatDialogOpen] = useState(false)
  const [newCatName, setNewCatName] = useState("")
  // Which category row is currently being renamed in place, and the draft.
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [renameSaving, setRenameSaving] = useState(false)
  const [editingItem, setEditingItem] = useState<Ingredient | null>(null)
  const [activeTab, setActiveTab] = useState<"SUB" | "MAIN">("SUB")
  const [isTransferOpen, setIsTransferOpen] = useState(false)
  const [transferItem, setTransferItem] = useState<Ingredient | null>(null)
  const [transferQty, setTransferQty] = useState("")
  const [isDepositOpen, setIsDepositOpen] = useState(false)
  const [depositItem, setDepositItem] = useState<Ingredient | null>(null)
  const [isWithdrawOpen, setIsWithdrawOpen] = useState(false)
  const [withdrawItem, setWithdrawItem] = useState<Ingredient | null>(null)
  const [shopAdjustItem, setShopAdjustItem] = useState<Ingredient | null>(null)
  const [isShopAdjustOpen, setIsShopAdjustOpen] = useState(false)

  // Search and Sort
  const [searchQuery, setSearchQuery] = useState("")
  const [categoryFilter, setCategoryFilter] = useState("ALL")
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: null, direction: 'asc' })

  const [formData, setFormData] = useState({
    name: "",
    unit: "kg",
    measureType: "EACH",
    purchaseUnit: "",
    purchaseMultiplier: "1",
    mainStock: "",
    minStock: "",
    maxStock: "",
    minStockSub: "",
    maxStockSub: "",
    cost: "",
    categoryId: ""
  })

  // Whether this user may still change the conversion on the item being
  // edited. Uses the same function the route enforces with - re-implementing
  // the role list here is how a form and its endpoint start disagreeing.
  const [role, setRole] = useState("")
  const [unitsLocked, setUnitsLocked] = useState(false)

  useEffect(() => {
    fetchInventory()
    fetchCategories()
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setRole(d?.user?.role ?? d?.role ?? ""))
      .catch(() => setRole(""))
  }, [])

  useEffect(() => {
    if (!editingItem) { setUnitsLocked(false); return }
    // A movement row, not a non-zero balance: an ingredient received and fully
    // consumed is back at zero and must stay locked.
    fetch(`/api/stock-transactions?ingredientId=${editingItem.id}&limit=1`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        const hasMovements = Array.isArray(rows) ? rows.length > 0 : (rows?.transactions?.length ?? 0) > 0
        setUnitsLocked(!canEditUnits({ hasMovements, role }).ok)
      })
      .catch(() => setUnitsLocked(false))
  }, [editingItem, role])

  const fetchCategories = async () => {
    try {
      const res = await fetch('/api/inventory-categories')
      if (res.ok) setCategories(await res.json())
    } catch (e) { console.error(e) }
  }

  /**
   * A stock or par figure, typed in the unit the person actually holds.
   *
   * These are stored in base units, and were being sent raw - so a par of
   * "6 bottles" on a 700ml spirit saved as 6 millilitres, silently, with
   * nothing on screen saying which unit the box wanted. Same fault the deposit
   * and transfer dialogs had; this is the last place it lived.
   *
   * The placeholder is a plausible figure in that unit, so an empty box shows
   * the shape of the answer instead of nothing at all.
   *
   * Deliberately a function that returns JSX rather than a component rendered
   * as <StockField/>: a component defined inside another component is a new
   * type on every render, so React would remount the input and it would lose
   * focus after every keystroke.
   */
  const stockField = (
    field: "mainStock" | "minStock" | "maxStock" | "minStockSub" | "maxStockSub",
    placeholder: string,
  ) => (
    <div className="relative">
      <FormattedNumberInput
        allowDecimals
        className="pr-20 tabular-nums"
        placeholder={placeholder}
        value={formData[field]}
        onChange={(val: string) => setFormData({ ...formData, [field]: val })}
      />
      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black uppercase tracking-widest text-slate-300 pointer-events-none">
        {formData.purchaseUnit || ""}
      </span>
    </div>
  )

  const handleAddCategory = async () => {
    const name = newCatName.trim()
    if (!name) return
    try {
      const res = await fetch('/api/inventory-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      })
      if (res.ok) {
        notify.success(t.saved_success, { description: name })
        setNewCatName("")
        fetchCategories()
      } else {
        const err = (await res.json()).error
        notify.error(err === "CATEGORY_NAME_TAKEN" ? t.category_name_taken : err || t.save_failed)
      }
    } catch (e) {
      console.error(e)
      notify.error(t.save_failed)
    }
  }

  /**
   * Rename a category from the row it lives on.
   *
   * On failure the row stays in edit mode with the text intact: a duplicate
   * name is a thing to correct, and closing the editor would make the person
   * start again from a name they can no longer see.
   */
  const handleRenameCategory = async (id: string) => {
    const name = renameValue.trim()
    if (!name) return
    setRenameSaving(true)
    try {
      const res = await fetch(`/api/inventory-categories/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      })
      if (res.ok) {
        notify.success(t.saved_success, { description: name })
        setRenamingId(null)
        fetchCategories()
      } else {
        const err = (await res.json()).error
        notify.error(err === "CATEGORY_NAME_TAKEN" ? t.category_name_taken : err || t.save_failed)
      }
    } catch (e) {
      console.error(e)
      notify.error(t.save_failed)
    } finally {
      setRenameSaving(false)
    }
  }

  const fetchInventory = async () => {
    try {
      const res = await fetch('/api/inventory')
      if (res.ok) {
        setIngredients(await res.json())
      }
    } catch (e) {
      console.error(e)
    }
  }

  const handleSubmit = async () => {
    try {
      const url = editingItem ? `/api/inventory/${editingItem.id}` : '/api/inventory'
      const method = editingItem ? 'PUT' : 'POST'

      // The multiplier as it stands on the form: if it was just changed, the
      // par figures the person typed are in the NEW unit, which is what they
      // meant by typing them there.
      const multiplier = parseFloat(formData.purchaseMultiplier) || 1

      // Convert string values to numbers for API
      const payload = {
        name: formData.name,
        // The legacy column keeps showing something sensible on screens that
        // still read it; nothing computes from it any more.
        unit: formData.purchaseUnit || formData.unit,
        measureType: formData.measureType,
        purchaseUnit: formData.purchaseUnit,
        purchaseMultiplier: parseFloat(formData.purchaseMultiplier) || 1,
        // Typed in purchase units - what a person counts - and stored in base
        // units like every other quantity in the system.
        mainStock: toBase(parseFloat(formData.mainStock) || 0, multiplier),
        minStock: toBase(parseFloat(formData.minStock) || 0, multiplier),
        maxStock: toBase(parseFloat(formData.maxStock) || 0, multiplier),
        minStockSub: toBase(parseFloat(formData.minStockSub) || 0, multiplier),
        maxStockSub: toBase(parseFloat(formData.maxStockSub) || 0, multiplier),
        cost: parseFloat(formData.cost) || 0,
        categoryId: formData.categoryId || null
      }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (res.ok) {
        setIsDialogOpen(false)
        resetForm()
        fetchInventory()
      }
    } catch (e) {
      console.error(e)
    }
  }

  const handleEdit = (item: Ingredient) => {
    item.subStock = Number(item.subStock) || 0;
    item.mainStock = Number(item.mainStock) || 0;
    item.minStock = Number(item.minStock) || 0;
    item.maxStock = Number(item.maxStock) || 0;
    item.minStockSub = Number(item.minStockSub) || 0;
    item.maxStockSub = Number(item.maxStockSub) || 0;
    item.cost = Number(item.cost) || 0;

    setEditingItem(item)

    setFormData({
      name: item.name,
      unit: item.unit,
      measureType: item.measureType || "EACH",
      purchaseUnit: item.purchaseUnit || item.unit,
      purchaseMultiplier: (item.purchaseMultiplier ?? 1).toString(),
      // Shown back in the unit it was typed in. Stored base units would put
      // "4200" in a box labelled bottles.
      mainStock: fromBase(item.mainStock, item.purchaseMultiplier ?? 1).toString(),
      minStock: fromBase(item.minStock, item.purchaseMultiplier ?? 1).toString(),
      maxStock: fromBase(item.maxStock, item.purchaseMultiplier ?? 1).toString(),
      minStockSub: fromBase(item.minStockSub, item.purchaseMultiplier ?? 1).toString(),
      maxStockSub: fromBase(item.maxStockSub, item.purchaseMultiplier ?? 1).toString(),
      cost: item.cost.toString(),
      categoryId: item.categoryId || ""
    })
    setIsDialogOpen(true)
  }

  const handleTransfer = async () => {
    if (!transferItem || !transferQty) return
    try {
      // Record transaction
      const res = await fetch('/api/stock-transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ingredientId: transferItem.id,
          type: 'TRANSFER',
          // Typed in purchase units, moved in base units - staff carry bottles
          // from the store room, not millilitres.
          quantity: toBase(parseFloat(transferQty), transferItem.purchaseMultiplier),
          fromStore: 'MAIN',
          toStore: 'SUB'
        })
      })

      if (res.ok) {
        notify.success(t.transfer_success, { description: `${transferQty} ${transferItem.purchaseUnit} — ${transferItem.name} → ${t.to_shop}` })
        setIsTransferOpen(false)
        setTransferQty("")
        fetchInventory()
      } else {
        notify.error(t.transfer_failed)
      }
    } catch (e) {
      console.error(e)
      notify.error(t.transfer_failed)
    }
  }

  const handleDelete = async (id: string) => {
    if (!(await confirm({ title: t.delete_confirm_title, description: t.cannot_be_undone, confirmLabel: t.delete, destructive: true }))) return

    try {
      const res = await fetch(`/api/inventory/${id}`, { method: 'DELETE' })
      if (res.ok) {
        notify.success(t.deleted_success)
        fetchInventory()
      } else {
        notify.error((await res.json()).error || t.delete_failed)
      }
    } catch (e) {
      console.error(e)
      notify.error(t.delete_failed)
    }
  }

  const resetForm = () => {
    setEditingItem(null)
    setFormData({
      name: "",
      unit: "kg",
      measureType: "EACH",
      purchaseUnit: "",
      purchaseMultiplier: "1",
      mainStock: "",
      minStock: "",
      maxStock: "",
      minStockSub: "",
      maxStockSub: "",
      cost: "",
      categoryId: ""
    })
  }

  const getStockStatus = (item: Ingredient) => {
    const isSub = activeTab === "SUB"
    const stock = isSub ? item.subStock : item.mainStock
    const min = isSub ? item.minStockSub : item.minStock
    const max = isSub ? item.maxStockSub : item.maxStock

    if (stock <= min) {
      return { label: t.low_stock, color: "bg-red-100 text-red-800" }
    } else if (stock >= max) {
      return { label: t.overstock, color: "bg-yellow-100 text-yellow-800" }
    }
    return { label: t.normal, color: "bg-green-100 text-green-800" }
  }

  const handleSort = (key: keyof Ingredient | 'status') => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const sortedIngredients = useMemo(() => {
    let sortableItems = [...ingredients];

    // Filter
    if (searchQuery) {
      sortableItems = sortableItems.filter(item =>
        item.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    }

    if (categoryFilter !== "ALL") {
      sortableItems = sortableItems.filter(item => item.categoryId === categoryFilter)
    }

    // Sort
    if (sortConfig.key) {
      sortableItems.sort((a, b) => {
        if (sortConfig.key === 'status') {
          // Helper to get priority (1: Low, 2: Over, 3: Normal)
          const getP = (i: Ingredient) => {
            const isSub = activeTab === "SUB"
            const stock = isSub ? i.subStock : i.mainStock
            const min = isSub ? i.minStockSub : i.minStock
            const max = isSub ? i.maxStockSub : i.maxStock

            if (stock <= min) return 1
            if (stock >= max) return 2
            return 3
          }
          const pA = getP(a)
          const pB = getP(b)
          if (pA < pB) return sortConfig.direction === 'asc' ? -1 : 1
          if (pA > pB) return sortConfig.direction === 'asc' ? 1 : -1
          return 0
        }

        // @ts-ignore
        if (a[sortConfig.key] < b[sortConfig.key]) {
          return sortConfig.direction === 'asc' ? -1 : 1;
        }
        // @ts-ignore
        if (a[sortConfig.key] > b[sortConfig.key]) {
          return sortConfig.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }
    return sortableItems;
  }, [ingredients, sortConfig, searchQuery, categoryFilter]);

  return (
    <div className="min-h-screen bg-background">
      <Header title={t.inventory_management} />

      <div className="p-6 space-y-6">
        {/* Inventory View Tabs */}
        <Tabs value={activeTab} onValueChange={(val) => setActiveTab(val as "SUB" | "MAIN")} className="w-full">
          <div className="flex justify-between items-center mb-6">
            <TabsList className="grid w-full grid-cols-2 lg:w-[400px]">
              <TabsTrigger value="SUB" className="font-bold h-11">
                <Store className="w-4 h-4 mr-2" />
                {t.shop_inventory || "Shop Inventory"}
              </TabsTrigger>
              <TabsTrigger value="MAIN" className="font-bold h-11">
                <Warehouse className="w-4 h-4 mr-2" />
                {t.warehouse || "Warehouse"}
              </TabsTrigger>
            </TabsList>

            <div className="flex gap-2">
              <div className="relative w-64">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t.search_items}
                  className="pl-8"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <select
                className="h-10 px-3 rounded-md border border-input bg-background text-sm ring-offset-background"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="ALL">{t.all_categories || "All Categories"}</option>
                {categories.map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
              
              {/* Req #22: the count starts on paper, at the fridge... */}
              <Button
                variant="outline"
                className="border-slate-200"
                onClick={() => router.push('/inventory/audit-sheet')}
              >
                <Printer className="w-4 h-4 mr-2" />
                {t.print_count_sheet}
              </Button>

              {/* ...and ends here. Without this the sheet printed, somebody
                  walked the room with a pen, and there was nowhere to type the
                  numbers back in - which is why the variance report had never
                  had a single row to read. */}
              <Button
                variant="outline"
                className="border-slate-200"
                onClick={() => router.push('/inventory/count')}
              >
                <ClipboardCheck className="w-4 h-4 mr-2" />
                {t.enter_count}
              </Button>

              <Dialog
                open={isCatDialogOpen}
                onOpenChange={(open) => {
                  setIsCatDialogOpen(open)
                  // Closing mid-rename must not leave a half-typed draft
                  // waiting to reappear the next time it opens.
                  if (!open) { setRenamingId(null); setRenameValue(""); setNewCatName("") }
                }}
              >
                <DialogTrigger asChild>
                  <Button variant="outline" className="border-amber-200 text-amber-700 hover:bg-amber-50">
                    <Settings className="w-4 h-4 mr-2" />
                    {t.manage_categories || "Categories"}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{t.manage_categories || "Manage Ingredient Categories"}</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="flex gap-2">
                      <Input
                        placeholder={t.new_category_name || "New category name"}
                        value={newCatName}
                        onChange={e => setNewCatName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && newCatName.trim()) handleAddCategory() }}
                        className="h-11 rounded-xl"
                      />
                      {/* Amber, like every other primary action in the app. It
                          was the default dark button, which reads as a
                          different kind of control than it is. */}
                      <Button
                        className="h-11 px-5 rounded-xl bg-amber-600 hover:bg-amber-700 font-bold shrink-0"
                        disabled={!newCatName.trim()}
                        onClick={handleAddCategory}
                      >
                        {t.add || "Add"}
                      </Button>
                    </div>
                    {/* A list, not a table - there are no columns to compare,
                        and Table without a header is a heavier component than
                        the content deserves. */}
                    <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100 max-h-[320px] overflow-y-auto">
                      {categories.length === 0 && (
                        <p className="px-4 py-10 text-center text-sm text-slate-400">{t.no_categories_yet}</p>
                      )}
                      {categories.map(cat => {
                        const editing = renamingId === cat.id
                        const dirty = renameValue.trim() && renameValue.trim() !== cat.name
                        return (
                          <div key={cat.id} className="flex items-center gap-2 px-3 py-2">
                            {editing ? (
                              /* Renamed in place. A browser prompt() cannot be
                                 styled, cannot be translated, and drops the
                                 person out of the app to a grey OS box. */
                              <>
                                <Input
                                  autoFocus
                                  value={renameValue}
                                  disabled={renameSaving}
                                  onChange={(e) => setRenameValue(e.target.value)}
                                  onFocus={(e) => e.currentTarget.select()}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" && dirty) handleRenameCategory(cat.id)
                                    if (e.key === "Escape") setRenamingId(null)
                                  }}
                                  className="h-11 flex-1 rounded-xl border-amber-500 focus:ring-4 focus:ring-amber-500/10"
                                />
                                <Button
                                  size="sm"
                                  className="h-11 px-4 rounded-xl bg-amber-600 hover:bg-amber-700 font-bold"
                                  disabled={!dirty || renameSaving}
                                  onClick={() => handleRenameCategory(cat.id)}
                                >
                                  {renameSaving ? t.saving : t.save}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-11 px-3 rounded-xl text-slate-500"
                                  disabled={renameSaving}
                                  onClick={() => setRenamingId(null)}
                                >
                                  {t.cancel}
                                </Button>
                              </>
                            ) : (
                              <>
                                {/* The name IS the affordance, so there is no
                                    second icon to decipher. The pencil stays
                                    visible rather than appearing on hover -
                                    this is a touch till and hover does not
                                    exist there. */}
                                <button
                                  type="button"
                                  title={t.rename}
                                  onClick={() => { setRenamingId(cat.id); setRenameValue(cat.name) }}
                                  className="group flex-1 flex items-center gap-2 text-left rounded-xl px-2 py-2 -mx-2 hover:bg-amber-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 transition-colors duration-150"
                                >
                                  <span className="font-semibold text-slate-900">{cat.name}</span>
                                  <Pencil className="w-3.5 h-3.5 text-slate-300 group-hover:text-amber-600 transition-colors duration-150" />
                                </button>
                                <span className="text-xs text-slate-400 tabular-nums shrink-0">
                                  {cat._count?.ingredients || 0} {t.items || "items"}
                                </span>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  title={t.delete}
                                  className="h-11 w-11 shrink-0 text-slate-300 hover:text-rose-600 hover:bg-rose-50"
                                  onClick={async () => {
                                    if (await confirm({ title: t.delete_category_confirm, description: `${cat.name} — ${t.delete_category_desc}`, confirmLabel: t.delete, destructive: true })) {
                                      const res = await fetch(`/api/inventory-categories/${cat.id}`, { method: 'DELETE' })
                                      if (res.ok) { notify.success(t.deleted_success); fetchCategories() }
                                      else notify.error((await res.json()).error || t.delete_failed)
                                    }
                                  }}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                          </div>
                        )
                      })}
                    </div>
                    <p className="text-xs text-slate-400">{t.rename_hint}</p>
                  </div>
                </DialogContent>
              </Dialog>

              {(activeTab == "MAIN" || activeTab == "SUB") ? (
                <Dialog open={isDialogOpen} onOpenChange={requestClose}>
                  <DialogTrigger asChild>
                    <Button className="bg-amber-600 hover:bg-amber-700">
                      <Plus className="w-4 h-4 mr-2" />
                      {t.add_ingredient}
                    </Button>
                  </DialogTrigger>
                  <DialogContent onInput={markDirty}>
                    <DialogHeader>
                      <DialogTitle>{editingItem ? t.edit : t.add_item} {t.inventory}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label>{t.name}</Label>
                        <FormattedTextInput value={formData.name} onChange={val => setFormData({ ...formData, name: val })} />
                      </div>
                      <div className="space-y-2">
                        <Label>{t.category || "Category"}</Label>
                        <select
                          className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          value={formData.categoryId}
                          onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
                        >
                          <option value="">{t.no_category || "No Category"}</option>
                          {categories.map((cat) => (
                            <option key={cat.id} value={cat.id}>{cat.name}</option>
                          ))}
                        </select>
                      </div>
                      <UnitFields
                        locked={unitsLocked}
                        value={{
                          name: formData.name,
                          measureType: formData.measureType as MeasureType,
                          purchaseUnit: formData.purchaseUnit,
                          purchaseMultiplier: formData.purchaseMultiplier,
                          cost: formData.cost,
                        }}
                        onChange={(next) => setFormData({
                          ...formData,
                          measureType: next.measureType,
                          purchaseUnit: next.purchaseUnit,
                          purchaseMultiplier: next.purchaseMultiplier,
                        })}
                      />
                      <div className="space-y-2">
                        <Label>{t.initial_warehouse_stock}</Label>
                        {stockField("mainStock", "12")}
                        <p className="text-xs text-muted-foreground">{t.shop_stock_starts_zero}</p>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2 p-3 bg-slate-50 rounded-lg">
                          <Label className="text-amber-800 font-bold">🏭 {t.warehouse_limits}</Label>
                          <div className="space-y-2 mt-2">
                            <Label>{t.min_stock}</Label>
                            {stockField("minStock", "6")}
                          </div>
                          <div className="space-y-2">
                            <Label>{t.max_stock}</Label>
                            {stockField("maxStock", "60")}
                          </div>
                        </div>
                        <div className="space-y-2 p-3 bg-amber-50 rounded-lg">
                          <Label className="text-amber-800 font-bold">🏪 {t.shop_limits}</Label>
                          <div className="space-y-2 mt-2">
                            <Label>{t.min_stock}</Label>
                            {stockField("minStockSub", "2")}
                          </div>
                          <div className="space-y-2">
                            <Label>{t.max_stock}</Label>
                            {stockField("maxStockSub", "12")}
                          </div>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>{t.cost_per_unit} (LAK)</Label>
                        <FormattedNumberInput allowDecimals={true} value={formData.cost} onChange={val => setFormData({ ...formData, cost: val })} />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => requestClose(false)}>{t.cancel}</Button>
                      <Button className="bg-amber-600 hover:bg-amber-700" onClick={handleSubmit}>
                        {editingItem ? t.update : t.save}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              ) : null}
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <Card className="p-6">
              <p className="text-sm text-muted-foreground mb-1">{t.total_items}</p>
              <p className="text-3xl font-bold">{ingredients.length}</p>
            </Card>
            <Card className="p-6">
              <p className="text-sm text-muted-foreground mb-1">{t.low_stock} ({activeTab === "SUB" ? "Shop" : "Whse"})</p>
              <p className="text-3xl font-bold text-red-600">
                {ingredients.filter(i => {
                  const stock = activeTab === "SUB" ? i.subStock : i.mainStock
                  const min = activeTab === "SUB" ? i.minStockSub : i.minStock
                  return stock <= min
                }).length}
              </p>
            </Card>
            <Card className="p-6">
              <p className="text-sm text-muted-foreground mb-1">{t.total_value} ({activeTab === "SUB" ? "Shop" : "Whse"})</p>
              <p className="text-2xl font-bold text-green-600">
                {formatTHB(ingredients.reduce((sum, i) => sum + ((activeTab === "SUB" ? i.subStock : i.mainStock) * i.cost), 0))}
              </p>
            </Card>
          </div>

          {/* Inventory Table */}
          <Card className="p-6">
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[300px] cursor-pointer" onClick={() => handleSort('name')}>
                      <div className="flex items-center gap-1">
                        {t.item}
                        <ArrowUpDown className="h-3 w-3" />
                      </div>
                    </TableHead>
                    <TableHead>{t.category || "Category"}</TableHead>
                    <TableHead className="cursor-pointer" onClick={() => handleSort(activeTab === 'SUB' ? 'subStock' : 'mainStock')}>
                      <div className="flex items-center gap-1">
                        Stock ({activeTab === 'SUB' ? 'Shop' : 'Whse'})
                        <ArrowUpDown className="h-3 w-3" />
                      </div>
                    </TableHead>
                    <TableHead>{t.unit}</TableHead>
                    <TableHead className="cursor-pointer" onClick={() => handleSort(activeTab === 'SUB' ? 'minStockSub' : 'minStock')}>
                      <div className="flex items-center gap-1">
                        {t.min_stock}
                        <ArrowUpDown className="h-3 w-3" />
                      </div>
                    </TableHead>
                    <TableHead>{t.cost}</TableHead>
                    <TableHead>{t.value}</TableHead>
                    <TableHead className="w-[300px] cursor-pointer" onClick={() => handleSort('status')}>
                      <div className="flex items-center gap-1">
                        {t.status}
                        <ArrowUpDown className="h-3 w-3" />
                      </div>
                    </TableHead>
                    <TableHead className="text-right">{t.actions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedIngredients.length > 0 ? (
                    sortedIngredients.map((item) => {
                      const status = getStockStatus(item)
                      return (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              <Package className="h-4 w-4 text-muted-foreground" />
                              {item.name}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">
                              {item.category?.name || t.no_category || "Uncategorized"}
                            </Badge>
                          </TableCell>
                          {/* Negative is real information - more went out than
                              was ever booked in - so it is shown rather than
                              clamped away, but shown in red because it is a
                              discrepancy to chase, not a stock level. */}
                          <TableCell className={`font-bold text-lg tabular-nums ${(activeTab === "SUB" ? item.subStock : item.mainStock) < 0 ? "text-rose-600" : ""}`}>
                            {/* "3 bottles + 250 ml", not "907.2". Staff think
                                in bottles even when the shelf is counted in ml. */}
                            {formatStockOf(activeTab === "SUB" ? item.subStock : item.mainStock, item)}
                          </TableCell>
                          <TableCell>{item.unit}</TableCell>
                          <TableCell className="tabular-nums">{formatStock(activeTab === "SUB" ? item.minStockSub : item.minStock)}</TableCell>
                          <TableCell>{formatTHB(item.cost)}</TableCell>
                          <TableCell>{formatTHB((activeTab === 'SUB' ? item.subStock : item.mainStock) * item.cost)}</TableCell>
                          <TableCell>
                            <Badge className={status.color}>{status.label}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              {activeTab === "MAIN" ? (
                                <>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-11 border-green-200 text-green-700 bg-green-50 hover:bg-green-100"
                                    onClick={() => { setDepositItem(item); setIsDepositOpen(true); }}
                                  >
                                    <ShoppingCart className="w-3 h-3 mr-1" />
                                    In
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-11 border-rose-200 text-rose-700 bg-rose-50 hover:bg-rose-100"
                                    onClick={() => { setWithdrawItem(item); setIsWithdrawOpen(true); }}
                                  >
                                    <Minus className="w-3 h-3 mr-1" />
                                    Out
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-11 border-amber-200 text-amber-700 bg-amber-50 hover:bg-amber-100"
                                    onClick={() => { setTransferItem(item); setIsTransferOpen(true); }}
                                  >
                                    To Shop
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-11 w-11 hover:bg-red-50 hover:text-red-600" onClick={() => handleDelete(item.id)}>
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-11 w-11" onClick={() => handleEdit(item)}>
                                    <Edit className="w-4 h-4" />
                                  </Button>
                                </>
                              ) : (
                                <>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-11 border-amber-200 text-amber-700 bg-amber-50 hover:bg-amber-100"
                                    onClick={() => { setShopAdjustItem(item); setIsShopAdjustOpen(true); }}
                                  >
                                    <Settings className="w-4 h-4 mr-1" />
                                    Adjust
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-11 w-11" onClick={() => handleEdit(item)}>
                                    <Edit className="w-4 h-4" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={8} className="h-24 text-center">
                        {t.no_items_found}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>

          {/* Stock Transfer Dialog */}
          <Dialog open={isTransferOpen} onOpenChange={setIsTransferOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Transfer Stock: {transferItem?.name}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Move stock from Warehouse to Shop for daily operations
                </p>
                <div className="space-y-2">
                  <Label>
                    {t.available_in_warehouse}{" "}
                    <span className="tabular-nums">
                      {transferItem ? formatStockOf(transferItem.mainStock, transferItem) : ""}
                    </span>
                  </Label>
                  <Label>{t.quantity_to_transfer} ({transferItem?.purchaseUnit})</Label>
                  <div className="relative">
                    <Input
                      type="number"
                      className="pr-20 tabular-nums"
                      placeholder={t.enter_quantity}
                      value={transferQty}
                      onChange={e => setTransferQty(e.target.value)}
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 font-black text-slate-300 pointer-events-none uppercase text-xs tracking-widest">
                      {transferItem?.purchaseUnit}
                    </span>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsTransferOpen(false)}>{t.cancel}</Button>
                <Button
                  className="bg-amber-600 hover:bg-amber-700"
                  onClick={handleTransfer}
                  disabled={!transferQty || parseFloat(transferQty) <= 0 || toBase(parseFloat(transferQty), transferItem?.purchaseMultiplier ?? 1) > (transferItem?.mainStock || 0)}
                >
                  Transfer to Shop
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* New Transaction Dialogs */}
          <DepositDialog
            open={isDepositOpen}
            onOpenChange={setIsDepositOpen}
            ingredient={depositItem}
            onSuccess={() => { fetchInventory(); setDepositItem(null); }}
          />
          <WithdrawDialog
            open={isWithdrawOpen}
            onOpenChange={setIsWithdrawOpen}
            ingredient={withdrawItem}
            onSuccess={() => { fetchInventory(); setWithdrawItem(null); }}
          />
          <ShopAdjustDialog
            open={isShopAdjustOpen}
            onOpenChange={setIsShopAdjustOpen}
            ingredient={shopAdjustItem}
            onSuccess={() => { fetchInventory(); setShopAdjustItem(null); }}
          />
        </Tabs>
      </div>
    </div>
  )
}
