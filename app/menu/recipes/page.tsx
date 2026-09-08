"use client"

import { useState, useEffect } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog"
import { Plus, Search, Trash2, ChevronRight, ChevronLeft, Package, Coffee } from "lucide-react"
import { FormattedTextInput } from "@/components/ui/formatted-text-input"
import { FormattedNumberInput } from "@/components/ui/formatted-number-input"
import { UnitFields } from "@/components/inventory/unit-fields"
import type { MeasureType } from "@/lib/units"
import Link from "next/link"
import { formatTHB } from "@/lib/currency"

type Size = {
    id: string
    size: string
    price: number
    displayOrder: number
}

type Variation = {
    id: string
    type: string
    sizes: Size[]
}

type Product = {
    id: string
    name: string
    categoryName: string
    variations: Variation[]
    _count?: { recipes: number }
}

type Ingredient = {
    id: string
    name: string
    unit: string
    categoryId?: string | null
    category?: { name: string }
}

type Category = {
    id: string
    name: string
}

/** What GET /api/recipes/:id/cost returns. */
type CostLine = { name: string; quantity: number; baseUnit: string; cost: number }
type CostInfo = {
    cost: number
    price: number
    margin: number
    pourCostPct: number
    band: [number, number]
    verdict: "BELOW_COST" | "HIGH" | "OK" | "LOW"
    lines: CostLine[]
}

type RecipeItem = {
    id: string
    productId: string
    ingredientId: string
    variationSizeId: string | null
    quantity: number
    ingredientName: string
    unit: string
}

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useTranslation } from "@/hooks/use-translation"
import { useConfirm } from "@/components/confirm-provider"
import { notify } from "@/components/ui/sonner"
import React from "react"

