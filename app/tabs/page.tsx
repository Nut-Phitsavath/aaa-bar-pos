"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useTranslation } from "@/hooks/use-translation"
import { Header } from "@/components/header"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Clock3, Phone, CreditCard, Banknote } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"
import { formatTHB } from "@/lib/currency"

type Tab = {
    customer: { id: string; name: string; phone: string | null }
    outstanding: number
    bills: { id: string; table: string; closedAt: string | null; total: number; balance: number }[]
}

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB") : "—")

/** Collection is entirely about age: a three-week-old debt must not render
 *  identically to last night's. */
const ageDays = (iso: string | null) =>
    iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : 0

/**
 * Who owes what (requirement #19).
 *
 * A tab is a closed bill that still has a balance. Collecting on one goes to
 * the same settle screen as anything else, because a tab being paid is just a
 * payment against its original bill - which is why part-payment works without
 * anything extra.
 */
export default function TabsPage() {
    const { t } = useTranslation()
    const router = useRouter()
    const [tabs, setTabs] = useState<Tab[]>([])
    const [total, setTotal] = useState(0)
    const [loading, setLoading] = useState(true)
    const [paying, setPaying] = useState<Tab | null>(null)
    const [amount, setAmount] = useState("")
    const [busy, setBusy] = useState(false)

    const load = useCallback(async () => {
        try {
            const res = await fetch("/api/tabs")
            if (res.ok) {
                const data = await res.json()
                setTabs(data.tabs ?? [])
                setTotal(data.totalOutstanding ?? 0)
            }
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => { load() }, [load])

    return (
        <div className="min-h-screen bg-slate-50">
            <Header title={t.tabs}>
                {!loading && tabs.length > 0 && (
                    <div className="text-right leading-none">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                            {t.outstanding}
                        </p>
                        <p className="text-xl font-black text-amber-700 tabular-nums mt-1">
                            {formatTHB(total)}
                        </p>
                    </div>
                )}
            </Header>

            <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-3">
                {loading ? (
                    <>
                        <div className="h-28 rounded-xl bg-white border border-slate-200 animate-pulse" />
                        <div className="h-28 rounded-xl bg-white border border-slate-200 animate-pulse" />
                    </>
                ) : tabs.length === 0 ? (
                    <div className="text-center py-20">
                        <div className="w-12 h-12 rounded-full bg-slate-100 grid place-items-center mx-auto mb-3">
                            <Clock3 className="w-6 h-6 text-slate-400" />
                        </div>
                        <p className="text-slate-900 font-semibold">{t.no_tabs}</p>
                    </div>
                ) : (
                    tabs.map((tab) => (
                        <Card key={tab.customer.id} className="p-4">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="font-bold text-slate-900 truncate">{tab.customer.name}</p>
                                    {tab.customer.phone && (
                                        <p className="text-sm text-slate-500 flex items-center gap-1.5 mt-0.5">
                                            <Phone className="w-3.5 h-3.5" />
                                            {tab.customer.phone}
                                        </p>
                                    )}
                                </div>
                                <div className="text-right shrink-0">
                                    <p className="text-2xl font-black text-amber-700 tabular-nums leading-none">
                                        {formatTHB(tab.outstanding)}
                                    </p>
                                    <p className="text-xs text-slate-400 mt-1">
                                        {tab.bills.length} {t.bill}
                                    </p>
                                </div>
                            </div>

                            {/* One payment against the customer, spread oldest
                                first. Cash arrives as a lump - "here's ten
                                thousand toward it" - not as a decision about
                                which night to clear. */}
                            <Button
                                className="w-full h-12 mt-3 bg-amber-600 hover:bg-amber-700 text-white"
                                onClick={() => { setPaying(tab); setAmount(String(tab.outstanding)) }}
                            >
                                <Banknote className="w-4 h-4 mr-2" />
                                {t.take_payment}
                            </Button>

                            {/* Or clear one night on its own, which is what a
                                customer settling a single disputed bill wants. */}
                            <div className="mt-3 pt-3 border-t space-y-2">
                                {tab.bills.map((b) => (
                                    <div key={b.id} className="flex items-center gap-3 text-sm">
                                        <span className="font-semibold text-slate-700 shrink-0">{b.table}</span>
                                        <span className="text-slate-400 tabular-nums">{day(b.closedAt)}</span>
                                        {ageDays(b.closedAt) >= 7 && (
                                            <span className={`text-xs font-bold tabular-nums shrink-0 ${ageDays(b.closedAt) >= 21 ? "text-rose-600" : "text-amber-600"}`}>
                                                {ageDays(b.closedAt)}d
                                            </span>
                                        )}
                                        <span className="ms-auto tabular-nums text-slate-900">
                                            {formatTHB(b.balance)}
                                        </span>
                                        <Button
                                            size="sm"
                                            className="h-9 bg-amber-600 hover:bg-amber-700 text-white shrink-0"
                                            onClick={() => router.push(`/pos/settle?session=${b.id}`)}
                                        >
                                            <CreditCard className="w-3.5 h-3.5 sm:mr-1.5" />
                                            <span className="hidden sm:inline">{t.settle_tab}</span>
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        </Card>
                    ))
                )}
            </div>

            <Dialog open={!!paying} onOpenChange={(o) => { if (!o) setPaying(null) }}>
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle>{paying?.customer.name}</DialogTitle>
                    </DialogHeader>
                    {paying && (
                        <div className="space-y-3">
                            <div className="flex justify-between text-sm">
                                <span className="text-slate-500">{t.outstanding}</span>
                                <span className="font-bold tabular-nums">{formatTHB(paying.outstanding)}</span>
                            </div>
                            <Input
                                type="number"
                                autoFocus
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                className="h-14 text-2xl font-black tabular-nums text-center border-2 rounded-xl"
                            />
                            <p className="text-xs text-slate-500">{t.applied_oldest_first}</p>
                            <Button
                                className="w-full h-12 bg-amber-600 hover:bg-amber-700 text-white"
                                disabled={busy || !(Number(amount) > 0)}
                                onClick={async () => {
                                    setBusy(true)
                                    try {
                                        const res = await fetch(`/api/customers/${paying.customer.id}/settle-tab`, {
                                            method: "POST",
                                            headers: { "Content-Type": "application/json" },
                                            body: JSON.stringify({ amount: Number(amount) }),
                                        })
                                        const data = await res.json().catch(() => ({}))
                                        if (!res.ok) { toast.error(data.error || "Failed"); return }
                                        toast.success(
                                            data.change > 0
                                                ? `${t.payment_confirmed} · ${t.change} ${formatTHB(data.change)}`
                                                : t.payment_confirmed
                                        )
                                        setPaying(null)
                                        await load()
                                    } finally { setBusy(false) }
                                }}
                            >
                                {busy ? "…" : t.take_payment}
                            </Button>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    )
}
