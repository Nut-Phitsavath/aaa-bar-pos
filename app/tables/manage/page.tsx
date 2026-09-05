"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ArrowLeft, ArrowDown, ArrowUp, Pencil, Plus, Trash2, Users } from "lucide-react"
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
    session: { id: string } | null
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
        if (table.session) {
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

    /** Swap two tables' positions within their area. */
    const move = async (table: Table, delta: number) => {
        const inArea = tables.filter((x) => x.area === table.area)
        const index = inArea.findIndex((x) => x.id === table.id)
        const other = inArea[index + delta]
        if (!other) return
        // Optimistic: the arrows are tapped in bursts and a round trip between
        // each one makes the list feel stuck.
        setTables((prev) => prev.map((x) =>
            x.id === table.id ? { ...x, displayOrder: other.displayOrder }
                : x.id === other.id ? { ...x, displayOrder: table.displayOrder } : x
        ))
        await Promise.all([
            fetch(`/api/tables/${table.id}`, {
                method: "PUT", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ displayOrder: other.displayOrder }),
            }),
            fetch(`/api/tables/${other.id}`, {
                method: "PUT", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ displayOrder: table.displayOrder }),
            }),
        ])
        load()
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

            <main className="p-4 md:p-6 space-y-6 max-w-4xl">
                {!loaded ? (
                    <>
                        <div className="h-40 rounded-xl bg-slate-100 animate-pulse" />
                        <div className="h-40 rounded-xl bg-slate-100 animate-pulse" />
                    </>
                ) : tables.length === 0 ? (
                    <Card className="p-10 text-center text-slate-500">{t.no_tables_yet}</Card>
                ) : (
                    areas.map((area) => {
                        const inArea = tables.filter((x) => x.area === area)
                        return (
                            <Card key={area} className="overflow-hidden p-0 gap-0">
                                <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 bg-slate-50">
                                    <h2 className="font-bold text-slate-900">
                                        {areaLabel(area)}{" "}
                                        <span className="text-slate-400 tabular-nums font-semibold">{inArea.length}</span>
                                    </h2>
                                </div>
                                {inArea.map((table, i) => (
                                    <div
                                        key={table.id}
                                        className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 last:border-0 transition-colors duration-150 hover:bg-amber-50/40"
                                    >
                                        <span className="text-lg font-black text-slate-900 min-w-16">{table.name}</span>
                                        <span className="text-sm text-slate-500 inline-flex items-center gap-1.5">
                                            <Users className="w-4 h-4" />
                                            {table.seats} {t.seats}
                                        </span>
                                        {/* A table with money on it can be renamed but not removed,
                                            and saying so here saves a failed tap. */}
                                        {table.session && (
                                            <span className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
                                                {t.occupied}
                                            </span>
                                        )}

                                        <div className="ms-auto flex items-center gap-1 shrink-0">
                                            <Button
                                                variant="ghost" size="icon" className="h-10 w-10"
                                                aria-label={t.move_up}
                                                disabled={i === 0}
                                                onClick={() => move(table, -1)}
                                            >
                                                <ArrowUp className="w-4 h-4" />
                                            </Button>
                                            <Button
                                                variant="ghost" size="icon" className="h-10 w-10"
                                                aria-label={t.move_down}
                                                disabled={i === inArea.length - 1}
                                                onClick={() => move(table, 1)}
                                            >
                                                <ArrowDown className="w-4 h-4" />
                                            </Button>
                                            <Button
                                                variant="outline" size="sm" className="h-10"
                                                onClick={() => openEdit(table)}
                                            >
                                                <Pencil className="w-4 h-4 mr-2" />
                                                {t.edit}
                                            </Button>
                                            <Button
                                                variant="ghost" size="icon"
                                                className="h-10 w-10 text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                                                aria-label={t.remove_table}
                                                onClick={() => remove(table)}
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </Card>
                        )
                    })
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