export default function RecipesPage() {
    const { t } = useTranslation()
    const confirm = useConfirm()
    const [products, setProducts] = useState<Product[]>([])
    const [ingredients, setIngredients] = useState<Ingredient[]>([])
    const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
    const [recipe, setRecipe] = useState<RecipeItem[]>([])
    // Which ingredients the menu also sells one of, and for how much. Without
    // this the screen cannot say whether a package component is swappable.
    const [components, setComponents] = useState<Record<string, { name: string; localName: string | null; unitPrice: number }> | null>(null)
    const [searchQuery, setSearchQuery] = useState("")
    const [isAddIngredientOpen, setIsAddIngredientOpen] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const [activeTab, setActiveTab] = useState("base")
    const [costInfo, setCostInfo] = useState<CostInfo | null>(null)
    const [costLoading, setCostLoading] = useState(false)

    /** A blank ingredient, seeded with whatever was typed into the search. */
    const emptyDraft = (name = "") => ({
        name,
        categoryId: "",
        measureType: "EACH" as MeasureType,
        purchaseUnit: "",
        purchaseMultiplier: "1",
        cost: "",
    })
    const [creatingIngredient, setCreatingIngredient] = useState(false)
    const [draft, setDraft] = useState(emptyDraft())
    const [savingIngredient, setSavingIngredient] = useState(false)
    const [categories, setCategories] = useState<Category[]>([])
    const [ingredientSearch, setIngredientSearch] = useState("")
    const [selectedCatId, setSelectedCatId] = useState("ALL")

    // Form state: "s:id"
    const [targetSelection, setTargetSelection] = useState("")
    const [newRecipeItem, setNewRecipeItem] = useState({
        ingredientId: "",
        quantity: 0
    })

    useEffect(() => {
        fetchProducts()
        fetchIngredients()
        fetchCategories()
        fetch('/api/packages/components')
            .then((r) => (r.ok ? r.json() : { components: {} }))
            .then((d) => setComponents(d.components ?? {}))
            .catch(() => setComponents({}))
    }, [])

    const fetchCategories = async () => {
        try {
            const res = await fetch('/api/inventory-categories')
            if (res.ok) setCategories(await res.json())
        } catch (e) { console.error(e) }
    }

    useEffect(() => {
        if (selectedProduct) {
            fetchRecipe(selectedProduct.id)
            setActiveTab("base")
        }
    }, [selectedProduct])

    /**
     * What this serving costs, against what it sells for.
     *
     * Refetched after every recipe edit rather than computed here, so the
     * footer and the rows above it can never disagree - and so a change to an
     * ingredient's cost shows up without anyone reloading the page.
     */
    useEffect(() => {
        if (!selectedProduct) { setCostInfo(null); return }
        setCostLoading(true)
        const qs = activeTab !== "base" ? `?variationSizeId=${activeTab}` : ""
        fetch(`/api/recipes/${selectedProduct.id}/cost${qs}`)
            .then((r) => (r.ok ? r.json() : null))
            .then(setCostInfo)
            .catch(() => setCostInfo(null))
            .finally(() => setCostLoading(false))
    }, [selectedProduct, activeTab, recipe])

    const fetchProducts = async () => {
        try {
            const res = await fetch('/api/menu')
            if (res.ok) setProducts(await res.json())
        } catch (e) { console.error(e) }
    }

    const fetchIngredients = async () => {
        try {
            const res = await fetch('/api/inventory')
            if (res.ok) setIngredients(await res.json())
        } catch (e) { console.error(e) }
    }

    /**
     * Create the missing ingredient and drop it straight into the recipe.
     *
     * The whole point of being here rather than on the inventory page: the
     * manager came to build a recipe, found one ingredient did not exist, and
     * should not have to leave, create it, come back and find their place.
     */
    const handleCreateAndAdd = async () => {
        setSavingIngredient(true)
        try {
            const res = await fetch('/api/inventory', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...draft,
                    unit: draft.purchaseUnit,
                    purchaseMultiplier: parseFloat(draft.purchaseMultiplier) || 1,
                    cost: parseFloat(draft.cost) || 0,
                    categoryId: draft.categoryId || null,
                    mainStock: 0, minStock: 0, maxStock: 0, minStockSub: 0, maxStockSub: 0,
                }),
            })
            if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                notify.error(err.error || "Failed to create ingredient")
                return
            }
            const created = await res.json()
            setIngredients((prev) => [...prev, created])
            setNewRecipeItem((prev) => ({ ...prev, ingredientId: created.id }))
            setCreatingIngredient(false)
        } catch (e) {
            console.error(e)
            notify.error("Failed to create ingredient")
        } finally {
            setSavingIngredient(false)
        }
    }

    const fetchRecipe = async (productId: string) => {
        try {
            const res = await fetch(`/api/recipes/${productId}`)
            if (res.ok) setRecipe(await res.json())
        } catch (e) { console.error(e) }
    }

    const handleAddIngredient = async () => {
        if (!selectedProduct || !newRecipeItem.ingredientId) return
        setIsLoading(true)

        let variationSizeId = null
        if (targetSelection.startsWith('s:')) {
            variationSizeId = targetSelection.replace('s:', '')
        }

        try {
            const res = await fetch(`/api/recipes/${selectedProduct.id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ingredientId: newRecipeItem.ingredientId,
                    quantity: newRecipeItem.quantity,
                    variationSizeId
                })
            })
            if (res.ok) {
                notify.success(t.saved_success)
                fetchRecipe(selectedProduct.id)
                setIsAddIngredientOpen(false)
                setNewRecipeItem({ ingredientId: "", quantity: 0 })
            } else {
                notify.error((await res.json()).error || t.save_failed)
            }
        } catch (e) { console.error(e); notify.error(t.save_failed) }
        finally { setIsLoading(false) }
    }

    const handleRemoveIngredient = async (ingredientId: string, variationSizeId: string | null) => {
        if (!selectedProduct) return
        if (!(await confirm({ title: t.delete_confirm_title, description: t.cannot_be_undone, confirmLabel: t.delete, destructive: true }))) return
        try {
            const res = await fetch(`/api/recipes/${selectedProduct.id}?ingredientId=${ingredientId}&variationSizeId=${variationSizeId || 'null'}`, {
                method: 'DELETE'
            })
            if (res.ok) {
                notify.success(t.deleted_success)
                fetchRecipe(selectedProduct.id)
            } else {
                notify.error((await res.json()).error || t.delete_failed)
            }
        } catch (e) { console.error(e); notify.error(t.delete_failed) }
    }

    const filteredProducts = products
        .filter(p =>
            p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            p.categoryName?.toLowerCase().includes(searchQuery.toLowerCase())
        )
        // Items that deduct nothing sort first: they are what somebody opened
        // this screen to fix, and hunting for them defeats the flag.
        .sort((a, b) => {
            const an = (a._count?.recipes ?? 1) === 0 ? 0 : 1
            const bn = (b._count?.recipes ?? 1) === 0 ? 0 : 1
            return an - bn || a.name.localeCompare(b.name)
        })

    // Helper to find scope name
    const getScopeName = (vSizeId: string | null) => {
        if (!vSizeId) return t.base_recipe || "Base Recipe"
        if (!selectedProduct) return ""

        for (const v of selectedProduct.variations) {
            for (const s of v.sizes) {
                if (s.id === vSizeId) return `${v.type} - ${s.size}`
            }
        }
        return "Specific Choice"
    }

    const openAddModal = (scope: string) => {
        setTargetSelection(scope)
        setIngredientSearch("")
        setSelectedCatId("ALL")
        setIsAddIngredientOpen(true)
    }

    /**
     * What this recipe's swappable contents are worth on the menu.
     *
     * The number a package is priced against: sell a set for less than its
     * parts and the gap is the deal; sell it for more and there is no reason to
     * buy the set. Only counts components a customer could actually swap, since
     * those are the ones an exchange values.
     */
    const contentsValue = (items: RecipeItem[]) =>
        components
            ? items.reduce((sum, i) => {
                const sellable = components[i.ingredientId]
                if (!sellable || !Number.isInteger(i.quantity) || i.quantity < 1) return sum
                return sum + sellable.unitPrice * i.quantity
            }, 0)
            : 0

    const RecipeSection = ({ items, scopeId }: { items: RecipeItem[], scopeId: string | null }) => (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                    <Package className="w-5 h-5 text-slate-400" />
                    {t.ingredients_list}
                </h3>
                <Button 
                    variant="outline" 
                    size="sm" 
                    className="border-amber-200 text-amber-700 hover:bg-amber-50"
                    onClick={() => openAddModal(scopeId ? `s:${scopeId}` : "")}
                >
                    <Plus className="w-4 h-4 mr-1" />
                    {t.add_ingredient}
                </Button>
            </div>
            {items.length > 0 ? (
                <div className="grid gap-3">
                    {items.map((item) => (
                        <Card key={item.id} className="p-4 flex items-center justify-between border-slate-100 shadow-sm">
                            <div className="flex items-center gap-4">
                                <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center font-bold text-amber-600 border border-amber-100">
                                    {item.ingredientName[0]}
                                </div>
                                <div>
                                    <p className="font-semibold text-slate-800">{item.ingredientName}</p>
                                    <div className="flex items-center gap-2">
                                        <p className="text-xs text-muted-foreground uppercase">{item.unit}</p>
                                        {/* Whether a customer could swap this out of the
                                            package. It hinges on something invisible here -
                                            the menu selling exactly one of this ingredient -
                                            so the screen says it rather than leaving it to be
                                            discovered at a table. */}
                                        {components && (
                                            components[item.ingredientId] && Number.isInteger(item.quantity) && item.quantity >= 1 ? (
                                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                                                    {t.swappable} · {formatTHB(components[item.ingredientId].unitPrice)}
                                                </span>
                                            ) : (
                                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200">
                                                    {t.not_sold_singly}
                                                </span>
                                            )
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-6">
                                <div className="text-right">
                                    <p className="text-xs text-muted-foreground">{t.quantity_used}</p>
                                    <p className="font-bold text-lg text-slate-900 tabular-nums">{item.quantity} {item.unit}</p>
                                    {/* Where the money actually goes. A total
                                        alone has to be taken on trust. */}
                                    {(() => {
                                        const line = costInfo?.lines.find((l) => l.name === item.ingredientName)
                                        return line ? (
                                            <p className="text-xs text-slate-400 tabular-nums">{formatTHB(line.cost)}</p>
                                        ) : null
                                    })()}
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                                    onClick={() => handleRemoveIngredient(item.ingredientId, item.variationSizeId)}
                                >
                                    <Trash2 className="w-4 h-4" />
                                </Button>
                            </div>
                        </Card>
                    ))}

                    {/* The package's economics on one line: what its swappable
                        contents are worth beside what it sells for. A set priced
                        above its parts is a set nobody has a reason to buy. */}
                    {contentsValue(items) > 0 && (
                        <div className="flex items-center gap-3 flex-wrap px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm">
                            <span className="text-slate-600">
                                {t.contents_value} <strong className="text-slate-900 tabular-nums">{formatTHB(contentsValue(items))}</strong>
                            </span>
                            {(() => {
                                const price = selectedProduct?.variations.flatMap((v) => v.sizes)[0]?.price ?? 0
                                if (!price) return null
                                const gap = contentsValue(items) - price
                                return (
                                    <span className={`ms-auto font-bold tabular-nums ${gap > 0 ? "text-emerald-700" : "text-amber-700"}`}>
                                        {t.package_price} {formatTHB(price)}
                                        {gap > 0 ? ` · −${formatTHB(gap)}` : gap < 0 ? ` · +${formatTHB(-gap)}` : ""}
                                    </span>
                                )
                            })()}
                        </div>
                    )}

                    {/* What it costs against what it sells for. Without this a
                        recipe that loses money looks identical to one that does
                        not, and the bar finds out at stocktake. It is also
                        where a wrong multiplier finally shows itself: gin
                        entered as 7ml per bottle reads as a 1,500% loss. */}
                    {costLoading ? (
                        <div className="h-11 rounded-xl bg-slate-100 animate-pulse" aria-hidden />
                    ) : costInfo && costInfo.lines.length > 0 ? (
                        <div className="flex items-center gap-4 flex-wrap px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm">
                            <span className="text-slate-600">
                                {t.recipe_cost}{" "}
                                <strong className="text-slate-900 tabular-nums">{formatTHB(costInfo.cost)}</strong>
                            </span>
                            <span className="text-slate-300" aria-hidden>·</span>
                            <span className="text-slate-600">
                                {t.recipe_margin}{" "}
                                <strong className="text-slate-900 tabular-nums">{formatTHB(costInfo.margin)}</strong>
                            </span>
                            {/* Rose loses money, emerald is in band, amber is a
                                question in either direction - out of band high
                                and out of band low are both worth a look, but
                                neither is a failure. */}
                            <span
                                className={`ms-auto font-bold tabular-nums px-2.5 py-1 rounded-lg ${
                                    costInfo.verdict === "BELOW_COST"
                                        ? "bg-rose-50 text-rose-700"
                                        : costInfo.verdict === "OK"
                                            ? "bg-emerald-50 text-emerald-700"
                                            : "bg-amber-50 text-amber-700"
                                }`}
                            >
                                {t.pour_cost} {costInfo.pourCostPct}%
                                <span className="font-semibold opacity-70">
                                    {" · "}
                                    {costInfo.verdict === "BELOW_COST" ? t.verdict_below_cost
                                        : costInfo.verdict === "HIGH" ? t.verdict_high
                                            : costInfo.verdict === "LOW" ? t.verdict_low
                                                : t.verdict_ok}
                                </span>
                            </span>
                        </div>
                    ) : null}
                </div>
            ) : (
                <div className="py-12 border-2 border-dashed rounded-xl flex flex-col items-center justify-center text-center bg-slate-50/50">
                    <Package className="w-10 h-10 text-slate-200 mb-2" />
                    <p className="text-sm text-slate-400">{t.no_ingredients_linked}</p>
                    <Button 
                        variant="link" 
                        className="text-amber-600 mt-1"
                        onClick={() => openAddModal(scopeId ? `s:${scopeId}` : "")}
                    >
                        {t.add_ingredient}
                    </Button>
                </div>
            )}
        </div>
    )

    return (
        <div className="min-h-screen bg-white flex flex-col font-sans">
            <header className="border-b bg-white/80 backdrop-blur-md sticky top-0 z-20">
                <div className="flex items-center justify-between p-4 px-6 max-w-[1600px] mx-auto w-full">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-amber-600 rounded-lg shadow-lg shadow-amber-200">
                            <Coffee className="w-6 h-6 text-white" />
                        </div>
                        <div className="flex items-center gap-2">
                            <Link href="/menu" className="text-slate-400 hover:text-slate-600 transition-colors font-medium">
                                {t.menu_management}
                            </Link>
                            <ChevronRight className="w-4 h-4 text-slate-300" />
                            <span className="text-slate-900 font-bold text-lg">{t.recipes}</span>
                        </div>
                    </div>
                </div>
            </header>

            <div className="flex-1 flex overflow-hidden max-w-[1600px] mx-auto w-full">
                {/* Product Sidebar */}
                <aside className="w-80 border-r flex flex-col bg-slate-50/50">
                    <div className="p-4 bg-white/50 border-b">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <Input
                                placeholder={t.search_products}
                                className="pl-9 h-11 bg-white border-slate-200 rounded-xl focus:ring-amber-500 focus:border-amber-500"
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                            />
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-1">
                        {filteredProducts.map(product => (
                            <button
                                key={product.id}
                                onClick={() => setSelectedProduct(product)}
                                className={`w-full text-left p-4 rounded-xl transition-all duration-200 group ${selectedProduct?.id === product.id 
                                    ? 'bg-white shadow-md border border-amber-100 ring-1 ring-amber-500/5' 
                                    : 'hover:bg-amber-50/50 border border-transparent'}`}
                            >
                                <div className="flex items-center gap-3">
                                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${selectedProduct?.id === product.id ? 'bg-amber-600 text-white' : 'bg-white border border-slate-200 text-slate-400 group-hover:bg-amber-100 group-hover:text-amber-600'}`}>
                                        <Coffee className="w-5 h-5" />
                                    </div>
                                    <div className="overflow-hidden">
                                        <p className={`font-bold truncate ${selectedProduct?.id === product.id ? 'text-slate-900' : 'text-slate-600'}`}>{product.name}</p>
                                        <div className="flex items-center gap-1.5">
                                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">{product.categoryName}</p>
                                            {/* Sellable and invisible until stocktake. Flagged
                                                rather than blocked: a corkage fee legitimately
                                                has no recipe. */}
                                            {product._count?.recipes === 0 && (
                                                <span
                                                    title={t.no_recipe_help}
                                                    className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200"
                                                >
                                                    {t.no_recipe}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>
                </aside>

                {/* Main Recipe Content */}
                <main className="flex-1 overflow-y-auto bg-white p-8 lg:p-12">
                    {selectedProduct ? (
                        <div className="max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="mb-10 space-y-2">
                                <Badge variant="secondary" className="bg-amber-100 text-amber-700 hover:bg-amber-100 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest border-amber-200">
                                    {selectedProduct.categoryName}
                                </Badge>
                                <h2 className="text-5xl font-black text-slate-900 tracking-tight">{selectedProduct.name}</h2>
                                <p className="text-slate-500 text-lg">{t.consumption_per_unit || "Consumption per unit produced"}</p>
                            </div>

                            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                                <div className="bg-slate-100/80 p-1.5 rounded-2xl mb-8 w-fit inline-flex shadow-inner">
                                    <TabsList className="bg-transparent h-10 gap-1">
                                        <TabsTrigger value="base" className="rounded-xl px-6 data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-amber-700 font-semibold transition-all">
                                            {t.base_recipe || "Base Recipe"}
                                        </TabsTrigger>
                                        {selectedProduct.variations.map(v => (
                                            v.sizes.map(s => (
                                                <TabsTrigger key={s.id} value={s.id} className="rounded-xl px-6 data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-amber-700 font-semibold transition-all">
                                                    {v.type} - {s.size}
                                                </TabsTrigger>
                                            ))
                                        ))}
                                    </TabsList>
                                </div>

                                <TabsContent value="base" className="mt-0 focus-visible:outline-none">
                                    <RecipeSection 
                                        items={recipe.filter(r => !r.variationSizeId)} 
                                        scopeId={null} 
                                    />
                                </TabsContent>

                                {selectedProduct.variations.map(v => (
                                    v.sizes.map(s => (
                                        <TabsContent key={s.id} value={s.id} className="mt-0 focus-visible:outline-none">
                                            <RecipeSection 
                                                items={recipe.filter(r => r.variationSizeId === s.id)} 
                                                scopeId={s.id} 
                                            />
                                        </TabsContent>
                                    ))
                                ))}
                            </Tabs>

                            <Dialog open={isAddIngredientOpen} onOpenChange={setIsAddIngredientOpen}>
                                <DialogContent className="max-w-2xl rounded-[2rem] p-0 overflow-hidden border-none shadow-2xl">
                                    <DialogHeader className="p-8 pb-6 bg-amber-50/50 border-b border-amber-100">
                                        <div className="flex items-center gap-5">
                                            <div className="w-14 h-14 rounded-2xl bg-amber-600 flex items-center justify-center shadow-lg shadow-amber-200 animate-in zoom-in duration-300">
                                                <Plus className="w-7 h-7 text-white" />
                                            </div>
                                            <div>
                                                <DialogTitle className="text-3xl font-black text-slate-900 tracking-tight">
                                                    {t.add_ingredient}
                                                </DialogTitle>
                                                <div className="flex items-center gap-2 mt-1">
                                                    <Badge variant="outline" className="bg-amber-100/50 text-amber-700 border-amber-200 font-bold uppercase text-[10px] tracking-wider">
                                                        {getScopeName(targetSelection.startsWith('s:') ? targetSelection.replace('s:', '') : null)}
                                                    </Badge>
                                                    <span className="text-slate-400 font-medium text-sm">for {selectedProduct.name}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </DialogHeader>
                                    
                                    {/* The create form replaces the dialog's body rather than
                                        opening a second dialog on top of it. Modal-on-modal is
                                        where a touch till loses people; this is one surface that
                                        changes what it is showing, with a way back. */}
                                    {creatingIngredient ? (
                                    <div className="p-8 space-y-6 bg-white">
                                        <button
                                            type="button"
                                            onClick={() => setCreatingIngredient(false)}
                                            className="flex items-center gap-2 text-sm font-bold text-slate-400 hover:text-slate-900 transition-colors"
                                        >
                                            <ChevronLeft className="w-4 h-4" /> {t.back_to_search}
                                        </button>

                                        <div className="space-y-2">
                                            <Label className="text-xs font-black text-slate-400 uppercase tracking-widest">{t.name}</Label>
                                            <FormattedTextInput
                                                value={draft.name}
                                                onChange={(v: string) => setDraft({ ...draft, name: v })}
                                            />
                                        </div>

                                        <div className="space-y-2">
                                            <Label className="text-xs font-black text-slate-400 uppercase tracking-widest">{t.category}</Label>
                                            <select
                                                className="w-full h-14 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-600 focus:ring-4 focus:ring-amber-500/10 focus:border-amber-500"
                                                value={draft.categoryId}
                                                onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}
                                            >
                                                <option value="">—</option>
                                                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                                            </select>
                                        </div>

                                        {/* The same block the inventory page uses, so both places
                                            that create an ingredient teach one thing. */}
                                        <UnitFields
                                            value={{
                                                name: draft.name,
                                                measureType: draft.measureType,
                                                purchaseUnit: draft.purchaseUnit,
                                                purchaseMultiplier: draft.purchaseMultiplier,
                                                cost: draft.cost,
                                            }}
                                            onChange={(next) => setDraft({
                                                ...draft,
                                                measureType: next.measureType,
                                                purchaseUnit: next.purchaseUnit,
                                                purchaseMultiplier: next.purchaseMultiplier,
                                            })}
                                        />

                                        <div className="space-y-2">
                                            <Label className="text-xs font-black text-slate-400 uppercase tracking-widest">
                                                {t.cost_per_unit} {draft.purchaseUnit ? `/ ${draft.purchaseUnit}` : ""}
                                            </Label>
                                            <FormattedNumberInput
                                                allowDecimals
                                                value={draft.cost}
                                                onChange={(v: string) => setDraft({ ...draft, cost: v })}
                                            />
                                        </div>

                                        <Button
                                            className="w-full h-16 rounded-2xl bg-amber-600 hover:bg-amber-700 text-white font-black text-lg shadow-xl shadow-amber-600/20 transition-all active:scale-95"
                                            disabled={!draft.name || !draft.purchaseUnit || savingIngredient}
                                            onClick={handleCreateAndAdd}
                                        >
                                            {savingIngredient ? t.processing : t.create_and_add}
                                        </Button>
                                    </div>
                                    ) : (
                                    <div className="p-0 bg-white">
                                        {/* Search and Category Filter */}
                                        <div className="p-8 pb-4 space-y-4">
                                            <div className="flex gap-3">
                                                <div className="relative flex-1">
                                                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                                    <Input 
                                                        placeholder={t.search_ingredients || "Find ingredients..."}
                                                        className="pl-12 h-14 bg-slate-50 border-slate-200 rounded-2xl focus:ring-4 focus:ring-amber-500/10 focus:border-amber-500 text-lg transition-all"
                                                        value={ingredientSearch}
                                                        onChange={e => setIngredientSearch(e.target.value)}
                                                    />
                                                </div>
                                                <div className="w-56 group relative">
                                                    <select 
                                                        className="w-full h-14 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-600 appearance-none focus:ring-4 focus:ring-amber-500/10 focus:border-amber-500 transition-all cursor-pointer"
                                                        value={selectedCatId}
                                                        onChange={e => setSelectedCatId(e.target.value)}
                                                    >
                                                        <option value="ALL">📦 {t.all_categories || "All Items"}</option>
                                                        {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                                    </select>
                                                    <ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 rotate-90 pointer-events-none group-focus-within:text-amber-600" />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Ingredient Selection Grid */}
                                        <div className="px-8 pb-8">
                                            <div className="grid grid-cols-2 gap-3 max-h-[340px] overflow-y-auto p-4 bg-slate-50/50 rounded-3xl border-2 border-dashed border-slate-200 scrollbar-hide">
                                                {ingredients
                                                    .filter(i => (selectedCatId === "ALL" || i.categoryId === selectedCatId) && i.name.toLowerCase().includes(ingredientSearch.toLowerCase()))
                                                    .map(ing => (
                                                        <button
                                                            key={ing.id}
                                                            onClick={() => setNewRecipeItem(prev => ({ ...prev, ingredientId: ing.id }))}
                                                            className={`p-4 rounded-2xl border-2 text-left transition-all flex items-center gap-4 group/item ${
                                                                newRecipeItem.ingredientId === ing.id 
                                                                ? 'bg-amber-600 border-amber-600 text-white shadow-xl shadow-amber-200 scale-[1.02]' 
                                                                : 'bg-white border-slate-100 hover:border-amber-400 hover:bg-amber-50/50 hover:shadow-lg'
                                                            }`}
                                                        >
                                                            <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-black text-lg transition-transform group-hover/item:scale-110 ${newRecipeItem.ingredientId === ing.id ? 'bg-white/20 text-white' : 'bg-amber-50 text-amber-600'}`}>
                                                                {ing.name[0]}
                                                            </div>
                                                            <div className="overflow-hidden flex-1">
                                                                <p className="font-black truncate text-sm leading-tight uppercase tracking-tight">{ing.name}</p>
                                                                <p className={`text-[10px] uppercase font-black tracking-widest mt-0.5 ${newRecipeItem.ingredientId === ing.id ? 'text-amber-200' : 'text-slate-400'}`}>{ing.unit}</p>
                                                            </div>
                                                        </button>
                                                    ))
                                                }
                                                {ingredients.length === 0 && (
                                                    <div className="col-span-2 text-center py-12 space-y-2">
                                                        <Package className="w-12 h-12 text-slate-200 mx-auto" />
                                                        <p className="text-slate-400 font-bold">{t.no_ingredients_found || "No matching ingredients"}</p>
                                                    </div>
                                                )}
                                                {/* Always visible, not only on an empty search:
                                                    it has to be findable before someone gives up
                                                    and goes hunting for the inventory page. */}
                                                <button
                                                    type="button"
                                                    onClick={() => { setDraft(emptyDraft(ingredientSearch)); setCreatingIngredient(true) }}
                                                    className="col-span-2 h-14 rounded-2xl border-2 border-dashed border-slate-200 text-slate-500 font-bold hover:border-amber-500 hover:text-amber-700 hover:bg-amber-50/50 transition-colors flex items-center justify-center gap-2"
                                                >
                                                    <Plus className="w-4 h-4" /> {t.new_ingredient}
                                                </button>
                                            </div>
                                        </div>

                                        {/* Bottom Action Area */}
                                        <div className="p-8 pt-0 border-t bg-slate-50/30">
                                            <div className="flex items-center justify-between py-8">
                                                <div className="space-y-1">
                                                    <Label className="text-xs font-black text-slate-400 uppercase tracking-[2px]">{t.quantity_used}</Label>
                                                    <p className="text-sm font-bold text-slate-900">{t.dosage_per_serving}</p>
                                                </div>
                                                <div className="flex items-center gap-4">
                                                    <div className="relative group w-48">
                                                        <Input
                                                            type="number"
                                                            step="0.01"
                                                            placeholder="0.00"
                                                            className="h-16 px-6 bg-white border-2 border-slate-200 rounded-2xl focus:ring-8 focus:ring-amber-500/10 focus:border-amber-500 text-2xl font-black pr-20 transition-all text-center placeholder:text-slate-200 shadow-sm"
                                                            value={newRecipeItem.quantity || ''}
                                                            onChange={e => setNewRecipeItem({ ...newRecipeItem, quantity: parseFloat(e.target.value) || 0 })}
                                                        />
                                                        <span className="absolute right-6 top-1/2 -translate-y-1/2 font-black text-slate-300 pointer-events-none group-focus-within:text-amber-600 uppercase text-sm tracking-widest">
                                                            {ingredients.find(i => i.id === newRecipeItem.ingredientId)?.unit || '-'}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                            
                                            <DialogFooter className="gap-4 sm:gap-4 p-0 pb-8">
                                                <Button 
                                                    variant="ghost" 
                                                    className="rounded-2xl h-16 flex-1 hover:bg-slate-200 text-slate-500 font-bold text-lg" 
                                                    onClick={() => setIsAddIngredientOpen(false)}
                                                >
                                                    {t.cancel}
                                                </Button>
                                                <Button 
                                                    className="bg-amber-600 hover:bg-amber-700 text-white rounded-2xl shadow-2xl shadow-amber-600/30 flex-[1.5] h-16 font-black text-xl transition-all active:scale-95" 
                                                    onClick={handleAddIngredient} 
                                                    disabled={isLoading || !newRecipeItem.ingredientId || newRecipeItem.quantity <= 0}
                                                >
                                                    {isLoading ? t.processing : t.add_to_recipe}
                                                </Button>
                                            </DialogFooter>
                                        </div>
                                    </div>
                                    )}
                                </DialogContent>
                            </Dialog>
                        </div>
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-center h-full space-y-8 animate-in fade-in zoom-in duration-700">
                            <div className="w-32 h-32 rounded-[2.5rem] bg-amber-50 flex items-center justify-center shadow-inner group relative">
                                <div className="absolute inset-0 bg-amber-200/20 rounded-[2.5rem] animate-pulse" />
                                <Coffee className="w-16 h-16 text-amber-600 group-hover:scale-110 transition-transform relative z-10" />
                            </div>
                            <div className="space-y-3">
                                <h3 className="text-3xl font-black text-slate-900 tracking-tight">{t.select_product}</h3>
                                <p className="text-slate-400 max-w-[280px] mx-auto text-lg font-medium leading-relaxed italic">
                                    "{t.select_a_product_to_view_and_manage_its_recipe_structure || "Select a product to start building its masterpiece recipe."}"
                                </p>
                            </div>
                        </div>
                    )}
                </main>
            </div>
        </div>
    )
}


