"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "@/hooks/use-translation"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Minus, Plus, Search, ArrowRight, Undo2 } from "lucide-react"
import { toast } from "sonner"
import { formatTHB } from "@/lib/currency"
import { chargeFor, valueOf, type Component } from "@/lib/packages"

type PastSwap = {
    id: string
    charged: number
    reversedAt: string | null
    lines: { direction: string; name: string; quantity: number }[]
}

type MenuItem = {
    id: string
    name: string
    localName?: string | null
    category?: string | null
    variationSizeId: string
    price: number
}

/**
 * Swapping what a package delivers (req #8).
 *
 * Two columns, because the swap is a comparison: what the package still holds
 * on the left, the menu on the right, and the money between them. The charge is
 * on screen before anyone commits - a staff member should never find out what
 * the customer owes by pressing the button that charges them.
 *
 * The left column is capped at what the package actually contains, which is the
 * whole safeguard on a screen with no manager PIN: a set holding two Heinekens
 * can give up two, never three.
 */
export function ExchangeDialog({
    itemId,
    onClose,
    onDone,
}: {
    itemId: string | null
    onClose: () => void
    onDone: () => void
}) {
    const { t } = useTranslation()
    const [pkg, setPkg] = useState<{ name: string; remaining: Component[]; swaps: PastSwap[] } | null>(null)
    const [menu, setMenu] = useState<MenuItem[]>([])
    // How many of each component stay in the package. Counts down from what it
    // holds; the difference is what is being taken out.
    const [keep, setKeep] = useState<Record<string, number>>({})
    const [inn, setInn] = useState<Record<string, number>>({})
    const [query, setQuery] = useState("")
    const [busy, setBusy] = useState(false)

    const load = useCallback(async () => {
        if (!itemId) return
        const res = await fetch(`/api/order-items/${itemId}/swap`)
        if (res.ok) {
            const data = await res.json()
            const remaining: Component[] = data.remaining ?? []
            setPkg({ name: data.name, remaining, swaps: data.swaps ?? [] })
            // The left column starts at what the set holds and counts DOWN.
            // Staff are editing what the package delivers - "two Beer Lao,
            // make it one" - not composing a list of things to subtract, and
            // a column of zeroes beside "in package: 5" asked them to do the
            // arithmetic themselves.
            setKeep(Object.fromEntries(remaining.map((c) => [c.menuId, c.quantity])))
        }
    }, [itemId])

    /**
     * A swap cannot be un-swapped: what it added never becomes part of the
     * package, so a second exchange can never take it back. Undo is the only
     * way back from the wrong drink tapped at 1am.
     */
    const undo = async (swapId: string) => {
        setBusy(true)
        try {
            const res = await fetch(`/api/package-swaps/${swapId}/reverse`, { method: "POST" })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) { toast.error(errorText(data.error)); return }
            toast.success(t.exchange_reversed)
            setInn({})
            await load()
            onDone()
        } finally { setBusy(false) }
    }

    useEffect(() => {
        if (!itemId) return
        setInn({}); setQuery("")
        load()
        fetch("/api/menu")
            .then((r) => (r.ok ? r.json() : []))
            .then((rows: any[]) => {
                // One row per sellable size: what a swap adds is a priced item,
                // not a menu heading.
                const flat: MenuItem[] = []
                for (const m of Array.isArray(rows) ? rows : []) {
                    for (const v of m.variations ?? []) {
                        for (const s of v.sizes ?? []) {
                            flat.push({
                                id: `${m.id}:${s.id}`,
                                name: m.name,
                                localName: m.localName,
                                category: m.category?.name ?? null,
                                variationSizeId: s.id,
                                price: s.price,
                            })
                            break
                        }
                        break
                    }
                }
                setMenu(flat)
            })
            .catch(() => setMenu([]))
    }, [itemId, load])

    /** What is leaving: the gap between what the set holds and what is kept. */
    const outLines = useMemo(
        () => (pkg?.remaining ?? [])
            .map((c) => ({ ...c, taken: c.quantity - (keep[c.menuId] ?? c.quantity) }))
            .filter((c) => c.taken > 0)
            .map((c) => ({ menuId: c.menuId, unitPrice: c.unitPrice, quantity: c.taken })),
        [pkg, keep],
    )
    const inLines = useMemo(
        () => menu
            .filter((m) => (inn[m.variationSizeId] ?? 0) > 0)
            .map((m) => ({ unitPrice: m.price, quantity: inn[m.variationSizeId] })),
        [menu, inn],
    )

    const outValue = valueOf(outLines)
    const inValue = valueOf(inLines)
    const charge = chargeFor(outValue, inValue)
    const touched = outLines.length > 0 || inLines.length > 0

    const step = (set: typeof setInn, key: string, delta: number, max?: number) =>
        set((prev) => {
            const next = Math.max(0, (prev[key] ?? 0) + delta)
            if (max !== undefined && next > max) return prev
            return { ...prev, [key]: next }
        })

    /** The left column: never below zero, never above what the set holds. */
    const stepKeep = (menuId: string, held: number, delta: number) =>
        setKeep((prev) => {
            const current = prev[menuId] ?? held
            const next = Math.min(held, Math.max(0, current + delta))
            return { ...prev, [menuId]: next }
        })

    const submit = async () => {
        if (!itemId || !touched) return
        setBusy(true)
        try {
            const res = await fetch(`/api/order-items/${itemId}/swap`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    removing: outLines.map((l) => ({ menuId: l.menuId, quantity: l.quantity })),
                    adding: Object.entries(inn).filter(([, q]) => q > 0).map(([variationSizeId, quantity]) => ({ variationSizeId, quantity })),
                }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) {
                toast.error(errorText(data.error))
                return
            }
            toast.success(data.charged > 0 ? `${t.exchange_done} · ${formatTHB(data.charged)}` : t.exchange_done)
            onDone()
            onClose()
        } finally { setBusy(false) }
    }

    const errorText = (code: string) =>
        code === "MORE_THAN_PACKAGE_HOLDS" ? t.exchange_more_than_held
            : code === "NOT_IN_PACKAGE" ? t.exchange_not_in_package
                : code === "SESSION_ALREADY_CLOSED" ? t.session_already_closed
                    : code === "NO_OPEN_SHIFT" ? t.no_open_shift_exchange
                        : t.save_failed

    const visible = query
        ? menu.filter((m) =>
            m.name.toLowerCase().includes(query.toLowerCase()) ||
            (m.localName ?? "").includes(query))
        : menu

    return (
        <Dialog open={!!itemId} onOpenChange={(o) => { if (!o) onClose() }}>
            <DialogContent className="sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>{t.exchange_items}{pkg ? ` · ${pkg.name}` : ""}</DialogTitle>
                </DialogHeader>

                <div className="grid md:grid-cols-2 gap-4">
                    {/* What the set delivers, edited in place. The number is how
                        many the customer still gets, so taking one out is one
                        press of minus and reads the way it was asked for. */}
                    <div className="rounded-xl border border-slate-200 overflow-hidden">
                        <p className="px-3 py-2 bg-slate-50 border-b text-xs font-bold uppercase tracking-widest text-slate-500">
                            {t.in_package}
                        </p>
                        <div className="max-h-72 overflow-y-auto">
                            {(pkg?.remaining ?? []).length === 0 ? (
                                <p className="px-3 py-8 text-center text-sm text-slate-500">{t.exchange_nothing_left}</p>
                            ) : (
                                pkg!.remaining.map((c) => {
                                    const kept = keep[c.menuId] ?? c.quantity
                                    const taken = c.quantity - kept
                                    return (
                                    <div key={c.menuId} className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 last:border-0">
                                        <div className="min-w-0 flex-1">
                                            <p className="font-bold text-slate-900 truncate">{c.localName || c.name}</p>
                                            {/* What the set holds, and what it
                                                would hold after this edit. The
                                                big number is the new figure, so
                                                without the original beside it a
                                                staff member cannot tell whether
                                                a 1 means "one left" or "one
                                                taken". */}
                                            <p className="text-xs text-slate-500 tabular-nums">
                                                {formatTHB(c.unitPrice)} · {t.set_qty} {c.quantity}
                                                {taken > 0 && (
                                                    <span className="text-rose-600 font-bold"> → {kept} (−{taken})</span>
                                                )}
                                            </p>
                                        </div>
                                        <Button variant="outline" size="icon" className="h-9 w-9 shrink-0"
                                            aria-label={`${t.exchange_out} ${c.name}`}
                                            disabled={kept === 0}
                                            onClick={() => stepKeep(c.menuId, c.quantity, -1)}>
                                            <Minus className="w-4 h-4" />
                                        </Button>
                                        <span className={`w-6 text-center font-black tabular-nums ${taken > 0 ? "text-rose-600" : "text-slate-900"}`}>
                                            {kept}
                                        </span>
                                        <Button variant="outline" size="icon" className="h-9 w-9 shrink-0"
                                            aria-label={`${t.put_back} ${c.name}`}
                                            disabled={kept === c.quantity}
                                            onClick={() => stepKeep(c.menuId, c.quantity, 1)}>
                                            <Plus className="w-4 h-4" />
                                        </Button>
                                    </div>
                                    )
                                })
                            )}
                        </div>
                    </div>

                    {/* In: anything on the menu. */}
                    <div className="rounded-xl border border-slate-200 overflow-hidden">
                        <p className="px-3 py-2 bg-slate-50 border-b text-xs font-bold uppercase tracking-widest text-slate-500">
                            {t.exchange_in}
                        </p>
                        <div className="p-2 border-b">
                            <div className="relative">
                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                <Input
                                    className="pl-8 h-10"
                                    placeholder={t.search_menu}
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                />
                            </div>
                        </div>
                        <div className="max-h-60 overflow-y-auto">
                            {visible.map((m) => (
                                <div key={m.variationSizeId} className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 last:border-0">
                                    <div className="min-w-0 flex-1">
                                        <p className="font-bold text-slate-900 truncate">{m.localName || m.name}</p>
                                        <p className="text-xs text-slate-500 tabular-nums">{formatTHB(m.price)}</p>
                                    </div>
                                    <Button variant="outline" size="icon" className="h-9 w-9 shrink-0"
                                        aria-label={`${t.remove} ${m.name}`}
                                        onClick={() => step(setInn, m.variationSizeId, -1)}>
                                        <Minus className="w-4 h-4" />
                                    </Button>
                                    <span className="w-6 text-center font-black tabular-nums">{inn[m.variationSizeId] ?? 0}</span>
                                    <Button variant="outline" size="icon" className="h-9 w-9 shrink-0"
                                        aria-label={`${t.add} ${m.name}`}
                                        onClick={() => step(setInn, m.variationSizeId, 1)}>
                                        <Plus className="w-4 h-4" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* What has already been traded on this package, and the only
                    way back from a mistake. A reversed one stays listed, struck
                    through: the audit keeps it, the bill does not. */}
                {(pkg?.swaps ?? []).length > 0 && (
                    <div className="rounded-xl border border-slate-200 divide-y">
                        {pkg!.swaps.map((s) => {
                            const gone = Boolean(s.reversedAt)
                            const text = (dir: string) => s.lines
                                .filter((l) => l.direction === dir)
                                .map((l) => `${l.quantity} × ${l.name}`).join(", ")
                            return (
                                <div key={s.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                                    <span className={`min-w-0 flex-1 ${gone ? "line-through text-slate-400" : "text-slate-700"}`}>
                                        <span className="text-rose-600">− {text("OUT") || "—"}</span>
                                        {"  "}
                                        <span className="text-emerald-700">+ {text("IN") || "—"}</span>
                                        {s.charged > 0 && (
                                            <strong className="ms-2 tabular-nums text-slate-900">{formatTHB(s.charged)}</strong>
                                        )}
                                    </span>
                                    {gone ? (
                                        <span className="text-xs font-bold text-slate-400 shrink-0">{t.exchange_reversed}</span>
                                    ) : (
                                        <Button
                                            variant="outline" size="sm" className="h-9 shrink-0"
                                            onClick={() => undo(s.id)}
                                            disabled={busy}
                                        >
                                            <Undo2 className="w-4 h-4 mr-1.5" />
                                            {t.undo}
                                        </Button>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                )}

                {/* The money, before the button that takes it. */}
                <div className="flex items-center gap-3 flex-wrap rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
                    <span className="tabular-nums text-slate-600">
                        {t.exchange_out} <strong className="text-slate-900">{formatTHB(outValue)}</strong>
                    </span>
                    <ArrowRight className="w-4 h-4 text-slate-400" />
                    <span className="tabular-nums text-slate-600">
                        {t.exchange_in} <strong className="text-slate-900">{formatTHB(inValue)}</strong>
                    </span>
                    <span className={`ms-auto font-black tabular-nums ${charge > 0 ? "text-amber-700" : "text-emerald-700"}`}>
                        {charge > 0 ? `${t.exchange_charge} ${formatTHB(charge)}` : t.exchange_no_charge}
                    </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" className="h-12" onClick={onClose} disabled={busy}>{t.cancel}</Button>
                    <Button
                        className="h-12 bg-amber-600 hover:bg-amber-700 font-bold"
                        onClick={submit}
                        disabled={busy || !touched}
                    >
                        {busy ? t.processing : t.confirm}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
