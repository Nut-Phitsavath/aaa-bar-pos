"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useTranslation } from "@/hooks/use-translation"
import { Button } from "@/components/ui/button"
import { Printer, Plus, Minus, Trash2, Ban, Repeat, ArrowRightLeft } from "lucide-react"
import { formatTHB } from "@/lib/currency"
import { VoidDialog, type VoidTarget } from "@/components/pos/void-dialog"
import { ExchangeDialog } from "@/components/pos/exchange-dialog"
import { SwapSummary } from "@/components/pos/swap-summary"
import { TableOpsDialog } from "@/components/pos/table-ops-dialog"

export type TicketOrder = {
    id: string
    status: string
    total: number
    createdAt: string
    tableOrderNumber: number | null
    waiter: { id: string; name: string } | null
    user: { id: string; name: string } | null
    items: {
        id: string; name: string; localName: string | null; quantity: number; total: number
        note?: string | null
        swappable?: boolean
        swaps?: { lines: { direction: string; name: string; quantity: number }[] }[]
        voidedAt?: string | null; voidReason?: string | null; voidNote?: string | null
        voidedBy?: { name: string } | null
    }[]
}

export type TicketBill = {
    id: string
    status: string
    openedAt: string
    table: { name: string; area: string }
    orders: TicketOrder[]
    gross: number
    discount: number
    total: number
    balance: number
    customer?: { id: string; name: string; phone: string | null } | null
    /** What this guest owes on other nights, so the banner can warn now. */
    customerOwes?: number
}

export type PendingLine = {
    id: string
    name: string
    localName?: string
    price: number
    quantity: number
}

/**
 * The table ticket: everything about this table on one screen.
 *
 * Modelled on the SambaPOS ticket view, which keeps the running ticket, the
 * menu and the settle action together rather than making staff navigate
 * between an order screen and a bill screen. Submitted rounds sit under their
 * own order numbers; lines not yet sent show below them as NEW.
 *
 * SambaPOS persists its New lines to the ticket so another terminal can see
 * them. Here they stay in the client cart: one POS staffer keys at one till,
 * so a half-typed round is nobody else's business.
 */
