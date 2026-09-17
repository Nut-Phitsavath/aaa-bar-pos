"use client"

import { useState, useEffect, useCallback, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useTranslation } from "@/hooks/use-translation"
import { useCustomerDisplay } from "@/hooks/use-customer-display"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ManagerApproval } from "@/components/manager-approval"
import { ReceiptDialog } from "@/components/receipt-dialog"
import { ReturnsDialog } from "@/components/pos/returns-dialog"
import { QRCodeSVG } from "qrcode.react"
import { Banknote, QrCode, Gift, Clock3, Printer, Percent, Tag, ArrowLeft, Check, PackageOpen } from "lucide-react"
import { formatTHB, formatLAK, thbToLak } from "@/lib/currency"
import { toast } from "sonner"

type SettleOrder = {
    id: string
    status: string
    total: number
    createdAt: string
    tableOrderNumber: number | null
    waiter: { id: string; name: string } | null
    user: { id: string; name: string } | null
    items: { id: string; name: string; localName: string | null; quantity: number; total: number; voidedAt: string | null }[]
}

type SettleBill = {
    id: string
    status: string
    table: { name: string; area: string }
    orders: SettleOrder[]
    payments: { id: string; method: string; amount: number; paymentStatus: string | null }[]
    gross: number
    /** A promotion on this bill, if one is on. */
    promoId: string | null
    promoName: string | null
    promoDiscount: number
    discount: number
    total: number
    balance: number
    fxRateLAK: number
}

/** The notes a customer actually hands over. */
const QUICK_NOTES = [100, 500, 1000]

/**
 * Settling a table bill. The only place money is taken.
 *
 * Three columns because a till screen is wide: the rounds on the left, the
 * amount and keypad in the middle, the tenders down the right where they are
 * always in the same place regardless of how long the bill is.
 *
 * Rounds are selectable, and selecting them adds their totals into the amount.
 * That is a calculator for "these two rounds, please" - a common way a table
 * pays - not an allocation of money to particular orders. Paying by item is
 * split-billing, which is a separate job.
 */
