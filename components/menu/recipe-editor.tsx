"use client"

import { useState, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Trash2, Plus, Package } from "lucide-react"
import { useTranslation } from "@/hooks/use-translation"
import { formatTHB } from "@/lib/currency"
import { recipeCost, pourCost, bandFor, verdictFor } from "@/lib/pour-cost"
import type { MeasureType } from "@/lib/units"

/**
 * What one serving takes off the shelf, edited beside the price that pays for
 * it.
 *
 * Lives in the menu item dialog rather than only on the recipe screen because a
 * recipe is not an afterthought of a menu item - an item without one sells,
 * takes money, and moves nothing. Creating the item and saying what it costs
 * are one job, and splitting them across two screens is what let items ship
 * with no recipe at all.
 *
 * Rows are held here and written by the caller on save: nothing is created if
 * the dialog is cancelled, and there is one Save button rather than a screen
 * where some edits commit instantly and others do not.
 *
 * Cost is computed in the browser from the same pure functions the API uses, so
 * the figure updates as the price is typed and works for an item that does not
 * exist yet.
 */

export type RecipeRow = {
    ingredientId: string
    /** In the ingredient's base unit. */
    quantity: number
}

export type EditorIngredient = {
    id: string
    name: string
    baseUnit: string
    measureType: MeasureType
    purchaseUnit: string
    purchaseMultiplier: number
    cost: number
}

