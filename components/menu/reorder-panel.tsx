"use client"

import { useEffect, useRef, useState } from "react"
import { Reorder, useDragControls } from "motion/react"
import { Button } from "@/components/ui/button"
import { GripVertical, Check } from "lucide-react"
import { useTranslation } from "@/hooks/use-translation"
import { formatTHB } from "@/lib/currency"
import { toast } from "sonner"
import { moveInList } from "@/lib/floor-order"
import { useDragLift } from "@/hooks/use-drag-lift"

type Category = { id: string; name: string }
type Item = { id: string; name: string; localName?: string | null; price?: number }

/** How close to an edge the pointer gets before the list starts moving itself. */
const EDGE_PX = 64
/** Pixels per frame at the very edge. Eased by how deep into the zone you are. */
const SCROLL_MAX = 18

/**
 * Reordering the menu: categories on the left, the items of one on the right.
 *
 * Opened as a mode rather than a screen, over the same board the menu page
 * normally shows. Motion's Reorder resolves positions along one axis, which is
 * why each list is its own group.
 *
 * Nothing is written until a row is let go. The first version saved on every
 * SWAP - Reorder.Group calls onReorder each time two rows cross, not once on
 * drop - and each save called back to the parent, which refetched and replaced
 * the array mid-gesture. That is why a drop landed somewhere other than where
 * it was aimed, and why the lift shadow could stay behind: the row being
 * dragged was unmounted under the pointer and a new one took its place, so
 * Motion never ran the gesture's own cleanup.
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

    // What the server last confirmed, so a drop that lands where it started
    // writes nothing at all.
    const savedCats = useRef(categories.map((c) => c.id).join())
    const savedRows = useRef(items.map((i) => i.id).join())

    // True from pointer-down to pointer-up. While it is set, incoming props are
    // ignored: a refresh landing mid-drag is what used to move the row out from
    // under the finger holding it.
    const dragging = useRef(false)

    const scroller = useRef<HTMLUListElement | null>(null)
    const autoScroll = useRef<number | null>(null)

    useEffect(() => {
        if (dragging.current) return
        setCats(categories)
        savedCats.current = categories.map((c) => c.id).join()
    }, [categories])

    useEffect(() => {
        if (dragging.current) return
        setRows(items)
        savedRows.current = items.map((i) => i.id).join()
    }, [items])

    /** Stop the list moving itself. Safe to call when it never started. */
    const stopAutoScroll = () => {
        if (autoScroll.current !== null) {
            cancelAnimationFrame(autoScroll.current)
            autoScroll.current = null
        }
    }

    useEffect(() => stopAutoScroll, [])

    /**
     * Drag the row near the top or bottom edge and the list scrolls itself.
     *
     * Without this, reaching the top of a long list meant holding the row with
     * one hand and spinning the wheel with the other - and scrolling by hand
     * mid-drag is exactly what made the drop land in the wrong place, because
     * the group's measured positions were taken before the scroll happened.
     * `layoutScroll` on the group fixes the measuring; this removes the reason
     * to scroll by hand at all.
     *
     * Speed eases with depth into the zone, so the list creeps near the edge
     * and only races when the pointer is hard against it.
     */
    const edgeScroll = (clientY: number) => {
        const box = scroller.current
        if (!box) return
        const rect = box.getBoundingClientRect()

        const above = clientY - rect.top
        const below = rect.bottom - clientY
        let speed = 0
        if (above < EDGE_PX) speed = -SCROLL_MAX * (1 - Math.max(0, above) / EDGE_PX)
        else if (below < EDGE_PX) speed = SCROLL_MAX * (1 - Math.max(0, below) / EDGE_PX)

        if (speed === 0) { stopAutoScroll(); return }
        if (autoScroll.current !== null) return

        const step = () => {
            const el = scroller.current
            if (!el || !dragging.current) { stopAutoScroll(); return }
            el.scrollTop += speed
            autoScroll.current = requestAnimationFrame(step)
        }
        autoScroll.current = requestAnimationFrame(step)
    }

    const save = async (kind: "CATEGORY" | "MENU", ids: string[]) => {
        const ref = kind === "CATEGORY" ? savedCats : savedRows
        const key = ids.join()
        if (key === ref.current) return

        setBusy(true)
        try {
            const res = await fetch("/api/menu/order", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ kind, ids }),
            })
            if (!res.ok) { toast.error(t.save_failed); return }
            ref.current = key
            // Deliberately NOT calling onSaved() here. The parent refetches on
            // it, and a refetch is what used to replace the list under the
            // gesture. The till reads this order from the server when it next
            // loads; the board on screen is already right.
        } finally { setBusy(false) }
    }

    const beginDrag = () => { dragging.current = true }
    const endDrag = (kind: "CATEGORY" | "MENU") => {
        dragging.current = false
        stopAutoScroll()
        save(kind, kind === "CATEGORY" ? cats.map((c) => c.id) : rows.map((i) => i.id))
    }

    /** Moving by keyboard: a finished action, so it saves straight away. */
    const moveCat = (from: number, to: number) => {
        const next = moveInList(cats, from, to)
        if (next === cats) return
        setCats(next)
        save("CATEGORY", next.map((c) => c.id))
    }
    const moveRow = (from: number, to: number) => {
        const next = moveInList(rows, from, to)
        if (next === rows) return
        setRows(next)
        save("MENU", next.map((i) => i.id))
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3 flex-wrap rounded-xl border-2 border-amber-200 bg-amber-50 px-4 py-3">
                <GripVertical className="w-5 h-5 text-amber-700 shrink-0" />
                <p className="font-bold text-amber-900">{t.reorder_mode}</p>
                <p className="text-sm text-amber-800 min-w-0">{t.reorder_hint}</p>
                <Button
                    className="ms-auto h-11 bg-slate-900 hover:bg-slate-800 font-bold"
                    // The till picks the new order up on its next load; this
                    // tells the page to refresh now that no gesture is running.
                    onClick={() => { onSaved(); onDone() }}
                    disabled={busy}
                >
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
                        onReorder={setCats}
                        className="rounded-xl border border-slate-200 bg-white overflow-hidden"
                    >
                        {cats.map((c, i) => (
                            <SortableRow
                                key={c.id}
                                value={c}
                                title={c.name}
                                index={i}
                                count={cats.length}
                                onDragStart={beginDrag}
                                onDragEnd={() => endDrag("CATEGORY")}
                                onMove={(to) => moveCat(i, to)}
                            />
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
                            onReorder={setRows}
                            ref={scroller}
                            // Tells Motion to re-measure as this box scrolls.
                            // Without it every position it knows is the one from
                            // before the scroll, and the drop resolves against
                            // rows that are no longer where it thinks.
                            layoutScroll
                            className="rounded-xl border border-slate-200 bg-white overflow-hidden max-h-[32rem] overflow-y-auto"
                        >
                            {rows.map((item, i) => (
                                <SortableRow
                                    key={item.id}
                                    value={item}
                                    title={item.localName || item.name}
                                    subtitle={item.localName ? item.name : undefined}
                                    trailing={item.price !== undefined ? formatTHB(item.price) : undefined}
                                    index={i}
                                    count={rows.length}
                                    onDragStart={beginDrag}
                                    onDragEnd={() => endDrag("MENU")}
                                    onDragMove={edgeScroll}
                                    onMove={(to) => moveRow(i, to)}
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
 *
 * The handle also takes arrow keys, Home and End. That is the only way a
 * keyboard reaches this at all, and for the move people actually struggle with
 * - a row from the bottom to the top - one key press beats any drag.
 */
function SortableRow<T>({
    value,
    title,
    subtitle,
    trailing,
    index,
    count,
    onDragStart,
    onDragEnd,
    onDragMove,
    onMove,
}: {
    value: T
    title: string
    subtitle?: string
    trailing?: string
    index: number
    count: number
    onDragStart: () => void
    onDragEnd: () => void
    onDragMove?: (clientY: number) => void
    onMove: (to: number) => void
}) {
    const controls = useDragControls()
    const { lift, drop, liftClass } = useDragLift()

    return (
        <Reorder.Item
            value={value}
            dragListener={false}
            dragControls={controls}
            onDragStart={() => { lift(); onDragStart() }}
            onDrag={(e) => onDragMove?.((e as PointerEvent).clientY)}
            onDragEnd={() => { drop(); onDragEnd() }}
            // Scale only. The shadow is a class - see useDragLift for why
            // animating it through Motion left it stuck on the row.
            whileDrag={{ scale: 1.02 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className={`flex items-center gap-3 px-3 py-2.5 border-b border-slate-100 last:border-0 bg-white transition-shadow duration-150 ${liftClass}`}
        >
            <button
                onPointerDown={(e) => controls.start(e)}
                onKeyDown={(e) => {
                    const to =
                        e.key === "ArrowUp" ? index - 1
                            : e.key === "ArrowDown" ? index + 1
                                : e.key === "Home" ? 0
                                    : e.key === "End" ? count - 1
                                        : null
                    if (to === null) return
                    e.preventDefault()
                    onMove(to)
                }}
                aria-label={`${title} · ${index + 1}/${count}`}
                // touch-none stops the browser claiming the gesture as a scroll
                // before Motion ever sees it.
                className="h-11 w-11 grid place-items-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 touch-none cursor-grab active:cursor-grabbing shrink-0"
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
