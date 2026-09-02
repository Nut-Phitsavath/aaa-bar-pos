"use client"

import { useState, useEffect } from "react"
import { useTranslation } from "@/hooks/use-translation"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ShieldCheck } from "lucide-react"

type Manager = { id: string; name: string; username: string }

/**
 * The gate in front of every action that gives money away.
 *
 * Asks for a manager by name as well as a PIN, matching the login screen: a
 * bare 4-digit PIN is a small search space, and staff already know each other's
 * names, so naming the approver costs nothing and removes the anonymous guess.
 *
 * It hands the credentials back rather than verifying them itself - the server
 * checks them as part of the same request that performs the action, so an
 * approval cannot be obtained once and reused for something else.
 */
export function ManagerApproval({
    open,
    title,
    description,
    onCancel,
    onApprove,
    busy,
    error,
}: {
    open: boolean
    title: string
    description?: string
    onCancel: () => void
    onApprove: (credentials: { managerUsername: string; managerPin: string }) => void
    busy?: boolean
    error?: string | null
}) {
    const { t } = useTranslation()
    const [managers, setManagers] = useState<Manager[]>([])
    const [username, setUsername] = useState("")
    const [pin, setPin] = useState("")

    useEffect(() => {
        if (!open) return
        setPin("")
        fetch("/api/auth/managers")
            .then((r) => (r.ok ? r.json() : []))
            .then((list: Manager[]) => {
                setManagers(Array.isArray(list) ? list : [])
                if (list.length === 1) setUsername(list[0].username)
            })
            .catch(() => setManagers([]))
    }, [open])

    const submit = () => {
        if (!username || pin.length < 4) return
        onApprove({ managerUsername: username, managerPin: pin })
    }

    return (
        <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel() }}>
            <DialogContent className="max-w-sm">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <ShieldCheck className="w-5 h-5 text-amber-600" />
                        {title}
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-3">
                    {description && <p className="text-sm text-slate-600">{description}</p>}

                    <div>
                        <label className="text-sm text-slate-600">{t.manager}</label>
                        <Select value={username} onValueChange={setUsername}>
                            <SelectTrigger className="h-12 mt-1">
                                <SelectValue placeholder={t.select_manager} />
                            </SelectTrigger>
                            <SelectContent>
                                {managers.map((m) => (
                                    <SelectItem key={m.id} value={m.username}>{m.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div>
                        <label className="text-sm text-slate-600">{t.manager_pin}</label>
                        <Input
                            type="password"
                            inputMode="numeric"
                            autoComplete="off"
                            value={pin}
                            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                            onKeyDown={(e) => { if (e.key === "Enter") submit() }}
                            className="h-12 text-lg mt-1 tracking-[0.5em] text-center"
                            placeholder="••••"
                        />
                    </div>

                    {error && <p className="text-sm text-rose-600">{error}</p>}

                    <div className="grid grid-cols-2 gap-2 pt-1">
                        <Button variant="outline" className="h-12" onClick={onCancel} disabled={busy}>
                            {t.cancel_qr}
                        </Button>
                        <Button
                            className="h-12 bg-amber-600 hover:bg-amber-700 text-white"
                            onClick={submit}
                            disabled={busy || !username || pin.length < 4}
                        >
                            {busy ? "…" : t.approve}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
