"use client"

import { useState, useEffect, useCallback } from "react"
import { useTranslation } from "@/hooks/use-translation"
import { Header } from "@/components/header"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ReceiptDialog } from "@/components/receipt-dialog"
import {
    ChevronRight, Clock, Receipt as ReceiptIcon, Users, Ban, Search,
} from "lucide-react"
import { formatTHB } from "@/lib/currency"
import { formatDuration } from "@/lib/sessions"

type Line = {
    id: string
    name: string
    quantity: number
    total: number
    voidedAt: string | null
    voidReason: string | null
    voidNote: string | null
    voidedBy: string | null
}

type Round = {
    id: string
    number: number | null
    at: string
    status: string
    waiter: string | null
    total: number
    items: Line[]
}

type Bill = {
    id: string
    kind: "TABLE" | "WALK_IN"
    reference: string
    area: string | null
    openedAt: string
    closedAt: string | null
    servers: string[]
    staff: string[]
    rounds: number
    items: number
    voidedLines: number
    gross: number
    discount: number
    total: number
    paid: number
    tenders: { method: string; amount: number }[]
    status: string
    customer: { id: string; name: string } | null
    detail: Round[]
}

const STATUSES = ["ALL", "PAID", "PART_PAID", "TAB", "COMPED", "VOIDED", "OPEN"]

/**
 * Trading history, one row per bill.
 *
 * This listed orders, which is right for a cafe where an order is a customer is
 * a payment. In a bar 94% of orders belong to a table and a bill runs to
 * several rounds settled once - so the old page showed 531 fragments of 176
 * transactions, and called every table one CASH because a table order's
 * paymentMethod is a default nothing sets.
 *
 * A row is a bill; expanding it shows the rounds inside. Counter sales appear
 * as single-round bills so there is one history rather than two.
 */