export function RecipeEditor({
    value,
    onChange,
    ingredients,
    price,
    categoryName,
}: {
    value: RecipeRow[]
    onChange: (rows: RecipeRow[]) => void
    ingredients: EditorIngredient[]
    /** The item's selling price, for the margin readout. */
    price: number
    categoryName?: string
}) {
    const { t } = useTranslation()
    const [pickId, setPickId] = useState("")
    const [pickQty, setPickQty] = useState("")

    const byId = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients])
    const picked = pickId ? byId.get(pickId) : undefined

    const lines = value
        .map((r) => ({ row: r, ing: byId.get(r.ingredientId) }))
        .filter((l): l is { row: RecipeRow; ing: EditorIngredient } => !!l.ing)

    const costOf = (row: RecipeRow, ing: EditorIngredient) =>
        recipeCost([{
            quantity: row.quantity,
            costPerPurchaseUnit: ing.cost,
            purchaseMultiplier: ing.purchaseMultiplier,
        }])

    const total = recipeCost(lines.map(({ row, ing }) => ({
        quantity: row.quantity,
        costPerPurchaseUnit: ing.cost,
        purchaseMultiplier: ing.purchaseMultiplier,
    })))
    const pct = pourCost(total, price)
    const verdict = verdictFor(categoryName, pct)

    const add = () => {
        const qty = parseFloat(pickQty)
        if (!pickId || !Number.isFinite(qty) || qty <= 0) return
        // Adding an ingredient twice is one line with more in it, not two lines
        // that each look complete.
        const existing = value.find((r) => r.ingredientId === pickId)
        onChange(existing
            ? value.map((r) => r.ingredientId === pickId ? { ...r, quantity: r.quantity + qty } : r)
            : [...value, { ingredientId: pickId, quantity: qty }])
        setPickId("")
        setPickQty("")
    }

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <Label className="text-xs font-black text-slate-400 uppercase tracking-widest">
                    {t.recipe_section}
                </Label>
                <span className="text-xs text-slate-400">{t.recipe_section_hint}</span>
            </div>

            {/* Rows and the control that adds them live in one bordered card,
                so "add" reads as part of the recipe rather than as a button
                floating just above the dialog's Save - which is a different
                kind of action entirely and sat one thumb-width away. */}
            <div className="rounded-2xl border border-slate-200 overflow-hidden">
                {lines.length > 0 ? (
                    <div className="divide-y divide-slate-100">
                    {lines.map(({ row, ing }) => (
                        <div key={row.ingredientId} className="flex items-center gap-3 px-3 py-2">
                            <span className="flex-1 font-semibold text-slate-900 truncate">{ing.name}</span>
                            <span className="text-sm text-slate-500 tabular-nums shrink-0">
                                {row.quantity} {ing.baseUnit}
                            </span>
                            <span className="text-sm text-slate-400 tabular-nums w-20 text-right shrink-0">
                                {formatTHB(costOf(row, ing))}
                            </span>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                title={t.delete}
                                className="h-9 w-9 shrink-0 text-slate-300 hover:text-rose-600 hover:bg-rose-50"
                                onClick={() => onChange(value.filter((r) => r.ingredientId !== row.ingredientId))}
                            >
                                <Trash2 className="w-4 h-4" />
                            </Button>
                        </div>
                    ))}
                    </div>
                ) : (
                    <div className="px-4 py-6 flex items-center gap-3 text-slate-400 border-b border-slate-100">
                        <Package className="w-5 h-5 shrink-0" />
                        <p className="text-sm">{t.no_recipe_yet}</p>
                    </div>
                )}

            {/* Inline, not a nested dialog: this already lives inside the menu
                item dialog, and a modal on a modal is where a touch till loses
                people. A plain select is the right control for two dozen
                ingredients. */}
            <div className="flex gap-2 p-2 bg-slate-50/70">
                <select
                    value={pickId}
                    onChange={(e) => setPickId(e.target.value)}
                    className="flex-1 h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700 focus:ring-4 focus:ring-amber-500/10 focus:border-amber-500"
                >
                    <option value="">{t.select_ingredient}</option>
                    {ingredients.map((i) => (
                        <option key={i.id} value={i.id}>{i.name}</option>
                    ))}
                </select>
                <div className="relative w-36">
                    <input
                        type="number"
                        step="any"
                        min="0"
                        value={pickQty}
                        onChange={(e) => setPickQty(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add() } }}
                        placeholder="0"
                        disabled={!picked}
                        className="w-full h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 pr-12 text-sm tabular-nums focus:ring-4 focus:ring-amber-500/10 focus:border-amber-500 disabled:opacity-50"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-black uppercase tracking-widest text-slate-300 pointer-events-none">
                        {picked?.baseUnit ?? ""}
                    </span>
                </div>
                {/* Deliberately NOT amber. Amber is this dialog's commit
                    colour, and Save sits directly below - two amber buttons a
                    thumb-width apart, one of which closes the dialog, is a
                    misclick waiting to happen on a till. */}
                <Button
                    type="button"
                    variant="outline"
                    className="h-11 px-4 rounded-xl border-slate-300 text-slate-600 hover:bg-white hover:text-slate-900 font-bold shrink-0"
                    disabled={!pickId || !(parseFloat(pickQty) > 0)}
                    onClick={add}
                >
                    <Plus className="w-4 h-4 mr-1" /> {t.add}
                </Button>
                </div>
            </div>

            {/* The number the price should be set against. Without it a price is
                a guess that gets checked at stocktake. */}
            {lines.length > 0 && (
                <div className="flex items-center gap-4 flex-wrap px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm">
                    <span className="text-slate-600">
                        {t.recipe_cost} <strong className="text-slate-900 tabular-nums">{formatTHB(total)}</strong>
                    </span>
                    <span className="text-slate-300" aria-hidden>·</span>
                    <span className="text-slate-600">
                        {t.recipe_margin}{" "}
                        <strong className="text-slate-900 tabular-nums">{formatTHB(Math.round((price - total) * 100) / 100)}</strong>
                    </span>
                    {price > 0 && (
                        <span
                            className={`ms-auto font-bold tabular-nums px-2.5 py-1 rounded-lg ${
                                verdict === "BELOW_COST" ? "bg-rose-50 text-rose-700"
                                    : verdict === "OK" ? "bg-emerald-50 text-emerald-700"
                                        : "bg-amber-50 text-amber-800"
                            }`}
                        >
                            {t.pour_cost} {pct}%
                            <span className="font-semibold opacity-70">
                                {" · "}
                                {verdict === "BELOW_COST" ? t.verdict_below_cost
                                    : verdict === "HIGH" ? t.verdict_high
                                        : verdict === "LOW" ? t.verdict_low
                                            : t.verdict_ok}
                            </span>
                        </span>
                    )}
                </div>
            )}
        </div>
    )
}
