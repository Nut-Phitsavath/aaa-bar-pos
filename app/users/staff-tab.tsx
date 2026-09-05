"use client"

import { useState, useEffect } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Plus, Search, Eye, ShieldCheck, KeyRound, Users } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useTranslation } from "@/hooks/use-translation"
import { notify } from "@/components/ui/sonner"
import { canManageUser, isTillRole, ROLES } from "@/lib/roles"

type Staff = {
    id: string
    name: string
    username: string
    role: string
    isActive: boolean
    createdAt: string
}

export function StaffTab({ actorRole }: { actorRole?: string }) {
    const { t } = useTranslation()
    const [searchQuery, setSearchQuery] = useState("")
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [selectedStaff, setSelectedStaff] = useState<Staff | null>(null)
    const [staffList, setStaffList] = useState<Staff[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [loaded, setLoaded] = useState(false)

    const [formData, setFormData] = useState({
        name: "",
        username: "",
        role: "STAFF",
        pin: "",
        isActive: true
    })

    useEffect(() => {
        fetchStaff()
    }, [])

    const fetchStaff = async () => {
        try {
            const res = await fetch('/api/users')
            if (res.ok) {
                const data = await res.json()
                setStaffList(data)
            }
        } catch (e) { console.error(e) }
        finally { setLoaded(true) }
    }

    const blank = (role = "STAFF") => ({ name: "", username: "", role, pin: "", isActive: true })

    const openNew = (role: string) => {
        setSelectedStaff(null)
        setFormData(blank(role))
        setIsDialogOpen(true)
    }

    const openEdit = (staff: Staff) => {
        setSelectedStaff(staff)
        setFormData({
            name: staff.name,
            username: staff.username,
            role: staff.role,
            pin: "",
            isActive: staff.isActive,
        })
        setIsDialogOpen(true)
    }

    const handleSave = async () => {
        setIsLoading(true)
        try {
            const url = selectedStaff ? `/api/users/${selectedStaff.id}` : '/api/users'
            const method = selectedStaff ? 'PUT' : 'POST'

            // A server has no credential to send: the server generates both, so
            // the till never holds a PIN for someone who cannot use one.
            const payload: any = {
                name: formData.name,
                role: formData.role,
                isActive: formData.isActive,
            }
            if (isTillRole(formData.role)) {
                payload.username = formData.username
                if (formData.pin) payload.pin = formData.pin
            }

            const res = await fetch(url, {
                method,
                body: JSON.stringify(payload),
                headers: { 'Content-Type': 'application/json' }
            })
            if (res.ok) {
                setIsDialogOpen(false)
                setSelectedStaff(null)
                setFormData(blank())
                fetchStaff()
            } else {
                const err = await res.json().catch(() => ({}))
                notify.error(err.error === 'ROLE_NOT_ALLOWED' ? t.only_admin_edits : (err.error || t.save_staff_failed))
            }
        } catch (e) { console.error(e) }
        finally { setIsLoading(false) }
    }

    const roleLabel = (role: string) => {
        if (role === 'ADMIN') return t.admin
        if (role === 'MANAGER') return t.role_manager_label
        if (role === 'WAITER') return t.role_server_label
        return t.staff
    }

    const roleDescription = (role: string) => {
        if (role === 'ADMIN') return t.role_admin_desc
        if (role === 'MANAGER') return t.role_manager_desc
        if (role === 'WAITER') return t.role_server_desc
        return t.role_staff_desc
    }

    const matches = (s: Staff) =>
        s.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (isTillRole(s.role) && s.username?.toLowerCase().includes(searchQuery.toLowerCase()))

    const tillUsers = staffList.filter((s) => isTillRole(s.role)).filter(matches)
    const servers = staffList.filter((s) => s.role === 'WAITER').filter(matches)

    const serverForm = !isTillRole(formData.role)
    const canSave =
        formData.name.trim().length > 0 &&
        (serverForm || (formData.username.trim().length > 0 && (selectedStaff ? true : formData.pin.length >= 4)))

    const row = (staff: Staff) => {
        const editable = canManageUser(actorRole, staff.role)
        return (
            <div
                key={staff.id}
                className={`flex items-center gap-3 px-4 py-3 border-b border-slate-100 last:border-0 transition-colors duration-150 ${!staff.isActive ? 'bg-slate-50' : 'hover:bg-amber-50/40'}`}
            >
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <h3 className={`font-bold ${staff.isActive ? 'text-slate-900' : 'text-slate-400'}`}>{staff.name}</h3>
                        {staff.role === 'ADMIN' && (
                            <Badge className="bg-purple-100 text-purple-700 hover:bg-purple-100">
                                <ShieldCheck className="w-3 h-3 mr-1" />{t.admin}
                            </Badge>
                        )}
                        {staff.role === 'MANAGER' && (
                            <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">{t.role_manager_label}</Badge>
                        )}
                        {staff.role === 'STAFF' && (
                            <Badge variant="outline" className="text-slate-600 border-slate-300">{t.staff}</Badge>
                        )}
                        {!staff.isActive && <Badge variant="destructive">{t.inactive}</Badge>}
                    </div>
                    {isTillRole(staff.role) && (
                        <p className="text-sm text-slate-500 font-mono mt-0.5">@{staff.username}</p>
                    )}
                </div>

                {editable ? (
                    <Button variant="outline" size="sm" className="h-9 shrink-0" onClick={() => openEdit(staff)}>
                        <Eye className="w-4 h-4 mr-2" />
                        {t.edit}
                    </Button>
                ) : (
                    // A manager sees the owner's account but cannot touch it,
                    // and is told why rather than finding a button that fails.
                    <span className="text-xs text-slate-400 shrink-0 text-right max-w-40">{t.only_admin_edits}</span>
                )}
            </div>
        )
    }

    const group = (
        title: string,
        description: string,
        icon: React.ReactNode,
        people: Staff[],
        emptyText: string,
        addRole: string,
    ) => (
        <Card className="overflow-hidden p-0 gap-0">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 bg-slate-50">
                <span className="text-slate-500">{icon}</span>
                <div className="min-w-0 flex-1">
                    <h2 className="font-bold text-slate-900 leading-tight">
                        {title} <span className="text-slate-400 tabular-nums font-semibold">{people.length}</span>
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">{description}</p>
                </div>
                <Button variant="outline" size="sm" className="h-9 shrink-0" onClick={() => openNew(addRole)}>
                    <Plus className="w-4 h-4 mr-1.5" />
                    {t.add}
                </Button>
            </div>
            {people.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-slate-500">{emptyText}</p>
            ) : (
                people.map(row)
            )}
        </Card>
    )

    if (!loaded) {
        return (
            <div className="space-y-6">
                <div className="h-11 rounded-lg bg-slate-100 animate-pulse" />
                <div className="h-56 rounded-xl bg-slate-100 animate-pulse" />
                <div className="h-56 rounded-xl bg-slate-100 animate-pulse" />
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div className="flex gap-3">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <Input
                        placeholder={t.search_staff_username}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-10 h-11"
                    />
                </div>
                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                    <DialogTrigger asChild>
                        <Button className="h-11 bg-amber-600 hover:bg-amber-700 font-bold" onClick={() => openNew("STAFF")}>
                            <Plus className="w-4 h-4 mr-2" />
                            {t.add_person}
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>{selectedStaff ? t.edit_staff_member : t.add_new_staff_member}</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4">
                            {/* Role first: it decides whether the rest of this
                                form is a login or just a name on a round. */}
                            <div className="space-y-2">
                                <Label htmlFor="staffRole">{t.role}</Label>
                                <Select
                                    value={formData.role}
                                    onValueChange={(val) => setFormData({ ...formData, role: val })}
                                >
                                    <SelectTrigger id="staffRole" className="h-11">
                                        <SelectValue placeholder={t.select_a_role} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {ROLES.filter((r) => canManageUser(actorRole, r)).map((r) => (
                                            <SelectItem key={r} value={r}>{roleLabel(r)}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-slate-500">{roleDescription(formData.role)}</p>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="staffName">{t.full_name}</Label>
                                <Input
                                    id="staffName"
                                    className="h-11"
                                    placeholder={t.name_placeholder}
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                />
                            </div>

                            {serverForm ? (
                                <p className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
                                    {t.server_no_login}
                                </p>
                            ) : (
                                <>
                                    <div className="space-y-2">
                                        <Label htmlFor="staffUsername">{t.username}</Label>
                                        <Input
                                            id="staffUsername"
                                            className="h-11"
                                            placeholder={t.username_placeholder}
                                            value={formData.username}
                                            onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="staffPin">{t.pin_password_4}</Label>
                                        <Input
                                            id="staffPin"
                                            type="password"
                                            className="h-11"
                                            autoComplete="new-password"
                                            placeholder={selectedStaff ? t.leave_blank_unchanged : t.pin_example}
                                            value={formData.pin}
                                            onChange={(e) => setFormData({ ...formData, pin: e.target.value.replace(/\D/g, '') })}
                                            maxLength={4}
                                        />
                                    </div>
                                </>
                            )}

                            <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                                <Label htmlFor="staffActive">{t.account_active}</Label>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input id="staffActive" type="checkbox" className="sr-only peer" checked={formData.isActive} onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })} />
                                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
                                </label>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                                {t.cancel}
                            </Button>
                            <Button className="bg-amber-600 hover:bg-amber-700 font-bold" onClick={handleSave} disabled={isLoading || !canSave}>
                                {isLoading ? t.processing : t.save_staff}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            {/* Two lists, because they are two different things: one is a set of
                logins, the other is the list the table screen picks from. */}
            {group(t.till_users, t.till_users_desc, <KeyRound className="w-5 h-5" />, tillUsers, t.no_till_users, "STAFF")}
            {group(t.servers_group, t.servers_group_desc, <Users className="w-5 h-5" />, servers, t.no_servers_yet, "WAITER")}
        </div>
    )
}
