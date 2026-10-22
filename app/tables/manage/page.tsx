"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Reorder, useDragControls } from "motion/react"
import { ArrowLeft, GripVertical, Pencil, Plus, Trash2, Users } from "lucide-react"
import { useTranslation } from "@/hooks/use-translation"
import { notify } from "@/components/ui/sonner"
import { useConfirm } from "@/components/confirm-provider"
import { canManageTables } from "@/lib/roles"
// Reordering inside one area without moving the areas themselves.
import { withAreaOrder, moveInArea } from "@/lib/floor-order"
import { useDragLift } from "@/hooks/use-drag-lift"

type Table = {
    id: string
    name: string
    area: string
    seats: number
    /** A room sold on a floor. Null on an ordinary table. */
    minSpend: number | null
    displayOrder: number
    sessions: { id: string }[]
}

const NEW_AREA = "__new__"

/**
 * The floor plan, as a list you can edit.
 *
 * Deliberately not an edit mode on the floor plan itself: that screen is
 * tapped all night by people opening tables, and a rename button living
 * beside "open table" is a mis-tap that renames a table mid-service. This is
 * a separate room you have to walk into.
 */
export default function ManageTablesPage() {
    const { t } = useTranslation()
    const router = useRouter()
    const confirm = useConfirm()

    const [tables, setTables] = useState<Table[]>([])
    const [loaded, setLoaded] = useState(false)
    const [allowed, setAllowed] = useState<boolean | null>(null)
    const [saving, setSaving] = useState(false)
    // What the server last confirmed, by table id. A drop diffs against this
    // rather than against the previous render, so a drag that wanders and
    // lands back where it started writes nothing.
    const persisted = useRef(new Map<string, number>())

    const [isOpen, setIsOpen] = useState(false)
    const [editing, setEditing] = useState<Table | null>(null)
    const [form, setForm] = useState({ name: "", area: "INDOOR", newArea: "", seats: "4", minSpend: "" })

    const load = useCallback(async () => {
        try {
            const res = await fetch("/api/tables")
            if (res.ok) {
                const rows: Table[] = await res.json()
                // The order the server is holding, so a drop can tell what
                // actually moved.
                persisted.current = new Map(rows.map((x) => [x.id, x.displayOrder]))
                setTables(rows)
            }
        } catch (e) { console.error(e) }
        finally { setLoaded(true) }
    }, [])

    useEffect(() => {
        fetch("/api/auth/me")
            .then((r) => r.json())
            .then((d) => setAllowed(canManageTables(d?.user?.role)))
            .catch(() => setAllowed(false))
        load()
    }, [load])

    const areaLabel = useCallback((value: string) => {
        if (value === "INDOOR") return t.area_indoor
        if (value === "OUTDOOR") return t.area_outdoor
        if (value === "VIP") return t.area_vip
        return value
    }, [t])

    const areas = useMemo(
        () => Array.from(new Set(tables.map((tbl) => tbl.area))),
        [tables]
    )

    const openNew = () => {
        setEditing(null)
        setForm({ name: "", area: areas[0] || "INDOOR", newArea: "", seats: "4", minSpend: "" })
        setIsOpen(true)
    }

    const openEdit = (table: Table) => {
        setEditing(table)
        setForm({ name: table.name, area: table.area, newArea: "", seats: String(table.seats), minSpend: table.minSpend ? String(table.minSpend) : "" })
        setIsOpen(true)
    }

    const save = async () => {
        const area = form.area === NEW_AREA ? form.newArea.trim() : form.area
        if (!form.name.trim() || !area) return
        setSaving(true)
        try {
            const res = await fetch(editing ? `/api/tables/${editing.id}` : "/api/tables", {
                method: editing ? "PUT" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: form.name.trim(),
                    area,
                    seats: Number(form.seats) || 4,
                    minSpend: form.minSpend,
                    // New tables land at the end of their area rather than on
                    // top of whatever is already there.
                    displayOrder: editing
                        ? editing.displayOrder
                        : tables.filter((x) => x.area === area).length,
                }),
            })
            if (res.ok) {
                setIsOpen(false)
                notify.success(t.table_saved)
                load()
            } else {
                const err = await res.json().catch(() => ({}))
                notify.error(err.error === "TABLE_HAS_OPEN_SESSION" ? t.table_has_open_session : t.save_failed)
            }
        } catch (e) { console.error(e) }
        finally { setSaving(false) }
    }

    const remove = async (table: Table) => {
        if (table.sessions.length > 0) {
            notify.warn(t.table_has_open_session)
            return
        }
        const ok = await confirm({
            title: t.remove_table_confirm,
            description: `${table.name} — ${t.remove_table_desc}`,
            confirmLabel: t.remove,
            destructive: true,
        })
        if (!ok) return
        const res = await fetch(`/api/tables/${table.id}`, { method: "DELETE" })
        if (res.ok) {
            notify.success(t.table_saved)
            load()
        } else {
            const err = await res.json().catch(() => ({}))
            notify.error(err.error === "TABLE_HAS_OPEN_SESSION" ? t.table_has_open_session : t.delete_failed)
        }
    }

    /**
     * A row moved past another. Local only.
     *
     * Reorder.Group calls this on every SWAP, not on drop - dragging a table
     * up six places calls it five times. It used to write to the server from
     * here and then reload the whole floor, so one gesture fired dozens of
     * PUTs and kept replacing the array under the finger that was dragging.
     * That was the lag, and it was why a drag sometimes snapped back: a
     * server response landing mid-gesture overwrote where the row had got to.
     *
     * So this does the cheap synchronous thing and nothing else. The writing
     * happens once, on drop - see persistOrder.
     */
    const reorder = (area: string, next: Table[]) => {
        setTables((prev) => withAreaOrder(prev, area, next))
    }

    /**
     * Move a table without dragging it.
     *
     * The answer to a long room: dragging one table from the bottom to the top
     * means holding the grip with one hand and scrolling with the other, and
     * the drop misses as often as it lands. Arrow keys move it a place at a
     * time and Home/End send it to either end in one press, so the distance
     * stops mattering.
     *
     * It is also the only way a keyboard reaches this at all - a drag handle
     * with no key bindings is a feature that does not exist without a mouse.
     */
    const moveWithin = (area: string, from: number, to: number) => {
        // Computed here rather than read back from state: setTables has not
        // rendered yet when the next line runs, so persisting from the closure
        // would write the order as it was BEFORE the key press.
        const full = moveInArea(tables, area, from, to)
        // A key press at the end of a list does nothing, rather than re-saving
        // the same order and flashing a spinner.
        if (full === tables) return
        setTables(full)
        // Written straight away: a key press is a finished action, where a drag
        // is not finished until it is let go.
        persistRows(full)
    }

    /**
     * The row was let go. Write what actually changed, once.
     *
     * Diffed against what the server last confirmed rather than against the
     * previous render, so a drag that wanders up and down and lands back where
     * it started writes nothing at all.
     *
     * No reload afterwards. The optimistic state already IS the new order, and
     * re-fetching only invites the server's copy to arrive late and fight the
     * next gesture. A failure reloads, because then the screen is the thing
     * that is wrong.
     */
    const persistRows = useCallback(async (rows: Table[]) => {
        const changed = rows.filter((x) => persisted.current.get(x.id) !== x.displayOrder)
        if (changed.length === 0) return

        setSaving(true)
        try {
            const results = await Promise.all(changed.map((x) =>
                fetch(`/api/tables/${x.id}`, {
                    method: "PUT", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ displayOrder: x.displayOrder }),
                })))
            if (results.some((r) => !r.ok)) throw new Error("save failed")
            for (const x of changed) persisted.current.set(x.id, x.displayOrder)
        } catch {
            notify.error(t.save_failed)
            load()
        } finally {
            setSaving(false)
        }
    }, [load, t])

    /** Drag finished. By now the last swap has rendered, so state is current. */
    const persistOrder = useCallback(() => persistRows(tables), [persistRows, tables])

    if (allowed === false) {
        return (
            <div className="min-h-screen grid place-items-center bg-slate-50 p-6">
                <div className="text-center">
                    <p className="text-slate-600 font-semibold">{t.only_admin_edits}</p>
                    <Button variant="outline" className="h-11 mt-4" onClick={() => router.push("/tables")}>
                        <ArrowLeft className="w-4 h-4 mr-2" />{t.back}
                    </Button>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-slate-50">
            <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
                <div className="px-4 md:px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3 min-w-0">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-11 w-11 shrink-0"
                            aria-label={t.back}
                            onClick={() => router.push("/tables")}
                        >
                            <ArrowLeft className="w-5 h-5" />
                        </Button>
                        <div className="min-w-0">
                            <h1 className="text-xl md:text-2xl font-bold text-slate-900 leading-tight">{t.floor_plan}</h1>
                            <p className="text-sm text-slate-600 mt-0.5">{t.floor_plan_desc}</p>
                        </div>
                    </div>
                    <Button className="h-11 bg-amber-600 hover:bg-amber-700 font-bold" onClick={openNew}>
                        <Plus className="w-4 h-4 mr-2" />
                        {t.add_table}
                    </Button>
                </div>
            </header>

            {/* Areas side by side rather than stacked. A bar's floor is three
                short lists, not one long one - on any screen wider than a
                tablet the old single column meant scrolling past the indoor
                tables to reach the VIP rooms that were the reason you came. */}
            <main className="p-4 md:p-6 max-w-[1600px]">
                {!loaded ? (
                    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                        <div className="h-64 rounded-xl bg-slate-100 animate-pulse" />
                        <div className="h-64 rounded-xl bg-slate-100 animate-pulse" />
                        <div className="h-64 rounded-xl bg-slate-100 animate-pulse" />
                    </div>
                ) : tables.length === 0 ? (
                    <Card className="p-10 text-center text-slate-500">{t.no_tables_yet}</Card>
                ) : (
                    <>
                        <p className="flex items-center gap-2 text-sm text-slate-500 mb-4">
                            <GripVertical className="w-4 h-4 text-slate-400 shrink-0" aria-hidden />
                            {t.reorder_hint}
                        </p>
                        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3 items-start">
                            {areas.map((area) => {
                                const inArea = tables.filter((x) => x.area === area)
                                const seats = inArea.reduce((sum, x) => sum + x.seats, 0)
                                return (
                                    <Card key={area} className="overflow-hidden p-0 gap-0">
                                        <div className="flex items-baseline gap-2 px-4 py-3 border-b border-slate-200 bg-slate-50">
                                            <h2 className="font-bold text-slate-900">{areaLabel(area)}</h2>
                                            <span className="text-slate-400 tabular-nums font-semibold">{inArea.length}</span>
                                            <span className="ms-auto text-xs text-slate-400 tabular-nums inline-flex items-center gap-1">
                                                <Users className="w-3.5 h-3.5" aria-hidden />
                                                {seats}
                                            </span>
                                        </div>
                                        <Reorder.Group
                                            axis="y"
                                            values={inArea}
                                            onReorder={(next) => reorder(area, next as Table[])}
                                        >
                                            {inArea.map((table, i) => (
                                                <TableRow
                                                    key={table.id}
                                                    table={table}
                                                    index={i}
                                                    count={inArea.length}
                                                    onDrop={persistOrder}
                                                    onMove={(to) => moveWithin(area, i, to)}
                                                    seatsLabel={t.seats}
                                                    occupiedLabel={t.occupied}
                                                    editLabel={t.edit}
                                                    removeLabel={t.remove_table}
                                                    onEdit={() => openEdit(table)}
                                                    onRemove={() => remove(table)}
                                                />
                                            ))}
                                        </Reorder.Group>
                                    </Card>
                                )
                            })}
                        </div>
                    </>
                )}
            </main>

            <Dialog open={isOpen} onOpenChange={setIsOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{editing ? t.edit_table : t.add_table}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="tableName">{t.table_name}</Label>
                            <Input
                                id="tableName"
                                className="h-11"
                                placeholder={t.table_name_placeholder}
                                value={form.name}
                                onChange={(e) => setForm({ ...form, name: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="tableArea">{t.area_label}</Label>
                            <Select value={form.area} onValueChange={(v) => setForm({ ...form, area: v })}>
                                <SelectTrigger id="tableArea" className="h-11">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {Array.from(new Set([...areas, "INDOOR"])).map((a) => (
                                        <SelectItem key={a} value={a}>{areaLabel(a)}</SelectItem>
                                    ))}
                                    <SelectItem value={NEW_AREA}>{t.new_area}</SelectItem>
                                </SelectContent>
                            </Select>
                            {form.area === NEW_AREA && (
                                <Input
                                    className="h-11"
                                    placeholder={t.new_area_name}
                                    value={form.newArea}
                                    onChange={(e) => setForm({ ...form, newArea: e.target.value })}
                                    maxLength={24}
                                />
                            )}
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="tableSeats">{t.seats_count}</Label>
                            <Input
                                id="tableSeats"
                                className="h-11"
                                inputMode="numeric"
                                value={form.seats}
                                onChange={(e) => setForm({ ...form, seats: e.target.value.replace(/\D/g, "") })}
                                maxLength={2}
                            />
                        </div>
                        {/* Blank on every table but the rooms that are sold on
                            a floor, so the hint says what blank means rather
                            than leaving a manager guessing whether 0 is it. */}
                        <div className="space-y-2 sm:col-span-2">
                            <Label htmlFor="tableMinSpend">{t.min_spend}</Label>
                            <Input
                                id="tableMinSpend"
                                className="h-11"
                                inputMode="numeric"
                                placeholder="—"
                                value={form.minSpend}
                                onChange={(e) => setForm({ ...form, minSpend: e.target.value.replace(/\D/g, "") })}
                                maxLength={9}
                            />
                            <p className="text-xs text-muted-foreground">{t.min_spend_hint}</p>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsOpen(false)}>{t.cancel}</Button>
                        <Button
                            className="bg-amber-600 hover:bg-amber-700 font-bold"
                            onClick={save}
                            disabled={saving || !form.name.trim() || (form.area === NEW_AREA && !form.newArea.trim())}
                        >
                            {saving ? t.processing : t.save}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

/**
 * One table in its area's column.
 *
 * dragListener is off and the gesture starts at the handle, matching the menu
 * page: a stray swipe scrolls the list instead of pulling a table out of the
 * room. The edit and delete controls sit behind the handle in the tab order so
 * a keyboard still reaches them.
 */
function TableRow({
    table,
    index,
    count,
    onDrop,
    onMove,
    seatsLabel,
    occupiedLabel,
    editLabel,
    removeLabel,
    onEdit,
    onRemove,
}: {
    table: Table
    index: number
    count: number
    onDrop: () => void
    onMove: (to: number) => void
    seatsLabel: string
    occupiedLabel: string
    editLabel: string
    removeLabel: string
    onEdit: () => void
    onRemove: () => void
}) {
    const controls = useDragControls()
    const { lift, drop, liftClass } = useDragLift()

    return (
        <Reorder.Item
            value={table}
            dragListener={false}
            dragControls={controls}
            onDragStart={lift}
            onDragEnd={() => { drop(); onDrop() }}
            // Scale only. The shadow is a class - see useDragLift for why
            // animating it through Motion left it stuck on the row.
            whileDrag={{ scale: 1.02 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className={`flex items-center gap-2 px-2 py-2 border-b border-slate-100 last:border-0 bg-white transition-[colors,box-shadow] duration-150 hover:bg-amber-50/40 ${liftClass}`}
        >
            {/* Drag with a pointer, arrows with a keyboard. Home and End exist
                because the move people actually struggle with is all the way to
                one end, and that is one press instead of a drag across a
                scrolling page. */}
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
                aria-label={`${table.name} · ${index + 1}/${count}`}
                className="h-11 w-9 grid place-items-center rounded-lg text-slate-300 hover:text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 touch-none cursor-grab active:cursor-grabbing shrink-0"
            >
                <GripVertical className="w-5 h-5" />
            </button>

            <div className="min-w-0 flex-1">
                <p className="font-black text-slate-900 leading-tight truncate">{table.name}</p>
                <p className="text-xs text-slate-500 tabular-nums">
                    {table.seats} {seatsLabel}
                </p>
            </div>

            {/* A table with money on it can be renamed but not removed, and
                saying so here saves a failed tap. */}
            {table.sessions.length > 0 && (
                <span className="text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 shrink-0">
                    {occupiedLabel}
                </span>
            )}

            <Button
                variant="ghost" size="icon"
                className="h-10 w-10 text-slate-400 hover:text-slate-900 shrink-0"
                aria-label={editLabel}
                onClick={onEdit}
            >
                <Pencil className="w-4 h-4" />
            </Button>
            <Button
                variant="ghost" size="icon"
                className="h-10 w-10 text-slate-300 hover:text-rose-600 hover:bg-rose-50 shrink-0"
                aria-label={removeLabel}
                onClick={onRemove}
            >
                <Trash2 className="w-4 h-4" />
            </Button>
        </Reorder.Item>
    )
}
