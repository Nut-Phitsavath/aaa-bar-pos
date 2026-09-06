"use client"

import { useEffect, useState } from "react"
import { Reorder, useDragControls } from "motion/react"
import { Button } from "@/components/ui/button"
import { GripVertical, Check } from "lucide-react"
import { toast } from "sonner"
import { useTranslation } from "@/hooks/use-translation"
import { formatTHB } from "@/lib/currency"

type Category = { id: string; name: string }
type Item = { id: string; name: string; localName?: string | null; price?: number; category: string }

/**
 * Rearranging the till.
 *
 * Two single-axis lists rather than dragging inside the six-column grid the
 * menu page normally shows. Motion's Reorder resolves positions along one axis,
 * and in a wrapping grid the drop target under your thumb stops matching the
 * gap that opens up - on a touchscreen that reads as the card refusing to land
 * where you put it.
 *
 * Saving happens on drop, not behind a Save button. The arrangement IS the
 * state; asking someone to confirm a list they can already see is a step that
 * only exists to be forgotten.
 */
export function ReorderPanel({
    categories,
    items,
    activeCategory,
    onDone,
    onSaved,
}: {
    categories: Category[]
    items: Item[]
    activeCategory: string | null
    onDone: () => void
    onSaved: () => void
}) {
    const { t } = useTranslation()
    const [cats, setCats] = useState(categories)
    const [rows, setRows] = useState(items)
    const [busy, setBusy] = useState(false)

    useEffect(() => { setCats(categories) }, [categories])
    useEffect(() => { setRows(items) }, [items])

    const save = async (kind: "CATEGORY" | "MENU", ids: string[]) => {
        setBusy(true)
        try {
            const res = await fetch("/api/menu/order", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ kind, ids }),
            })
            if (!res.ok) { toast.error(t.save_failed); return }
            onSaved()
        } finally { setBusy(false) }
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3 flex-wrap rounded-xl border-2 border-amber-200 bg-amber-50 px-4 py-3">
                <GripVertical className="w-5 h-5 text-amber-700 shrink-0" />
                <p className="font-bold text-amber-900">{t.reorder_mode}</p>
                <p className="text-sm text-amber-800 min-w-0">{t.reorder_hint}</p>
                <Button className="ms-auto h-11 bg-slate-900 hover:bg-slate-800 font-bold" onClick={onDone} disabled={busy}>
                    <Check className="w-4 h-4 mr-2" />
                    {t.done}
                </Button>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
                <section>
                    <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">
                        {t.categories}
                    </h2>
                    <Reorder.Group
                        axis="y"
                        values={cats}
                        onReorder={(next) => { setCats(next); save("CATEGORY", next.map((c) => c.id)) }}
                        className="rounded-xl border border-slate-200 bg-white overflow-hidden"
                    >
                        {cats.map((c) => (
                            <SortableRow key={c.id} value={c} title={c.name} />
                        ))}
                    </Reorder.Group>
                </section>

                <section>
                    <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">
                        {activeCategory ?? t.all_categories}
                    </h2>
                    {rows.length === 0 ? (
                        <p className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
                            {t.no_items_here}
                        </p>
                    ) : (
                        <Reorder.Group
                            axis="y"
                            values={rows}
                            onReorder={(next) => { setRows(next); save("MENU", next.map((i) => i.id)) }}
                            className="rounded-xl border border-slate-200 bg-white overflow-hidden max-h-[32rem] overflow-y-auto"
                        >
                            {rows.map((i) => (
                                <SortableRow
                                    key={i.id}
                                    value={i}
                                    title={i.localName || i.name}
                                    subtitle={i.localName ? i.name : undefined}
                                    trailing={i.price !== undefined ? formatTHB(i.price) : undefined}
                                />
                            ))}
                        </Reorder.Group>
                    )}
                </section>
            </div>
        </div>
    )
}

/**
 * One draggable row.
 *
 * dragListener is off and the gesture starts from the handle, so a stray swipe
 * across the list scrolls it instead of dragging a row out of place - the
 * difference between a list you can use one-handed at 1am and one you fight.
 */
function SortableRow<T>({
    value,
    title,
    subtitle,
    trailing,
}: {
    value: T
    title: string
    subtitle?: string
    trailing?: string
}) {
    const controls = useDragControls()

    return (
        <Reorder.Item
            value={value}
            dragListener={false}
            dragControls={controls}
            // Lifts out of the list while held, so it is obvious which row is
            // travelling. 180ms: state, not choreography.
            whileDrag={{ scale: 1.02, boxShadow: "0 12px 24px rgb(15 23 42 / 0.18)", zIndex: 10 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="flex items-center gap-3 px-3 py-2.5 border-b border-slate-100 last:border-0 bg-white"
        >
            <button
                onPointerDown={(e) => controls.start(e)}
                aria-label={title}
                // touch-none stops the browser claiming the gesture as a scroll
                // before Motion ever sees it.
                className="h-11 w-11 grid place-items-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 touch-none cursor-grab active:cursor-grabbing shrink-0"
            >
                <GripVertical className="w-5 h-5" />
            </button>
            <div className="min-w-0 flex-1">
                <p className="font-bold text-slate-900 truncate">{title}</p>
                {subtitle && <p className="text-xs text-slate-500 truncate">{subtitle}</p>}
            </div>
            {trailing && <span className="tabular-nums text-slate-600 shrink-0">{trailing}</span>}
        </Reorder.Item>
    )
}
