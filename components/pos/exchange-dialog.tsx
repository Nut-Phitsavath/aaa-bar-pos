"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "@/hooks/use-translation"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Minus, Plus, Search, ArrowRight } from "lucide-react"
import { toast } from "sonner"
import { formatTHB } from "@/lib/currency"
import { chargeFor, valueOf, type Component } from "@/lib/packages"

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
    const [pkg, setPkg] = useState<{ name: string; remaining: Component[] } | null>(null)
    const [menu, setMenu] = useState<MenuItem[]>([])
    const [out, setOut] = useState<Record<string, number>>({})
    const [inn, setInn] = useState<Record<string, number>>({})
    const [query, setQuery] = useState("")
    const [busy, setBusy] = useState(false)

    const load = useCallback(async () => {
        if (!itemId) return
        const res = await fetch(`/api/order-items/${itemId}/swap`)
        if (res.ok) {
            const data = await res.json()
            setPkg({ name: data.name, remaining: data.remaining ?? [] })
        }
    }, [itemId])

    useEffect(() => {
        if (!itemId) return
        setOut({}); setInn({}); setQuery("")
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

    const outLines = useMemo(
        () => (pkg?.remaining ?? [])
            .filter((c) => (out[c.menuId] ?? 0) > 0)
            .map((c) => ({ unitPrice: c.unitPrice, quantity: out[c.menuId] })),
        [pkg, out],
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

    const step = (set: typeof setOut, key: string, delta: number, max?: number) =>
        set((prev) => {
            const next = Math.max(0, (prev[key] ?? 0) + delta)
            if (max !== undefined && next > max) return prev
            return { ...prev, [key]: next }
        })

    const submit = async () => {
        if (!itemId || !touched) return
        setBusy(true)
        try {
            const res = await fetch(`/api/order-items/${itemId}/swap`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    removing: Object.entries(out).filter(([, q]) => q > 0).map(([menuId, quantity]) => ({ menuId, quantity })),
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
                    {/* Out: only what this package still holds. */}
                    <div className="rounded-xl border border-slate-200 overflow-hidden">
                        <p className="px-3 py-2 bg-slate-50 border-b text-xs font-bold uppercase tracking-widest text-slate-500">
                            {t.exchange_out}
                        </p>
                        <div className="max-h-72 overflow-y-auto">
                            {(pkg?.remaining ?? []).length === 0 ? (
                                <p className="px-3 py-8 text-center text-sm text-slate-500">{t.exchange_nothing_left}</p>
                            ) : (
                                pkg!.remaining.map((c) => (
                                    <div key={c.menuId} className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 last:border-0">
                                        <div className="min-w-0 flex-1">
                                            <p className="font-bold text-slate-900 truncate">{c.localName || c.name}</p>
                                            <p className="text-xs text-slate-500 tabular-nums">
                                                {formatTHB(c.unitPrice)} · {t.in_package} {c.quantity}
                                            </p>
                                        </div>
                                        <Button variant="outline" size="icon" className="h-9 w-9 shrink-0"
                                            aria-label={`${t.remove} ${c.name}`}
                                            onClick={() => step(setOut, c.menuId, -1)}>
                                            <Minus className="w-4 h-4" />
                                        </Button>
                                        <span className="w-6 text-center font-black tabular-nums">{out[c.menuId] ?? 0}</span>
                                        <Button variant="outline" size="icon" className="h-9 w-9 shrink-0"
                                            aria-label={`${t.add} ${c.name}`}
                                            onClick={() => step(setOut, c.menuId, 1, c.quantity)}>
                                            <Plus className="w-4 h-4" />
                                        </Button>
                                    </div>
                                ))
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
