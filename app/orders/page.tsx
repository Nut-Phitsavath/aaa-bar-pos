"use client"

import { useState, useEffect, useCallback } from "react"
import { useTranslation } from "@/hooks/use-translation"
import { Header } from "@/components/header"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { startOfDay, endOfDay, format, isSameDay } from "date-fns"
import type { DateRange } from "react-day-picker"
import { ReceiptDialog } from "@/components/receipt-dialog"
import { ManagerApproval } from "@/components/manager-approval"
import { toast } from "sonner"
import {
    ChevronRight, Clock, Receipt as ReceiptIcon, Users, Ban, Search,
    Calendar as CalendarIcon,
} from "lucide-react"
import { formatTHB } from "@/lib/currency"
import { SwapSummary } from "@/components/pos/swap-summary"
import { formatDuration } from "@/lib/sessions"

type Line = {
    id: string
    name: string
    quantity: number
    total: number
    voidedAt: string | null
    swaps?: { lines: { direction: string; name: string; quantity: number }[] }[]
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
    payments: {
        id: string; method: string; amount: number; paymentStatus: string | null
        voidedAt: string | null; voidReason: string | null; voidedBy: string | null; at: string
    }[]
    reopenedAt: string | null
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
    const [method, setMethod] = useState("ALL")
    const [query, setQuery] = useState("")
    const [expanded, setExpanded] = useState<string | null>(null)
    const [receiptSrc, setReceiptSrc] = useState<string | null>(null)
    // A range, not a day: "this week" and "the weekend" are questions a manager
    // asks as often as "last night". Opens on today, so the common case is one
    // tap and the range is there when it is wanted. Same picker the reports
    // page uses, so there is one way to choose dates in this app.
    const [range, setRange] = useState<DateRange | undefined>({
        from: new Date(),
        to: new Date(),
    })
    const [revenue, setRevenue] = useState(0)
    const [exceptions, setExceptions] = useState<{
        discountTotal: number; discountCount: number
        compedTotal: number; compedCount: number
        voidedLines: number; owedTotal: number; tabCount: number
    } | null>(null)
    // Reopening a bill and handing a tender back both move money a shift has
    // counted, so both go through the manager approval comps already use.
    const [pending, setPending] = useState<
        { kind: "REOPEN"; billId: string } | { kind: "REFUND"; paymentId: string } | null
    >(null)
    const [approvalError, setApprovalError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const [reasonText, setReasonText] = useState("")

    const load = useCallback(async () => {
        setLoading(true)
        try {
            // An open-ended range (a first click with no second yet) reads as
            // that single day rather than as everything since it.
            const from = range?.from ?? new Date()
            const to = range?.to ?? from
            const params = new URLSearchParams({
                startDate: startOfDay(from).toISOString(),
                endDate: endOfDay(to).toISOString(),
            })
            if (status !== "ALL") params.set("status", status)
            if (method !== "ALL") params.set("method", method)
            const res = await fetch(`/api/bills?${params}`)
            if (res.ok) {
                const data = await res.json()
                setBills(data.bills ?? [])
                setRevenue(data.totals?.revenue ?? 0)
                setExceptions(data.exceptions ?? null)
            }
        } finally {
            setLoading(false)
        }
    }, [status, method, range])

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

    const runApproved = async (creds: { managerUsername: string; managerPin: string }) => {
        if (!pending) return
        setBusy(true)
        setApprovalError(null)
        try {
            const url = pending.kind === "REOPEN"
                ? `/api/table-sessions/${pending.billId}/reopen`
                : `/api/payments/${pending.paymentId}/refund`
            const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...creds, reason: reasonText.trim() }),
            })
            const data = await res.json().catch(() => ({}))
            if (res.status === 403 || res.status === 429) {
                setApprovalError(data.error === "TOO_MANY_ATTEMPTS" ? t.too_many_attempts : t.invalid_approval)
                return
            }
            setPending(null)
            if (!res.ok) { toast.error(data.error || t.error); return }
            toast.success(pending.kind === "REOPEN" ? t.reopen_bill : t.refunded)
            setReasonText("")
            await load()
        } finally { setBusy(false) }
    }

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

            {/* Full width, not a centred column. The shell already animates its
                left padding between 260px and 80px as the sidebar collapses, so
                the page only has to stop capping itself to follow along. The
                outer cap is there to stop an ultrawide screen stretching a row
                until its table name and its total are a foot apart. */}
            <div className="p-4 md:p-6 w-full max-w-[1800px] space-y-4">
                {/* Which night. The old page had this and I dropped it in the
                    rewrite; without it the page loads all history and grows
                    into something nobody can read. */}
                <div className="flex flex-wrap items-center gap-3 bg-white p-3 rounded-xl border shadow-sm">
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button
                                variant="outline"
                                className="h-11 gap-2 font-bold border-amber-200 text-amber-900 bg-amber-50 hover:bg-amber-100"
                            >
                                <CalendarIcon className="w-4 h-4" />
                                {range?.from
                                    ? range.to && !isSameDay(range.from, range.to)
                                        ? `${format(range.from, "d MMM yyyy")} – ${format(range.to, "d MMM yyyy")}`
                                        : format(range.from, "d MMM yyyy")
                                    : t.select_date_range}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                                initialFocus
                                mode="range"
                                defaultMonth={range?.from}
                                selected={range}
                                onSelect={setRange}
                                numberOfMonths={2}
                            />
                        </PopoverContent>
                    </Popover>
                    <Button
                        variant="outline"
                        className="h-11 text-amber-700 hover:text-amber-800"
                        onClick={() => setRange({ from: new Date(), to: new Date() })}
                    >
                        {t.today}
                    </Button>

                    {/* By tender, so a split bill answers to both. */}
                    <div className="flex items-center gap-1.5">
                        {["ALL", "CASH", "ONEPAY", "OWNER_VIP"].map((m) => (
                            <Button
                                key={m}
                                variant="ghost"
                                onClick={() => setMethod(m)}
                                className={`h-9 px-3 text-xs font-bold border ${method === m ? "bg-slate-800 text-white border-slate-800 hover:bg-slate-800 hover:text-white" : "border-slate-200"}`}
                            >
                                {m === "ALL" ? t.all_status : methodLabel[m] ?? m}
                            </Button>
                        ))}
                    </div>

                    <div className="ms-auto text-end">
                        <p className="text-sm font-medium text-slate-500">
                            {visible.length} {t.bills}
                        </p>
                        <p className="text-lg font-black text-slate-900 tabular-nums leading-none">
                            {formatTHB(revenue)}
                        </p>
                    </div>
                </div>

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

                {/* The morning read. Every figure here already existed, buried
                    one bill at a time inside an expanded row - a manager could
                    not ask "what did we give away last night" without opening
                    them all. Only shown when there is something to report. */}
                {exceptions && (exceptions.discountTotal > 0 || exceptions.compedTotal > 0 || exceptions.voidedLines > 0 || exceptions.owedTotal > 0) && (
                    <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 rounded-xl border-2 border-amber-200 bg-amber-50/60 p-3">
                        {[
                            { label: t.discounts_given, value: formatTHB(exceptions.discountTotal), sub: `${exceptions.discountCount} ${t.bills}` },
                            { label: t.comped_away, value: formatTHB(exceptions.compedTotal), sub: `${exceptions.compedCount} ${t.bills}` },
                            { label: t.status_voided, value: String(exceptions.voidedLines), sub: t.items_label },
                            { label: t.still_owed, value: formatTHB(exceptions.owedTotal), sub: `${exceptions.tabCount} ${t.status_tab}` },
                        ].map((x) => (
                            <div key={x.label}>
                                <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700/80">{x.label}</p>
                                <p className="text-xl font-black text-slate-900 tabular-nums mt-1 leading-none">{x.value}</p>
                                <p className="text-[11px] text-slate-500 mt-1">{x.sub}</p>
                            </div>
                        ))}
                    </div>
                )}

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
                    <div className="space-y-2 @container">
                        {visible.map((b) => {
                            const open = expanded === b.id
                            return (
                                <Card key={b.id} className="overflow-hidden">
                                    <button
                                        onClick={() => setExpanded(open ? null : b.id)}
                                        className="w-full text-start p-4 hover:bg-slate-50 transition-colors duration-150"
                                    >
                                        {/* A grid, not a flex row: the money and the
                                            status then line up down the whole list
                                            instead of landing wherever each row's
                                            text happens to end. The middle column is
                                            minmax(0,1fr) so it absorbs the width the
                                            sidebar gives back when it collapses. */}
                                        <div className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] @2xl:grid-cols-[1.25rem_minmax(0,1fr)_auto_6.5rem] @5xl:grid-cols-[1.25rem_minmax(14rem,1fr)_minmax(0,1fr)_auto_6.5rem] gap-x-4 gap-y-2 items-start">
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

                                            {/* What actually settled it, in its own column from lg
                                                up. A single method column could never say "2,597 by
                                                QR and 1,248 cash", which is 17% of the bills here -
                                                and giving it the room the sidebar frees up puts
                                                something readable in the middle of a wide row
                                                instead of a stretch of white. */}
                                            <p className="hidden @5xl:block text-sm text-slate-500 tabular-nums self-center">
                                                {b.tenders.length > 0
                                                    ? b.tenders.map((x) => `${formatTHB(x.amount)} ${methodLabel[x.method] ?? x.method}`).join("  +  ")
                                                    : b.customer
                                                        ? b.customer.name
                                                        : "—"}
                                            </p>

                                            <div className="text-end shrink-0">
                                                <p className="text-2xl font-black text-slate-900 tabular-nums leading-none">
                                                    {formatTHB(b.total)}
                                                </p>
                                                {/* Below lg the tenders tuck under the total instead
                                                    of claiming a column there is no room for. */}
                                                <p className="@5xl:hidden text-xs text-slate-500 mt-1.5 tabular-nums">
                                                    {b.tenders.length > 0
                                                        ? b.tenders.map((x) => `${formatTHB(x.amount)} ${methodLabel[x.method] ?? x.method}`).join(" + ")
                                                        : b.customer
                                                            ? b.customer.name
                                                            : "—"}
                                                </p>
                                            </div>

                                            {/* Its own column from sm up, so the badges
                                                form a readable stripe down the list.
                                                Below that it tucks under the amount
                                                rather than squeezing both. */}
                                            <span className={`col-start-3 @2xl:col-start-4 @5xl:col-start-5 justify-self-end @2xl:justify-self-start shrink-0 self-start px-2.5 py-1 rounded-md text-xs font-bold whitespace-nowrap ${statusStyle[b.status] ?? "bg-slate-100 text-slate-700"}`}>
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
                                                              <div key={i.id}>
                                                                <div className="flex items-baseline gap-3 text-sm">
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
                                                                {/* The same two lines the ticket and
                                                                    the printed slip showed (req #9). */}
                                                                <div className="ps-9">
                                                                    <SwapSummary swaps={i.swaps} struck={struck} />
                                                                </div>
                                                              </div>
                                                            )
                                                        })}
                                                    </div>
                                                </div>
                                            ))}

                                            {/* Each tender on its own line, refundable on its
                                                own: 17% of bills are split, and a customer may
                                                want the cash back while the QR leg stands. */}
                                            {b.payments.length > 0 && (
                                                <div className="px-4 py-3 space-y-1.5">
                                                    {b.payments.map((pmt) => (
                                                        <div key={pmt.id} className="flex items-center gap-3 text-sm">
                                                            <span className={`tabular-nums ${pmt.voidedAt ? "line-through text-slate-400" : "text-slate-800 font-semibold"}`}>
                                                                {formatTHB(pmt.amount)}
                                                            </span>
                                                            <span className="text-slate-500">{methodLabel[pmt.method] ?? pmt.method}</span>
                                                            <span className="text-slate-400 tabular-nums">{time(pmt.at)}</span>
                                                            {pmt.voidedAt ? (
                                                                <span className="text-xs text-rose-600 truncate">
                                                                    {t.refunded}{pmt.voidedBy ? ` · ${pmt.voidedBy}` : ""}{pmt.voidReason ? ` · ${pmt.voidReason}` : ""}
                                                                </span>
                                                            ) : (
                                                                <Button
                                                                    variant="outline"
                                                                    className="ms-auto h-9 text-rose-600 border-rose-200 hover:bg-rose-50"
                                                                    onClick={() => { setReasonText(""); setApprovalError(null); setPending({ kind: "REFUND", paymentId: pmt.id }) }}
                                                                >
                                                                    {t.refund}
                                                                </Button>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            <div className="px-4 py-3 flex items-center gap-3 flex-wrap">
                                                {b.discount > 0 && (
                                                    <span className="text-sm text-rose-600 font-bold tabular-nums">
                                                        {t.discount} −{formatTHB(b.discount)}
                                                    </span>
                                                )}
                                                {b.reopenedAt && (
                                                    <span className="text-xs font-bold text-amber-700">
                                                        {t.reopen_bill} · {time(b.reopenedAt)}
                                                    </span>
                                                )}
                                                {/* Offered on any settled table bill; the server
                                                    refuses one from a shift already counted. */}
                                                {b.kind === "TABLE" && b.status !== "OPEN" && (
                                                    <Button
                                                        variant="outline"
                                                        className="h-10"
                                                        onClick={() => { setReasonText(""); setApprovalError(null); setPending({ kind: "REOPEN", billId: b.id }) }}
                                                    >
                                                        {t.reopen_bill}
                                                    </Button>
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

            {/* Both operations move money a shift has counted, so both take the
                same manager approval a comp does - and both state a reason,
                because the point of doing this here is the audit trail. */}
            <ManagerApproval
                open={!!pending}
                title={pending?.kind === "REOPEN" ? t.reopen_bill : t.refund}
                description={pending?.kind === "REOPEN" ? t.manager_reopens_bill : t.manager_refunds}
                busy={busy}
                error={approvalError}
                onCancel={() => { setPending(null); setApprovalError(null); setReasonText("") }}
                onApprove={runApproved}
            >
                {/* Labelled, because unlabelled and sitting above the manager
                    selector it reads as a username field - which is exactly how
                    it got a staff login typed into it. */}
                <div>
                    <label className="text-sm text-slate-600">
                        {pending?.kind === "REOPEN" ? t.reopen_reason : t.refund_reason}
                    </label>
                    <Input
                        value={reasonText}
                        onChange={(e) => setReasonText(e.target.value)}
                        placeholder={t.reason_example}
                        className="h-12 mt-1 autofill:shadow-[inset_0_0_0_1000px_white]"
                        autoComplete="off"
                        name="approval-reason"
                        data-lpignore="true"
                        data-1p-ignore
                        data-form-type="other"
                        autoFocus
                    />
                </div>
            </ManagerApproval>
        </div>
    )
}