function SettleScreen() {
    const { t } = useTranslation()
    const router = useRouter()
    const params = useSearchParams()
    const sessionId = params.get("session")

    const [bill, setBill] = useState<SettleBill | null>(null)
    const [entry, setEntry] = useState("")
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const [busy, setBusy] = useState(false)
    const [pendingQr, setPendingQr] = useState<{ paymentId: string; qr: string; amount: number } | null>(null)
    // The shop's own bank QR, uploaded in settings. Held here while the
    // customer scans it, and only written as a tender once staff confirm.
    const [transferAmount, setTransferAmount] = useState<number | null>(null)
    const [transferQrUrl, setTransferQrUrl] = useState<string | null>(null)
    const [returningOpen, setReturningOpen] = useState(false)
    const [receiptSrc, setReceiptSrc] = useState<string | null>(null)
    // A settled bill returns to the floor plan - but only once the slip has
    // been dealt with. Navigating straight away would unmount the dialog under
    // the staff member; the old popup window survived it, a modal does not.
    const [returnAfterReceipt, setReturnAfterReceipt] = useState(false)

    type Approvable = "DISCOUNT" | "COMP" | "PAY_LATER"
    const [approving, setApproving] = useState<Approvable | null>(null)
    const [approvalError, setApprovalError] = useState<string | null>(null)
    const [promoOpen, setPromoOpen] = useState(false)
    const [promos, setPromos] = useState<any[]>([])

    const [discountOpen, setDiscountOpen] = useState(false)
    const [discountKind, setDiscountKind] = useState<"PERCENT" | "FIXED">("PERCENT")

    /**
     * A promotion is a price the owner already set, with its own window and
     * minimum, so applying one needs no manager PIN - unlike the manual
     * discount beside it, which is a decision made at the table and wants a
     * name against it.
     */
    const openPromo = async () => {
        setPromoOpen(true)
        try {
            const res = await fetch("/api/promotions")
            if (res.ok) setPromos(await res.json())
        } catch { setPromos([]) }
    }

    /**
     * Which deals staff may choose from the list.
     *
     * Live, in window, and not a customer coupon. The coupon check was missing
     * and every "code only" promotion in the system sat in this picker waiting
     * to be handed out by whoever was on the till.
     */
    const pickable = (p: any) =>
        p.isActive &&
        p.staffPickable !== false &&
        new Date(p.startDate) <= new Date() &&
        new Date(p.endDate) >= new Date()

    const applyPromo = async (promoId: string | null) => {
        try {
            const res = await fetch(`/api/table-sessions/${bill!.id}/promo`, {
                method: promoId ? "POST" : "DELETE",
                headers: { "Content-Type": "application/json" },
                ...(promoId ? { body: JSON.stringify({ promoId }) } : {}),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) { toast.error(data.error || t.error); return }
            // A deal can be on and worth nothing yet - the round that meets its
            // minimum may not be rung in - so say which happened rather than
            // letting a £0 saving read as a failure.
            if (promoId && data.qualifies === false) toast.warning(t.promo_not_qualified)
            else toast.success(promoId ? t.promo_applied : t.promo_removed)
            setPromoOpen(false)
            await load()
        } catch { toast.error(t.error) }
    }
    const [discountInput, setDiscountInput] = useState("")
    const [tabCustomerId, setTabCustomerId] = useState("")
    const [customers, setCustomers] = useState<{ id: string; name: string }[]>([])

    /**
     * A settled bill always prints a receipt.
     *
     * The bill printed before payment cannot carry a close timestamp, because
     * it has not happened yet - so without this, requirement #3 never reaches
     * paper. Fires for a comp and a tab too: a comped table still wants a slip
     * showing zero, and a tab wants one showing what is owed.
     */
    const printSettled = useCallback(() => {
        setReceiptSrc(`/receipt?session=${sessionId}`)
    }, [sessionId])

    const load = useCallback(async () => {
        if (!sessionId) { router.push("/tables"); return }
        const res = await fetch(`/api/table-sessions/${sessionId}`)
        if (!res.ok) { router.push("/tables"); return }
        setBill(await res.json())
    }, [sessionId, router])

    useEffect(() => { load() }, [load])
    useCustomerDisplay(bill as any)

    useEffect(() => {
        fetch("/api/settings")
            .then((r) => (r.ok ? r.json() : {}))
            .then((s: any) => setTransferQrUrl(s?.transfer_qr_url ?? null))
            .catch(() => setTransferQrUrl(null))
    }, [])

    // BCEL has no callback into this app; the till asks until the bank says yes.
    useEffect(() => {
        if (!pendingQr) return
        let stop = false
        const poll = setInterval(async () => {
            try {
                const res = await fetch(`/api/payments/onepay/session-status/${pendingQr.paymentId}`)
                if (!res.ok) return
                const data = await res.json()
                if (data.status === "PAID" && !stop) {
                    stop = true
                    clearInterval(poll)
                    setPendingQr(null)
                    setSelected(new Set())
                    if (data.closed) { setReturnAfterReceipt(true); printSettled(); toast.success(t.session_closed); return }
                    toast.success(t.payment_confirmed)
                    await load()
                }
            } catch {
                // A dropped poll is not a failed payment.
            }
        }, 3000)
        return () => { stop = true; clearInterval(poll) }
    }, [pendingQr, load, router, t])

    if (!bill) return <div className="h-screen grid place-items-center text-slate-400">…</div>

    const rounds = bill.orders
        .filter((o) => o.status !== "HOLD" && o.status !== "CANCELLED")
        .sort((a, b) => (a.tableOrderNumber ?? 0) - (b.tableOrderNumber ?? 0))

    const selectedTotal = rounds
        .filter((o) => selected.has(o.id))
        .reduce((sum, o) => sum + o.total, 0)

    // Typing beats a selection; a selection beats the default of "all of it".
    const typed = Number(entry) || 0
    const tendering = entry !== ""
        ? typed
        : selected.size > 0
            ? Math.min(selectedTotal, bill.balance)
            : bill.balance

    // Nothing typed and nothing selected: the row reads zero, because zero is
    // what has been handed over.
    //
    // A tender is refused in this state rather than quietly charging the whole
    // balance. Taking money the screen says is zero is how a bill gets marked
    // paid for cash that never crossed the counter, and a QR generated this way
    // asks the customer's bank for an amount nobody at the till ever read.
    // "Pay all" fills the field in one tap, so settling in full is still two
    // taps and the amount is on screen before it is taken.
    const untouched = entry === "" && selected.size === 0
    const shown = untouched ? 0 : tendering

    const paid = bill.total - bill.balance

    const toggle = (id: string) => {
        setEntry("")
        setSelected((prev) => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    const takePayment = async (method: "CASH" | "ONEPAY" | "TRANSFER") => {
        // The shop's own bank QR has no API behind it, so the customer has to
        // scan and the staff member has to look at their phone before this is
        // money. Showing the code first and recording second is the order the
        // walk-in till already works in.
        if (method === "TRANSFER") {
            setTransferAmount(tendering)
            new BroadcastChannel("pos_channel").postMessage({ type: "TRANSFER_SELECTED" })
            return
        }
        setBusy(true)
        try {
            const res = await fetch(`/api/table-sessions/${bill.id}/payments`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ method, amount: tendering }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) { toast.error(data.error || "Failed"); return }
            setEntry("")
            setSelected(new Set())

            if (method === "CASH") {
                if (data.closed) { setReturnAfterReceipt(true); printSettled(); toast.success(t.session_closed); return }
                toast.success(t.payment_confirmed)
                await load()
                return
            }

            const gen = await fetch("/api/payments/onepay/session-generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ paymentId: data.payment.id }),
            })
            const genData = await gen.json().catch(() => ({}))
            if (!gen.ok) { toast.error(genData.error || "Failed"); await load(); return }
            setPendingQr({ paymentId: data.payment.id, qr: genData.qrCode, amount: tendering })
        } finally { setBusy(false) }
    }

    /** The staff member has seen the money arrive; write it as a tender. */
    const confirmTransfer = async () => {
        if (transferAmount === null) return
        setBusy(true)
        try {
            const res = await fetch(`/api/table-sessions/${bill.id}/payments`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ method: "TRANSFER", amount: transferAmount }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) { toast.error(data.error || "Failed"); return }
            closeTransfer()
            setEntry("")
            setSelected(new Set())
            if (data.closed) { setReturnAfterReceipt(true); printSettled(); toast.success(t.session_closed); return }
            toast.success(t.payment_confirmed)
            await load()
        } finally { setBusy(false) }
    }

    const closeTransfer = () => {
        setTransferAmount(null)
        // Puts the customer screen back to the bill.
        new BroadcastChannel("pos_channel").postMessage({ type: "PAYMENT_COMPLETE" })
    }

    const runApproved = async (creds: { managerUsername: string; managerPin: string }) => {
        if (!approving) return
        setBusy(true)
        setApprovalError(null)
        try {
            const actions: Record<Approvable, { url: string; method: string; body: any }> = {
                DISCOUNT: {
                    url: `/api/table-sessions/${bill.id}/discount`, method: "PUT",
                    body: { discountType: discountKind, discountValue: Number(discountInput) },
                },
                COMP: { url: `/api/table-sessions/${bill.id}/comp`, method: "POST", body: {} },
                PAY_LATER: {
                    url: `/api/table-sessions/${bill.id}/pay-later`, method: "POST",
                    body: { customerId: tabCustomerId },
                },
            }
            const a = actions[approving]
            const res = await fetch(a.url, {
                method: a.method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...a.body, ...creds }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) {
                if (res.status === 403 || res.status === 429) {
                    setApprovalError(data.error === "TOO_MANY_ATTEMPTS" ? t.too_many_attempts : t.invalid_approval)
                } else { setApproving(null); toast.error(data.error || "Failed") }
                return
            }
            setApproving(null); setDiscountOpen(false); setTabCustomerId("")
            if (approving === "PAY_LATER" || data.closed) {
                setReturnAfterReceipt(true)
                printSettled()
                toast.success(approving === "PAY_LATER" ? t.pay_later : t.session_closed)
                return
            }
            await load()
        } finally { setBusy(false) }
    }

    const printBill = async () => {
        setBusy(true)
        try {
            const res = await fetch(`/api/table-sessions/${bill.id}/print`, { method: "POST" })
            const data = await res.json().catch(() => ({}))
            if (data.qrError) toast.error(data.qrError)
            setReceiptSrc(`/receipt?session=${bill.id}`)
            await load()
        } finally { setBusy(false) }
    }
    // Filled keys on a hairline grid: an outlined pad on a wide screen reads as
    // empty space with buttons floating in it. Dense and edge to edge is what
    // makes a till screen feel like a till.
    // Filled so the pad reads as a solid block rather than buttons floating in
    // whitespace, but light: digits are input, not the point. The loudest thing
    // on this screen has to be how the money is taken - Cash and the QR - and a
    // near-black keypad outweighed both.
    const digit = "text-3xl font-black bg-slate-100 text-slate-900 hover:bg-amber-100 transition-colors"
    const side = "text-base font-bold bg-white text-slate-700 hover:bg-amber-50 transition-colors"

    return (
        <div className="h-screen flex gap-px bg-slate-300 overflow-hidden">
            {/* The rounds. Tapping one adds its total to what you are taking. */}
            <aside className="w-[340px] xl:w-[400px] bg-white flex flex-col shrink-0">
                <div className="px-3 py-2.5 border-b flex items-center gap-2.5 shrink-0">
                    <button
                        onClick={() => router.push(`/pos?session=${bill.id}`)}
                        aria-label={t.back}
                        className="h-9 w-9 grid place-items-center rounded-lg text-slate-500 hover:bg-slate-100 transition-colors shrink-0"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                    <div className="bg-slate-900 text-white rounded-lg px-3 py-1 leading-none shrink-0">
                        <span className="text-2xl font-black">{bill.table.name}</span>
                    </div>
                    <span className="text-sm font-bold text-slate-500 truncate">{bill.table.area}</span>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {rounds.map((order) => {
                        const on = selected.has(order.id)
                        return (
                            <button
                                key={order.id}
                                onClick={() => toggle(order.id)}
                                className={`w-full text-start border-b transition-colors duration-150 ${on ? "bg-amber-50 border-amber-200" : "bg-white border-slate-100 hover:bg-slate-50"
                                    }`}
                            >
                                <div className={`flex items-center gap-2 px-3 py-2 ${on ? "text-amber-900" : "text-slate-600"}`}>
                                    <span className={`w-6 h-6 rounded-md border-2 grid place-items-center shrink-0 ${on ? "bg-amber-500 border-amber-500 text-white" : "border-slate-300"
                                        }`}>
                                        {on && <Check className="w-4 h-4" />}
                                    </span>
                                    <span className="font-black text-base shrink-0">
                                        {t.round_no} #{order.tableOrderNumber ?? "-"}
                                    </span>
                                    <span className="text-sm truncate">{order.waiter?.name || "—"}</span>
                                    <span className="ms-auto font-black text-lg tabular-nums shrink-0">
                                        {formatTHB(order.total)}
                                    </span>
                                </div>
                                <ul className="pb-2 ps-11 pe-3 space-y-0.5">
                                    {/* Struck lines are gone from the round total
                                        already, so listing them at full price beside
                                        a smaller total invites the question the
                                        screen cannot answer. The printed bill drops
                                        them for the same reason; history and the
                                        void report are where they are kept. */}
                                    {order.items.filter((i) => !i.voidedAt).map((i) => (
                                        <li key={i.id} className="flex justify-between gap-3 text-base text-slate-700">
                                            <span className="min-w-0 truncate">
                                                <span className="tabular-nums font-bold text-slate-400 me-2">{i.quantity}</span>
                                                {i.localName || i.name}
                                            </span>
                                            <span className="tabular-nums shrink-0">{formatTHB(i.total)}</span>
                                        </li>
                                    ))}
                                </ul>
                            </button>
                        )
                    })}
                </div>

                <div className="border-t px-3 py-2.5 shrink-0">
                    {bill.promoDiscount > 0 && (
                        <div className="flex justify-between text-sm text-rose-600">
                            <span className="truncate">{bill.promoName ?? t.apply_promo}</span>
                            <span className="tabular-nums shrink-0">− {formatTHB(bill.promoDiscount)}</span>
                        </div>
                    )}
                    {bill.discount > 0 && (
                        <div className="flex justify-between text-sm text-rose-600">
                            <span>{t.apply_discount}</span>
                            <span className="tabular-nums">− {formatTHB(bill.discount)}</span>
                        </div>
                    )}
                    {paid > 0 && (
                        <div className="flex justify-between text-sm text-emerald-600">
                            <span>{t.amount_paid}</span>
                            <span className="tabular-nums">− {formatTHB(paid)}</span>
                        </div>
                    )}
                    <div className="flex items-baseline justify-between">
                        <span className="text-base font-black text-rose-600">{t.balance_due}</span>
                        <span className="text-2xl font-black text-rose-600 tabular-nums">{formatTHB(bill.balance)}</span>
                    </div>
                </div>
            </aside>

            {/* Notes a customer hands over, plus the whole balance at the foot.
                One button, not two: on an untouched bill "the full amount" and
                "the exact amount" are the same number, and a second control for
                the same outcome is just something else to read. */}
            <div className="w-[104px] flex flex-col gap-px shrink-0">
                {QUICK_NOTES.map((n) => (
                    <button key={n} onClick={() => setEntry(String(n))} className={`flex-1 ${side}`}>
                        {n.toLocaleString()}
                    </button>
                ))}
                {/* Fills the field with the balance rather than clearing to it:
                    the amount has to be readable before it is taken. */}
                <button
                    onClick={() => { setSelected(new Set()); setEntry(String(bill.balance)) }}
                    className={`flex-1 ${side} ${!untouched && tendering === bill.balance
                        ? "bg-amber-100 text-amber-900 hover:bg-amber-200"
                        : ""}`}
                >
                    {t.pay_full}
                </button>
            </div>

            {/* Amount, pad, and the two bill actions under it. */}
            <main className="flex-1 min-w-0 flex flex-col gap-px">
                {/* Two labelled rows, the SambaPOS shape: what the bill comes
                    to, and what is being taken right now. Reading down answers
                    "am I taking all of it?" without doing arithmetic. */}
                <div className="bg-white px-6 py-4 shrink-0">
                    <div className="flex items-baseline gap-6">
                        {/* Once part of the bill is paid, the figure the next
                            tender is measured against is what is LEFT, not what
                            the bill came to - so the top row follows the money
                            instead of staying on the opening total while the
                            panel beside it says something different. */}
                        <span className="text-3xl font-light text-slate-300 shrink-0 w-32">
                            {paid > 0 ? t.balance_due : t.bill_total}
                        </span>
                        <span className="flex-1 text-right text-4xl font-light text-slate-500 tabular-nums border-b border-slate-200 pb-1">
                            {formatTHB(paid > 0 ? bill.balance : bill.total)}
                        </span>
                    </div>
                    {paid > 0 && (
                        <p className="text-right text-xs text-slate-400 mt-1 tabular-nums">
                            {t.bill_total} {formatTHB(bill.total)} · {t.amount_paid} {formatTHB(paid)}
                        </p>
                    )}
                    <div className="flex items-baseline gap-6 mt-3">
                        <span className="text-3xl font-light text-slate-300 shrink-0 w-32">
                            {t.charged}
                        </span>
                        <span className={`flex-1 text-right text-5xl font-black tabular-nums border-b-2 pb-1 leading-none ${untouched
                            ? "text-slate-300 border-slate-200"
                            : "text-slate-900 border-amber-400"
                            }`}>
                            {formatTHB(shown)}
                        </span>
                    </div>
                    <div className="flex items-baseline justify-end gap-3 mt-1.5 text-xs">
                        {/* The tenders are greyed out until this row says
                            something. Without a line saying why, a disabled
                            Cash button is just a till that appears broken. */}
                        {untouched && (
                            <span className="me-auto font-bold text-amber-700">{t.enter_amount_received}</span>
                        )}
                        {/* Say "orders" outright: a bare count next to an amount
                            reads as a quantity of something. */}
                        {selected.size > 0 && entry === "" && (
                            <span className="font-bold text-amber-700">
                                {selected.size} {t.round_no}
                            </span>
                        )}
                        <span className="text-slate-400 tabular-nums">
                            {formatLAK(thbToLak(shown, bill.fxRateLAK))}
                        </span>
                    </div>
                </div>

                <div className="flex-1 grid grid-cols-3 grid-rows-4 gap-px min-h-0">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                        <button key={n} className={digit} onClick={() => setEntry((p) => p + n)}>{n}</button>
                    ))}
                    <button
                        className="text-xl font-black bg-rose-50 text-rose-600 hover:bg-rose-100 transition-colors"
                        onClick={() => setEntry("")}
                    >
                        CLR
                    </button>
                    <button className={digit} onClick={() => setEntry((p) => p + "0")}>0</button>
                    <button
                        className="text-xl font-black bg-slate-200 text-slate-700 hover:bg-slate-300 transition-colors"
                        onClick={() => setEntry((p) => p.slice(0, -1))}
                    >
                        DEL
                    </button>
                </div>

                <div className="h-16 grid grid-cols-4 gap-px shrink-0">
                    <button
                        onClick={openPromo}
                        disabled={busy}
                        className={`${side} flex items-center justify-center gap-2 disabled:opacity-40 ${bill.promoId ? "text-rose-600 font-bold" : ""}`}
                    >
                        <Tag className="w-4 h-4" />
                        {t.apply_promo}
                    </button>
                    <button
                        onClick={() => { setDiscountInput(""); setDiscountOpen(true) }}
                        disabled={busy}
                        className={`${side} flex items-center justify-center gap-2 disabled:opacity-40`}
                    >
                        <Percent className="w-4 h-4" />
                        {t.apply_discount}
                    </button>
                    {/* Req #10. Here because this is where staff are standing
                        when the table is cleared - the bottles are in front of
                        them and the bill is on the screen. It changes stock,
                        never the total. */}
                    <button
                        onClick={() => setReturningOpen(true)}
                        disabled={busy}
                        className={`${side} flex items-center justify-center gap-2 disabled:opacity-40`}
                    >
                        <PackageOpen className="w-4 h-4" />
                        {t.return_unopened}
                    </button>
                    <button
                        onClick={printBill}
                        disabled={busy}
                        className={`${side} flex items-center justify-center gap-2 disabled:opacity-40`}
                    >
                        <Printer className="w-4 h-4" />
                        {t.print_bill}
                    </button>
                </div>
            </main>

            {/* Three ways money arrives, then the two ways a bill closes
                without any. They were one undifferentiated column of five
                buttons, which said they were five of the same thing; a comp is
                not a tender and putting it a keypad's width from Cash is how it
                gets tapped by mistake. Same three methods, same colours, as the
                walk-in till's dialog - a staff member who learns one has
                learned the other. */}
            <aside className="w-[180px] flex flex-col gap-px shrink-0">
                <button
                    onClick={() => takePayment("CASH")}
                    disabled={busy || bill.balance <= 0 || untouched}
                    className="flex-[2] bg-emerald-600 text-white hover:bg-emerald-700 font-black text-lg flex flex-col items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                >
                    <Banknote className="w-7 h-7" />
                    {t.pay_cash}
                </button>
                <button
                    onClick={() => takePayment("ONEPAY")}
                    disabled={busy || bill.balance <= 0 || untouched}
                    className="flex-[2] bg-slate-900 text-white hover:bg-slate-800 font-black text-lg flex flex-col items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                >
                    <img src="/bcel-one.png" alt="" className="w-7 h-7 rounded object-contain" />
                    {t.pay_onepay}
                </button>
                <button
                    onClick={() => takePayment("TRANSFER")}
                    disabled={busy || bill.balance <= 0 || untouched}
                    className="flex-[2] bg-purple-600 text-white hover:bg-purple-700 font-black text-lg flex flex-col items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                >
                    <QrCode className="w-7 h-7" />
                    {t.pay_transfer}
                </button>

                {/* Not a tender: no money arrives, the bill just stops being
                    owed. The gap is the whole point. */}
                <div className="h-2 bg-slate-300 shrink-0" />

                <button
                    onClick={() => { setApprovalError(null); setApproving("COMP") }}
                    disabled={busy || bill.balance <= 0}
                    className={`flex-1 ${side} flex items-center justify-center gap-2 disabled:opacity-40 disabled:pointer-events-none`}
                >
                    <Gift className="w-4 h-4" />
                    {t.owner_vip}
                </button>
                <button
                    onClick={() => {
                        setApprovalError(null)
                        fetch("/api/customers")
                            .then((r) => (r.ok ? r.json() : []))
                            .then((l) => setCustomers(Array.isArray(l) ? l : (l?.customers ?? [])))
                            .catch(() => setCustomers([]))
                        setApproving("PAY_LATER")
                    }}
                    disabled={busy || bill.balance <= 0}
                    className={`flex-1 ${side} flex items-center justify-center gap-2 disabled:opacity-40 disabled:pointer-events-none`}
                >
                    <Clock3 className="w-4 h-4" />
                    {t.pay_later}
                </button>
                <button
                    onClick={() => router.push(`/pos?session=${bill.id}`)}
                    className="h-20 bg-rose-600 text-white hover:bg-rose-700 font-black text-lg transition-colors shrink-0"
                >
                    {t.back}
                </button>
            </aside>

            <Dialog open={!!pendingQr} onOpenChange={(o) => { if (!o) { setPendingQr(null); load() } }}>
                <DialogContent className="max-w-sm">
                    <DialogHeader><DialogTitle>{t.scan_to_pay}</DialogTitle></DialogHeader>
                    {pendingQr && (
                        <div className="text-center space-y-3">
                            <div className="mx-auto w-fit rounded-xl border-2 bg-white p-3">
                                <QRCodeSVG value={pendingQr.qr} size={240} level="H" />
                            </div>
                            <p className="text-2xl font-black tabular-nums">{formatTHB(pendingQr.amount)}</p>
                            <p className="text-sm text-amber-700">{t.waiting_for_payment}</p>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* The shop's own QR. Unlike BCEL there is nothing to poll, so the
                staff member is the confirmation - which is why the amount is
                the loudest thing here: it is what they are agreeing arrived. */}
            <ReturnsDialog
                sessionId={bill.id}
                open={returningOpen}
                onClose={() => setReturningOpen(false)}
                onDone={load}
            />

            <Dialog open={transferAmount !== null} onOpenChange={(o) => { if (!o) closeTransfer() }}>
                <DialogContent className="max-w-sm">
                    <DialogHeader><DialogTitle>{t.pay_transfer}</DialogTitle></DialogHeader>
                    <div className="text-center space-y-3">
                        {transferQrUrl ? (
                            <div className="mx-auto w-fit rounded-xl border-2 bg-white p-3">
                                <img src={transferQrUrl} alt={t.store_transfer_qr} className="w-60 h-60 object-contain" />
                            </div>
                        ) : (
                            <p className="rounded-xl border-2 border-dashed border-amber-300 bg-amber-50 px-4 py-8 text-sm font-bold text-amber-800">
                                {t.no_transfer_qr}
                            </p>
                        )}
                        <p className="text-3xl font-black tabular-nums">{formatTHB(transferAmount ?? 0)}</p>
                        <p className="text-sm text-slate-500">{t.transfer_show_qr}</p>
                        <div className="grid grid-cols-2 gap-2 pt-1">
                            <Button variant="outline" className="h-12" onClick={closeTransfer} disabled={busy}>
                                {t.cancel}
                            </Button>
                            <Button
                                className="h-12 bg-purple-600 hover:bg-purple-700 font-bold"
                                onClick={confirmTransfer}
                                disabled={busy}
                            >
                                <Check className="w-4 h-4 mr-2" />
                                {t.transfer_received}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Which deal is on. A list rather than a code box: staff are
                picking from what the owner set up, and a code to type is a code
                to mistype at 1am. A deal that is not running at all is not
                offered, so the only failure left is the minimum - which the
                row states rather than letting the tap quietly do nothing. */}
            <Dialog open={promoOpen} onOpenChange={setPromoOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader><DialogTitle>{t.choose_promo}</DialogTitle></DialogHeader>
                    <div className="space-y-2 max-h-[55vh] overflow-y-auto no-scrollbar">
                        {promos
                            .filter(pickable)
                            .map((p: any) => (
                                <button
                                    key={p.id}
                                    onClick={() => applyPromo(p.id)}
                                    disabled={busy}
                                    className={`w-full text-left rounded-xl border-2 p-3 transition-all disabled:opacity-40 ${
                                        bill.promoId === p.id ? "border-rose-500 bg-rose-50" : "border-slate-200 hover:border-slate-300"}`}
                                >
                                    <div className="flex items-center gap-2">
                                        <span className="font-bold text-slate-900">{p.name}</span>
                                        {bill.promoId === p.id && <Check className="w-4 h-4 text-rose-600 ms-auto" />}
                                    </div>
                                    <p className="text-xs text-slate-500 mt-0.5">
                                        {p.discountType === "percentage" ? `${p.discountValue}%` : formatTHB(p.discountValue)}
                                        {p.category?.name ? ` · ${p.category.name}` : ""}
                                        {p.minItems ? ` · ${t.promo_min_items.replace("{n}", String(p.minItems))}` : ""}
                                    </p>
                                </button>
                            ))}
                        {promos.filter(pickable).length === 0 && (
                            <p className="py-8 text-center text-sm italic text-slate-400">{t.no_promos_running}</p>
                        )}
                    </div>
                    {bill.promoId && (
                        <Button
                            variant="outline"
                            onClick={() => applyPromo(null)}
                            disabled={busy}
                            className="h-11 w-full text-rose-600 border-rose-200 hover:bg-rose-50"
                        >
                            {t.remove_promo}
                        </Button>
                    )}
                </DialogContent>
            </Dialog>

            <Dialog open={discountOpen} onOpenChange={setDiscountOpen}>
                <DialogContent className="max-w-sm">
                    <DialogHeader><DialogTitle>{t.apply_discount}</DialogTitle></DialogHeader>
                    <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                            {(["PERCENT", "FIXED"] as const).map((k) => (
                                <button
                                    key={k}
                                    onClick={() => setDiscountKind(k)}
                                    className={`h-11 rounded-xl border-2 text-sm font-bold transition-all ${discountKind === k
                                        ? "bg-slate-900 border-slate-900 text-white"
                                        : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}
                                >
                                    {k === "PERCENT" ? t.discount_percent : t.discount_fixed}
                                </button>
                            ))}
                        </div>
                        <Input
                            type="number"
                            autoFocus
                            value={discountInput}
                            onChange={(e) => setDiscountInput(e.target.value)}
                            className="h-12 text-lg tabular-nums border-2 rounded-xl"
                        />
                        <p className="text-sm text-slate-500">
                            {formatTHB(bill.gross)} →{" "}
                            <span className="font-bold text-slate-900">
                                {formatTHB(Math.max(0, Math.ceil(bill.gross - (discountKind === "PERCENT"
                                    ? bill.gross * (Number(discountInput) || 0) / 100
                                    : Number(discountInput) || 0))))}
                            </span>
                        </p>
                        <Button
                            className="w-full h-12 rounded-xl bg-amber-600 hover:bg-amber-700 text-white"
                            disabled={!(Number(discountInput) > 0)}
                            onClick={() => { setApprovalError(null); setApproving("DISCOUNT") }}
                        >
                            {t.approval_required}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog
                open={approving === "PAY_LATER" && !tabCustomerId}
                onOpenChange={(o) => { if (!o) setApproving(null) }}
            >
                <DialogContent className="max-w-sm">
                    <DialogHeader><DialogTitle>{t.select_customer_tab}</DialogTitle></DialogHeader>
                    <div className="space-y-2 max-h-80 overflow-y-auto">
                        {customers.length === 0
                            ? <p className="text-sm text-slate-500 py-6 text-center">{t.no_customers_found}</p>
                            : customers.map((c) => (
                                <button
                                    key={c.id}
                                    onClick={() => setTabCustomerId(c.id)}
                                    className="w-full h-12 px-3 rounded-xl border-2 border-slate-200 text-left text-sm font-bold text-slate-700 hover:bg-slate-50"
                                >
                                    {c.name}
                                </button>
                            ))}
                    </div>
                </DialogContent>
            </Dialog>

            <ManagerApproval
                open={approving !== null && (approving !== "PAY_LATER" || !!tabCustomerId)}
                title={t.approval_required}
                description={
                    approving === "COMP" ? t.comp_confirm
                        : approving === "PAY_LATER" ? `${t.pay_later} · ${formatTHB(bill.balance)}`
                            : `${t.apply_discount} · ${discountInput}${discountKind === "PERCENT" ? "%" : "฿"}`
                }
                busy={busy}
                error={approvalError}
                onCancel={() => { setApproving(null); setApprovalError(null); setTabCustomerId("") }}
                onApprove={runApproved}
            />

            {/* Over the till, not in a second window. Closing it is what returns
                to the floor plan on a settled bill, so the slip is never pulled
                out from under whoever is reading it. */}
            <ReceiptDialog
                src={receiptSrc}
                onClose={() => {
                    setReceiptSrc(null)
                    if (returnAfterReceipt) router.push("/tables")
                }}
            />
        </div>
    )
}

export default function SettlePage() {
    // useSearchParams needs a Suspense boundary or `next build` refuses the page.
    return (
        <Suspense fallback={null}>
            <SettleScreen />
        </Suspense>
    )
}