export function TicketPanel({
    bill,
    cart,
    onQtyChange,
    onRemove,
    onSend,
    onPrint,
    onVoided,
    busy,
}: {
    bill: TicketBill
    cart: PendingLine[]
    onQtyChange: (lineId: string, delta: number) => void
    onRemove: (lineId: string) => void
    onSend: () => void
    onPrint: () => void
    /** Reload the bill after a void: the round is worth less than it was. */
    onVoided: () => void
    busy?: boolean
}) {
    const { t } = useTranslation()
    const router = useRouter()
    const [now, setNow] = useState(() => new Date())
    const [voiding, setVoiding] = useState<VoidTarget | null>(null)
    const [exchanging, setExchanging] = useState<string | null>(null)
    const [opsOpen, setOpsOpen] = useState(false)

    useEffect(() => {
        const tick = setInterval(() => setNow(new Date()), 30000)
        return () => clearInterval(tick)
    }, [])

    const rounds = [...bill.orders]
        .filter((o) => o.status !== "HOLD")
        .sort((a, b) => (a.tableOrderNumber ?? 0) - (b.tableOrderNumber ?? 0))

    const pendingTotal = cart.reduce((sum, l) => sum + l.price * l.quantity, 0)
    const hasPending = cart.length > 0

    return (
        <div className="w-[440px] xl:w-[520px] flex flex-col bg-white border-l border-slate-200 shrink-0">
            <div className="flex-1 overflow-y-auto">
                {rounds.length === 0 && !hasPending && (
                    <p className="text-center text-sm text-slate-400 py-10">{t.no_orders_yet}</p>
                )}

                {rounds.map((order) => {
                    const voided = order.status === "CANCELLED"
                    return (
                        <section key={order.id} className={voided ? "opacity-50" : ""}>
                            <div className="flex items-baseline justify-between gap-2 px-4 py-1.5 bg-slate-100 text-sm text-slate-600">
                                <span className="font-bold truncate">
                                    {t.round_no} #{order.tableOrderNumber ?? "-"} · {order.user?.name || "—"} · {order.waiter?.name || "—"}
                                </span>
                                <span className="flex items-center gap-2 shrink-0">
                                    <span className="tabular-nums text-xs">
                                        {new Date(order.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                                    </span>
                                    {/* The duplicate-order case req #5 names: two staff
                                        key the same table, one whole round has to go. */}
                                    {!voided && (
                                        <button
                                            onClick={() => setVoiding({
                                                orderId: order.id,
                                                label: `${t.round_no} #${order.tableOrderNumber ?? "-"}`,
                                                value: order.total,
                                            })}
                                            aria-label={t.void_round}
                                            className="h-7 px-2 rounded-md text-rose-600 hover:bg-rose-100 transition-colors duration-150"
                                        >
                                            <Ban className="w-4 h-4" />
                                        </button>
                                    )}
                                </span>
                            </div>
                            {order.items.map((item) => {
                                const lineVoid = Boolean(item.voidedAt)
                                const struck = voided || lineVoid
                                return (
                                    <div key={item.id} className="flex items-start gap-3 px-4 py-2.5 border-b border-slate-100">
                                        <span className="w-8 text-lg font-black text-slate-500 tabular-nums shrink-0 leading-tight">
                                            {item.quantity}
                                        </span>
                                        <div className="flex-1 min-w-0">
                                            <p className={`text-base leading-snug ${struck ? "text-slate-400 line-through" : "text-slate-900"}`}>
                                                {item.localName || item.name}
                                            </p>
                                            {/* The note is the whole point of the
                                                ticket for the bar: louder than the
                                                status line, not a footnote to it. */}
                                            {item.note && (
                                                <p className={`text-sm font-bold mt-0.5 ${struck ? "text-slate-400 line-through" : "text-amber-700"}`}>
                                                    {item.note}
                                                </p>
                                            )}
                                            {/* What this package actually delivered
                                                after an exchange (req #9). On the
                                                ticket because the bar pours from
                                                this, not from the package's name. */}
                                            <SwapSummary swaps={item.swaps} struck={struck} />
                                            <p className={`text-[11px] font-bold tracking-wide mt-0.5 ${struck ? "text-rose-500" : "text-emerald-600"}`}>
                                                {struck ? t.state_void : t.state_submitted}
                                            </p>
                                            {/* Who struck it and why, on the ticket itself.
                                                The manager asking "what happened on table 4"
                                                should not have to open a report to find out. */}
                                            {lineVoid && (
                                                <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                                                    {item.voidReason ? (t[`void_${item.voidReason.toLowerCase()}` as keyof typeof t] as string ?? item.voidReason) : ""}
                                                    {item.voidedBy?.name ? ` · ${item.voidedBy.name}` : ""}
                                                    {item.voidNote ? ` · ${item.voidNote}` : ""}
                                                </p>
                                            )}
                                        </div>
                                        <span className={`text-base font-semibold tabular-nums shrink-0 ${struck ? "line-through text-slate-400" : "text-slate-800"}`}>
                                            {formatTHB(item.total)}
                                        </span>
                                        {/* The customer wants different drinks in
                                            the set they already bought (req #8). */}
                                        {!struck && item.swappable && (
                                            <button
                                                onClick={() => setExchanging(item.id)}
                                                aria-label={t.exchange_items}
                                                className="h-8 w-8 grid place-items-center rounded-md text-slate-300 hover:text-amber-700 hover:bg-amber-50 shrink-0 transition-colors duration-150"
                                            >
                                                <Repeat className="w-4 h-4" />
                                            </button>
                                        )}
                                        {/* One of the five beers came back. */}
                                        {!struck && (
                                            <button
                                                onClick={() => setVoiding({
                                                    orderId: order.id,
                                                    itemIds: [item.id],
                                                    label: `${item.quantity} × ${item.localName || item.name}`,
                                                    value: item.total,
                                                })}
                                                aria-label={t.void_item}
                                                className="h-8 w-8 grid place-items-center rounded-md text-slate-300 hover:text-rose-600 hover:bg-rose-50 shrink-0 transition-colors duration-150"
                                            >
                                                <Ban className="w-4 h-4" />
                                            </button>
                                        )}
                                    </div>
                                )
                            })}
                        </section>
                    )
                })}

                {/* Not sent yet. Editable, and the only lines Send acts on. */}
                {hasPending && (
                    <section>
                        <div className="px-4 py-1.5 bg-amber-100 text-sm font-bold text-amber-900">
                            {t.state_new}
                        </div>
                        {cart.map((line) => (
                            <div key={line.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-amber-100 bg-amber-50/40">
                                <div className="flex-1 min-w-0">
                                    <p className="text-base text-slate-900 leading-snug truncate">
                                        {line.localName || line.name}
                                    </p>
                                    <p className="text-[11px] font-bold tracking-wide text-amber-700 mt-0.5">{t.state_new}</p>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                    <button
                                        onClick={() => onQtyChange(line.id, -1)}
                                        aria-label="-"
                                        className="h-10 w-10 grid place-items-center rounded-lg border-2 border-slate-300 text-slate-600 hover:bg-white"
                                    >
                                        <Minus className="w-4 h-4" />
                                    </button>
                                    <span className="w-8 text-center text-lg font-black tabular-nums">{line.quantity}</span>
                                    <button
                                        onClick={() => onQtyChange(line.id, 1)}
                                        aria-label="+"
                                        className="h-10 w-10 grid place-items-center rounded-lg border-2 border-slate-300 text-slate-600 hover:bg-white"
                                    >
                                        <Plus className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={() => onRemove(line.id)}
                                        aria-label={t.remove}
                                        className="h-10 w-10 grid place-items-center rounded-lg text-rose-500 hover:bg-rose-50"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                                <span className="w-20 text-right text-base font-semibold tabular-nums text-slate-800 shrink-0">
                                    {formatTHB(line.price * line.quantity)}
                                </span>
                            </div>
                        ))}
                    </section>
                )}
            </div>

            <footer className="border-t border-slate-200 p-3 space-y-2">
                {bill.discount > 0 && (
                    <div className="flex justify-between text-xs text-rose-600">
                        <span>{t.apply_discount}</span>
                        <span className="tabular-nums">− {formatTHB(bill.discount)}</span>
                    </div>
                )}
                {hasPending && (
                    <div className="flex justify-between text-sm text-amber-700">
                        <span>{t.state_new}</span>
                        <span className="tabular-nums">+ {formatTHB(pendingTotal)}</span>
                    </div>
                )}
                <div className="flex items-baseline justify-between">
                    <span className="text-sm font-semibold text-slate-700">{t.balance_due}</span>
                    <span className="text-2xl font-bold text-slate-900 tabular-nums">
                        {formatTHB(bill.balance + pendingTotal)}
                    </span>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-1">
                    {/* Move, merge and split (req #2). One door for the three,
                        because they are the same thought - "this bill is not
                        shaped like the room any more" - and the footer already
                        carries print and settle. */}
                    <Button
                        variant="outline"
                        className="h-12 border-slate-300"
                        disabled={busy || rounds.length === 0}
                        onClick={() => setOpsOpen(true)}
                    >
                        <ArrowRightLeft className="w-4 h-4 mr-2" />
                        {t.table_operations}
                    </Button>
                    <Button
                        variant="outline"
                        className="h-12 border-slate-300"
                        disabled={busy}
                        onClick={onPrint}
                    >
                        <Printer className="w-4 h-4 mr-2" />
                        {t.print_bill}
                    </Button>
                    {hasPending ? (
                        <Button
                            className="h-12 bg-amber-600 hover:bg-amber-700 text-white"
                            disabled={busy}
                            onClick={onSend}
                        >
                            {t.send_order}
                        </Button>
                    ) : (
                        <Button
                            className="h-12 bg-emerald-600 hover:bg-emerald-700 text-white"
                            disabled={busy || bill.balance <= 0}
                            onClick={() => router.push(`/pos/settle?session=${bill.id}`)}
                        >
                            {t.settle_bill}
                        </Button>
                    )}
                </div>
            </footer>

            <ExchangeDialog
                itemId={exchanging}
                onClose={() => setExchanging(null)}
                onDone={onVoided}
            />

            <TableOpsDialog
                sessionId={bill.id}
                tableName={bill.table.name}
                lines={rounds.flatMap((o) =>
                    o.status === "CANCELLED" ? [] : o.items
                        .filter((i) => !i.voidedAt)
                        .map((i) => ({
                            id: i.id, name: i.name, localName: i.localName,
                            quantity: i.quantity, total: i.total,
                        })))}
                open={opsOpen}
                onClose={() => setOpsOpen(false)}
                onDone={onVoided}
            />

            <VoidDialog
                target={voiding}
                onClose={() => setVoiding(null)}
                onVoided={onVoided}
            />
        </div>
    )
}