export default function BillsPage() {
    const { t } = useTranslation()
    const [bills, setBills] = useState<Bill[]>([])
    const [loading, setLoading] = useState(true)
    const [status, setStatus] = useState("ALL")
    const [query, setQuery] = useState("")
    const [expanded, setExpanded] = useState<string | null>(null)
    const [receiptSrc, setReceiptSrc] = useState<string | null>(null)

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const params = new URLSearchParams()
            if (status !== "ALL") params.set("status", status)
            const res = await fetch(`/api/bills?${params}`)
            if (res.ok) setBills((await res.json()).bills ?? [])
        } finally {
            setLoading(false)
        }
    }, [status])

    useEffect(() => { load() }, [load])

    const statusLabel: Record<string, string> = {
        ALL: t.all_status,
        PAID: t.status_paid,
        PART_PAID: t.status_part_paid,
        TAB: t.status_tab,
        COMPED: t.status_comped,
        VOIDED: t.status_voided,
        OPEN: t.status_open,
    }

    // Colour carries the state at a glance down a long list; the label carries
    // it for anyone who cannot rely on colour.
    const statusStyle: Record<string, string> = {
        PAID: "bg-emerald-100 text-emerald-800",
        PART_PAID: "bg-amber-100 text-amber-900",
        TAB: "bg-amber-100 text-amber-900",
        COMPED: "bg-violet-100 text-violet-800",
        VOIDED: "bg-rose-100 text-rose-800",
        OPEN: "bg-sky-100 text-sky-800",
    }

    const methodLabel: Record<string, string> = {
        CASH: t.cash, ONEPAY: "BCEL QR", OWNER_VIP: t.owner_vip,
    }

    const time = (iso: string) =>
        new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB")

    const visible = bills.filter((b) => {
        const q = query.trim().toLowerCase()
        if (!q) return true
        return (
            b.reference.toLowerCase().includes(q) ||
            b.servers.some((s) => s.toLowerCase().includes(q)) ||
            (b.customer?.name.toLowerCase().includes(q) ?? false)
        )
    })

    return (
        <div className="min-h-screen bg-slate-50">
            <Header title={t.bill_history} />

            <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                    {STATUSES.map((s) => (
                        <Button
                            key={s}
                            variant={status === s ? "default" : "outline"}
                            onClick={() => setStatus(s)}
                            className={`h-10 ${status === s ? "bg-amber-600 hover:bg-amber-700 font-bold" : ""}`}
                        >
                            {statusLabel[s]}
                        </Button>
                    ))}
                    <div className="relative ms-auto">
                        <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                        <Input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder={t.search}
                            className="h-10 ps-9 w-56 rounded-xl"
                        />
                    </div>
                </div>

                {loading ? (
                    <div className="space-y-2">
                        {[0, 1, 2].map((i) => (
                            <div key={i} className="h-20 rounded-xl bg-white border border-slate-200 animate-pulse" />
                        ))}
                    </div>
                ) : visible.length === 0 ? (
                    <div className="text-center py-20">
                        <div className="w-12 h-12 rounded-full bg-slate-100 grid place-items-center mx-auto mb-3">
                            <ReceiptIcon className="w-6 h-6 text-slate-400" />
                        </div>
                        <p className="text-slate-900 font-semibold">{t.no_bills_found}</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {visible.map((b) => {
                            const open = expanded === b.id
                            return (
                                <Card key={b.id} className="overflow-hidden">
                                    <button
                                        onClick={() => setExpanded(open ? null : b.id)}
                                        className="w-full text-start p-4 hover:bg-slate-50 transition-colors duration-150"
                                    >
                                        <div className="flex items-start gap-3 flex-wrap">
                                            <ChevronRight
                                                className={`w-5 h-5 mt-1 text-slate-400 shrink-0 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
                                            />
                                            <div className="min-w-0">
                                                <p className="font-black text-lg text-slate-900 leading-none">
                                                    {b.reference}
                                                    {b.kind === "WALK_IN" && (
                                                        <span className="ms-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                                                            {t.walk_in}
                                                        </span>
                                                    )}
                                                    {b.area && (
                                                        <span className="ms-2 text-xs font-bold text-slate-400">{b.area}</span>
                                                    )}
                                                </p>
                                                <p className="text-sm text-slate-500 mt-1.5 flex items-center gap-x-3 gap-y-1 flex-wrap">
                                                    <span className="tabular-nums">
                                                        {day(b.openedAt)} {time(b.openedAt)}
                                                        {b.closedAt && ` → ${time(b.closedAt)}`}
                                                    </span>
                                                    {b.closedAt && (
                                                        <span className="inline-flex items-center gap-1 tabular-nums">
                                                            <Clock className="w-3.5 h-3.5" />
                                                            {formatDuration(b.openedAt, new Date(b.closedAt))}
                                                        </span>
                                                    )}
                                                    {b.servers.length > 0 && (
                                                        <span className="inline-flex items-center gap-1">
                                                            <Users className="w-3.5 h-3.5" />
                                                            {b.servers.join(", ")}
                                                        </span>
                                                    )}
                                                    <span className="tabular-nums">
                                                        {b.rounds} {t.rounds_label} · {b.items} {t.items_label}
                                                    </span>
                                                    {b.voidedLines > 0 && (
                                                        <span className="inline-flex items-center gap-1 text-rose-600 font-bold">
                                                            <Ban className="w-3.5 h-3.5" />
                                                            {b.voidedLines} {t.voided_lines}
                                                        </span>
                                                    )}
                                                </p>
                                            </div>

                                            <div className="ms-auto text-end shrink-0">
                                                <p className="text-2xl font-black text-slate-900 tabular-nums leading-none">
                                                    {formatTHB(b.total)}
                                                </p>
                                                {/* What actually settled it. A single method column
                                                    could never say "500 cash and 3,680 by QR", which
                                                    is 17% of the bills here. */}
                                                <p className="text-xs text-slate-500 mt-1.5 tabular-nums">
                                                    {b.tenders.length > 0
                                                        ? b.tenders.map((x) => `${formatTHB(x.amount)} ${methodLabel[x.method] ?? x.method}`).join(" + ")
                                                        : b.customer
                                                            ? b.customer.name
                                                            : "—"}
                                                </p>
                                            </div>

                                            <span className={`shrink-0 self-start px-2.5 py-1 rounded-md text-xs font-bold ${statusStyle[b.status] ?? "bg-slate-100 text-slate-700"}`}>
                                                {statusLabel[b.status] ?? b.status}
                                            </span>
                                        </div>
                                    </button>

                                    {open && (
                                        <div className="border-t border-slate-200 bg-slate-50/60 divide-y divide-slate-200">
                                            {b.detail.map((r) => (
                                                <div key={r.id} className="px-4 py-3">
                                                    <div className="flex items-baseline gap-2 text-xs font-bold text-slate-500">
                                                        <span>
                                                            {r.number != null ? `${t.round_no} #${r.number}` : t.walk_in}
                                                        </span>
                                                        <span className="tabular-nums">{time(r.at)}</span>
                                                        {r.waiter && <span>· {r.waiter}</span>}
                                                        {r.status === "CANCELLED" && (
                                                            <span className="text-rose-600">· {t.state_void}</span>
                                                        )}
                                                        <span className="ms-auto tabular-nums text-slate-700">
                                                            {formatTHB(r.total)}
                                                        </span>
                                                    </div>
                                                    <div className="mt-2 space-y-1">
                                                        {r.items.map((i) => {
                                                            const struck = Boolean(i.voidedAt) || r.status === "CANCELLED"
                                                            return (
                                                                <div key={i.id} className="flex items-baseline gap-3 text-sm">
                                                                    <span className="w-6 tabular-nums text-slate-500 shrink-0">
                                                                        {i.quantity}
                                                                    </span>
                                                                    <span className={struck ? "line-through text-slate-400" : "text-slate-900"}>
                                                                        {i.name}
                                                                    </span>
                                                                    {i.voidedAt && (
                                                                        <span className="text-[11px] text-rose-600 truncate">
                                                                            {(t[`void_${(i.voidReason ?? "").toLowerCase()}` as keyof typeof t] as string) ?? i.voidReason}
                                                                            {i.voidedBy ? ` · ${i.voidedBy}` : ""}
                                                                        </span>
                                                                    )}
                                                                    <span className={`ms-auto tabular-nums shrink-0 ${struck ? "line-through text-slate-400" : "text-slate-700"}`}>
                                                                        {formatTHB(i.total)}
                                                                    </span>
                                                                </div>
                                                            )
                                                        })}
                                                    </div>
                                                </div>
                                            ))}

                                            <div className="px-4 py-3 flex items-center gap-3">
                                                {b.discount > 0 && (
                                                    <span className="text-sm text-rose-600 font-bold tabular-nums">
                                                        {t.discount} −{formatTHB(b.discount)}
                                                    </span>
                                                )}
                                                <Button
                                                    variant="outline"
                                                    className="ms-auto h-10"
                                                    onClick={() =>
                                                        setReceiptSrc(
                                                            b.kind === "TABLE"
                                                                ? `/receipt?session=${b.id}`
                                                                : `/receipt?id=${b.id}`
                                                        )
                                                    }
                                                >
                                                    <ReceiptIcon className="w-4 h-4 mr-2" />
                                                    {t.receipt}
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                </Card>
                            )
                        })}
                    </div>
                )}
            </div>

            <ReceiptDialog src={receiptSrc} onClose={() => setReceiptSrc(null)} />
        </div>
    )
}
