"use client"

import { useState, useEffect } from "react"
import { useTranslation } from "@/hooks/use-translation"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ShieldCheck, Eye, EyeOff, Delete } from "lucide-react"

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
    children,
}: {
    open: boolean
    title: string
    description?: string
    onCancel: () => void
    onApprove: (credentials: { managerUsername: string; managerPin: string }) => void
    busy?: boolean
    error?: string | null
    /** Anything the approval also has to capture - a void or refund reason - so
     *  the reason and the PIN are one decision rather than two dialogs. */
    children?: React.ReactNode
}) {
    const { t } = useTranslation()
    const [managers, setManagers] = useState<Manager[]>([])
    const [username, setUsername] = useState("")
    const [pin, setPin] = useState("")
    // A PIN typed on a shared till gets mistyped, and with no way to look the
    // only recovery is to clear it and start over.
    const [reveal, setReveal] = useState(false)

    useEffect(() => {
        if (!open) return
        setPin("")
        setReveal(false)
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
                    {children}

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
                        {/* No placeholder dots: centred and letter-spaced, they
                            read as a PIN already typed, which is exactly how a
                            blank field gets mistaken for a filled one. */}
                        <div className="relative mt-1">
                            {/* A text field followed by a password field is read
                                as a login form, and the browser injects a saved
                                username and password - which lands on the till
                                looking exactly like a PIN somebody left behind.
                                "off" is ignored on password fields; this is not,
                                and the data- attributes cover the third-party
                                managers that ignore both. */}
                            <Input
                                type={reveal ? "text" : "password"}
                                inputMode="numeric"
                                autoComplete="new-password"
                                name="manager-approval-pin"
                                data-lpignore="true"
                                data-1p-ignore
                                data-form-type="other"
                                value={pin}
                                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                                onKeyDown={(e) => { if (e.key === "Enter") submit() }}
                                className="h-12 text-lg tracking-[0.5em] text-center pe-12 autofill:shadow-[inset_0_0_0_1000px_white]"
                            />
                            <button
                                type="button"
                                onClick={() => setReveal((v) => !v)}
                                aria-label={t.manager_pin}
                                className="absolute end-2 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-slate-700"
                            >
                                {reveal ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                            </button>
                        </div>
                    </div>

                    {/* The till is a touch screen with no keyboard, so the PIN
                        field alone could not be filled in: the same keypad as
                        the PIN screen. The field still takes a keyboard. */}
                    <div className="grid grid-cols-3 gap-2" role="group" aria-label={t.manager_pin}>
                        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                            <Button
                                key={d}
                                type="button"
                                variant="outline"
                                className="h-14 text-2xl font-semibold hover:bg-amber-100"
                                onClick={() => setPin((p) => (p + d).slice(0, 8))}
                                disabled={busy}
                            >
                                {d}
                            </Button>
                        ))}
                        <Button
                            type="button"
                            variant="outline"
                            className="h-14 text-sm font-semibold text-slate-600"
                            onClick={() => setPin("")}
                            disabled={busy || pin.length === 0}
                        >
                            {t.clear}
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            className="h-14 text-2xl font-semibold hover:bg-amber-100"
                            onClick={() => setPin((p) => (p + "0").slice(0, 8))}
                            disabled={busy}
                        >
                            0
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            className="h-14 text-slate-600"
                            onClick={() => setPin((p) => p.slice(0, -1))}
                            disabled={busy || pin.length === 0}
                            aria-label={t.delete}
                        >
                            <Delete className="w-6 h-6" />
                        </Button>
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
