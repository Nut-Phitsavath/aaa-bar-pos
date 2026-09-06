"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
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

type Table = {
    id: string
    name: string
    area: string
    seats: number
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

    const [isOpen, setIsOpen] = useState(false)
    const [editing, setEditing] = useState<Table | null>(null)
    const [form, setForm] = useState({ name: "", area: "INDOOR", newArea: "", seats: "4" })

    const load = useCallback(async () => {
        try {
            const res = await fetch("/api/tables")
            if (res.ok) setTables(await res.json())
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
        setForm({ name: "", area: areas[0] || "INDOOR", newArea: "", seats: "4" })
        setIsOpen(true)
    }

    const openEdit = (table: Table) => {
        setEditing(table)
        setForm({ name: table.name, area: table.area, newArea: "", seats: String(table.seats) })
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
     * Dropped somewhere new.
     *
     * Replaces a pair of arrow buttons: moving a table from the bottom of the
     * room to the top was eleven taps, and staff already learned this grip on
     * the menu page. Order is per area, so a drag only ever renumbers the
     * column it happened in.
     *
     * Written on drop rather than behind a Save button - the arrangement IS
     * the state, and only the tables whose position actually changed are sent.
     */
    const reorder = async (area: string, next: Table[]) => {
        const renumbered = next.map((x, i) => ({ ...x, displayOrder: i }))
        // Optimistic, so the row stays where it was let go instead of snapping
        // back while the writes are in flight.
        //
        // Each slot this area already occupies takes the next table in the new
        // order. Appending the area to the end instead would have reordered
        // the AREAS - they are derived from this array - and the columns would
        // jump sideways every time a table moved inside one of them.
        setTables((prev) => {
            const queue = [...renumbered]
            return prev.map((x) => (x.area === area ? queue.shift()! : x))
        })
        const changed = renumbered.filter((x) =>
            tables.find((old) => old.id === x.id)?.displayOrder !== x.displayOrder)
        if (changed.length === 0) return
        setSaving(true)
        try {
            await Promise.all(changed.map((x) =>
                fetch(`/api/tables/${x.id}`, {
                    method: "PUT", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ displayOrder: x.displayOrder }),
                })))
        } finally {
            setSaving(false)
            load()
        }
    }

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
                                            {inArea.map((table) => (
                                                <TableRow
                                                    key={table.id}
                                                    table={table}
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
    seatsLabel,
    occupiedLabel,
    editLabel,
    removeLabel,
    onEdit,
    onRemove,
}: {
    table: Table
    seatsLabel: string
    occupiedLabel: string
    editLabel: string
    removeLabel: string
    onEdit: () => void
    onRemove: () => void
}) {
    const controls = useDragControls()

    return (
        <Reorder.Item
            value={table}
            dragListener={false}
            dragControls={controls}
            whileDrag={{ scale: 1.02, boxShadow: "0 12px 24px rgb(15 23 42 / 0.18)", zIndex: 10 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="flex items-center gap-2 px-2 py-2 border-b border-slate-100 last:border-0 bg-white transition-colors duration-150 hover:bg-amber-50/40"
        >
            <button
                onPointerDown={(e) => controls.start(e)}
                aria-label={table.name}
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
                <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 shrink-0">
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
