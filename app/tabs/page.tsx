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

    /** The single worst debt on the floor, which is the number that decides
     *  who gets phoned tonight. */
    const worstAge = tabs.reduce(
        (worst, tab) => Math.max(worst, ...tab.bills.map((b) => ageDays(b.closedAt))),
        0,
    )

    return (
        <div className="min-h-screen bg-slate-50">
            <Header title={t.tabs}>
                {!loading && tabs.length > 0 && (
                    <div className="text-right leading-none">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                            {t.outstanding}
                        </p>
                        <p className="text-xl font-black text-amber-800 tabular-nums mt-1">
                            {formatTHB(total)}
                        </p>
                    </div>
                )}
            </Header>

            {/* A ledger, not a stack of cards down the middle of a wide screen.
                Collection is a scanning job - who owes, how much, how long -
                so every debtor stays on one screen rather than one per fold. */}
            <div className="p-4 md:p-6 max-w-[1600px]">
                {loading ? (
                    <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                        <div className="h-44 rounded-xl bg-white border border-slate-200 animate-pulse" />
                        <div className="h-44 rounded-xl bg-white border border-slate-200 animate-pulse" />
                        <div className="h-44 rounded-xl bg-white border border-slate-200 animate-pulse" />
                    </div>
                ) : tabs.length === 0 ? (
                    <div className="text-center py-20">
                        <div className="w-12 h-12 rounded-full bg-slate-100 grid place-items-center mx-auto mb-3">
                            <Clock3 className="w-6 h-6 text-slate-400" />
                        </div>
                        <p className="text-slate-900 font-semibold">{t.no_tabs}</p>
                    </div>
                ) : (
                    <>
                        {/* The three numbers a manager actually opens this
                            screen for. "Longest owing" was buried in a sub-row
                            before, which is the wrong place for the figure that
                            decides who gets phoned tonight. */}
                        <dl className="w-fit max-w-full flex flex-wrap divide-x divide-slate-200 rounded-xl border border-slate-200 bg-white mb-4">
                            <div className="px-5 py-4">
                                <dt className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{t.outstanding}</dt>
                                <dd className="text-2xl font-black text-amber-800 tabular-nums leading-none mt-1.5">{formatTHB(total)}</dd>
                            </div>
                            <div className="px-5 py-4">
                                <dt className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{t.customers}</dt>
                                <dd className="text-2xl font-black text-slate-900 tabular-nums leading-none mt-1.5">{tabs.length}</dd>
                            </div>
                            <div className="px-5 py-4">
                                <dt className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{t.oldest_debt}</dt>
                                <dd className={`text-2xl font-black tabular-nums leading-none mt-1.5 ${worstAge >= 21 ? "text-rose-600" : worstAge >= 7 ? "text-amber-800" : "text-slate-900"}`}>
                                    {worstAge}d
                                </dd>
                            </div>
                        </dl>

                        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3 items-start">
                            {tabs.map((tab) => {
                                const oldest = Math.max(0, ...tab.bills.map((b) => ageDays(b.closedAt)))
                                return (
                                    <Card key={tab.customer.id} className="p-0 gap-0 overflow-hidden">
                                        <div className="flex items-start gap-3 px-4 py-3 border-b border-slate-200 bg-slate-50">
                                            <div className="min-w-0 flex-1">
                                                <p className="font-bold text-slate-900 truncate">{tab.customer.name}</p>
                                                <p className="text-xs text-slate-500 flex items-center gap-3 mt-1">
                                                    {tab.customer.phone && (
                                                        <span className="inline-flex items-center gap-1 tabular-nums">
                                                            <Phone className="w-3 h-3" aria-hidden />
                                                            {tab.customer.phone}
                                                        </span>
                                                    )}
                                                    <span className="tabular-nums">{tab.bills.length} {t.bill}</span>
                                                    {oldest >= 7 && (
                                                        <span className={`font-bold tabular-nums ${oldest >= 21 ? "text-rose-600" : "text-amber-800"}`}>
                                                            {oldest}d
                                                        </span>
                                                    )}
                                                </p>
                                            </div>
                                            <p className="text-xl font-black text-amber-800 tabular-nums leading-none shrink-0">
                                                {formatTHB(tab.outstanding)}
                                            </p>
                                        </div>

                                        {/* Clear one night on its own, which is what a
                                            customer settling a single disputed bill wants.
                                            Secondary styling on purpose: when every row
                                            carried a filled amber button, nothing on the
                                            screen looked more important than anything else. */}
                                        <div className="divide-y divide-slate-100">
                                            {tab.bills.map((b) => (
                                                <div key={b.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                                                    <span className="font-semibold text-slate-700 shrink-0 w-14 truncate">{b.table}</span>
                                                    <span className="text-slate-400 tabular-nums text-xs shrink-0">{day(b.closedAt)}</span>
                                                    {ageDays(b.closedAt) >= 7 && (
                                                        <span className={`text-xs font-bold tabular-nums shrink-0 ${ageDays(b.closedAt) >= 21 ? "text-rose-600" : "text-amber-800"}`}>
                                                            {ageDays(b.closedAt)}d
                                                        </span>
                                                    )}
                                                    <span className="ms-auto tabular-nums font-semibold text-slate-900">
                                                        {formatTHB(b.balance)}
                                                    </span>
                                                    {/* Icon only, at every width. The label repeated
                                                        down a card of five bills was five copies of
                                                        the same word, and it was the thing that got
                                                        clipped the moment two cards shared a tablet.
                                                        The name each row needs is the table it is
                                                        for, and that is what the aria-label says. */}
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="h-9 w-10 p-0 shrink-0 text-slate-500 hover:text-amber-800 hover:border-amber-300 hover:bg-amber-50"
                                                        aria-label={`${t.settle_tab} · ${b.table}`}
                                                        title={`${t.settle_tab} · ${b.table}`}
                                                        onClick={() => router.push(`/pos/settle?session=${b.id}`)}
                                                    >
                                                        <CreditCard className="w-4 h-4" />
                                                    </Button>
                                                </div>
                                            ))}
                                        </div>

                                        {/* One payment against the customer, spread oldest
                                            first. Cash arrives as a lump - "here's ten
                                            thousand toward it" - not as a decision about
                                            which night to clear. The only filled button on
                                            the card, because it is the one that takes money. */}
                                        <div className="px-4 py-3 border-t border-slate-100">
                                            <Button
                                                className="w-full h-11 bg-amber-600 hover:bg-amber-700 text-amber-950 font-bold"
                                                onClick={() => { setPaying(tab); setAmount(String(tab.outstanding)) }}
                                            >
                                                <Banknote className="w-4 h-4 mr-2" />
                                                {t.take_payment}
                                            </Button>
                                        </div>
                                    </Card>
                                )
                            })}
                        </div>
                    </>
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
                                className="w-full h-12 bg-amber-600 hover:bg-amber-700 text-amber-950"
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
