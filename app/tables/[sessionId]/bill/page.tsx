"use client"

import { useState, useEffect, useCallback, use } from "react"
import { useRouter } from "next/navigation"
import { useTranslation } from "@/hooks/use-translation"
import { useCustomerDisplay } from "@/hooks/use-customer-display"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Receipt, Printer, CreditCard } from "lucide-react"
import { formatTHB, formatLAK, formatUSD, thbToLak, thbToUsd } from "@/lib/currency"
import { toast } from "sonner"

type BillOrder = {
  id: string
  status: string
  total: number
  createdAt: string
  tableOrderNumber: number | null
  waiter: { id: string; name: string } | null
  user: { id: string; name: string } | null
  items: {
    id: string; name: string; quantity: number; total: number
    image: string | null; localName: string | null; category: string | null
  }[]
}

type BillPayment = {
  id: string
  method: string
  amount: number
  paymentStatus: string | null
  createdAt: string
  user: { id: string; name: string } | null
}

type Bill = {
  id: string
  status: string
  openedAt: string
  closedAt: string | null
  table: { name: string; area: string }
  orders: BillOrder[]
  payments: BillPayment[]
  gross: number
  discount: number
  discountType: string | null
  discountValue: number | null
  isOwnerVip: boolean
  total: number
  balance: number
  fxRateLAK: number
  fxRateUSD: number
  showUsd: boolean
}

// en-GB gives 24h HH:mm on both server and client. Never pass 'lo-LA' to a
// browser for dates - see the note in lib/date.ts.
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })

/**
 * Reading a bill.
 *
 * Deliberately cannot take money. Settling happens in exactly one place -
 * /pos/settle - because two payment surfaces means two sets of rules to keep in
 * step, and the one used less is the one that drifts. This screen is for
 * checking a bill and for reading a settled one afterwards; anything still
 * owing sends you to the till.
 */
export default function BillPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params)
  const { t } = useTranslation()
  const router = useRouter()
  const [bill, setBill] = useState<Bill | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/table-sessions/${sessionId}`)
      if (!res.ok) { router.push("/tables"); return }
      setBill(await res.json())
    } catch {
      // Leave the last render up rather than bouncing off the bill on a blip.
    }
  }, [sessionId, router])

  useEffect(() => { load() }, [load])
  useCustomerDisplay(bill)

  const printBill = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/table-sessions/${sessionId}/print`, { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || "Failed"); return }
      if (data.qrError) toast.error(data.qrError)
      window.open(`/tables/${sessionId}/print`, "_blank", "width=420,height=700")
      await load()
    } finally { setBusy(false) }
  }

  if (!bill) {
    return (
      <div className="min-h-screen bg-slate-50 p-4">
        <div className="max-w-2xl mx-auto space-y-3">
          <div className="h-14 rounded-xl bg-white border border-slate-200 animate-pulse" />
          <div className="h-28 rounded-xl bg-white border border-slate-200 animate-pulse" />
        </div>
      </div>
    )
  }

  const rounds = bill.orders
    .filter((o) => o.status !== "HOLD")
    .sort((a, b) => (a.tableOrderNumber ?? 0) - (b.tableOrderNumber ?? 0))
  const closed = bill.status === "CLOSED"
  const paid = bill.total - bill.balance
  const posStaff = Array.from(new Set(rounds.map((o) => o.user?.name).filter(Boolean)))
  const servers = Array.from(new Set(rounds.map((o) => o.waiter?.name).filter(Boolean)))
  const methodLabel = (m: string) =>
    m === "CASH" ? t.pay_cash : m === "ONEPAY" ? t.pay_onepay : m === "OWNER_VIP" ? t.owner_vip : m

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20 px-3 md:px-4 py-2.5 flex items-center gap-2">
        <button
          onClick={() => router.push("/tables")}
          aria-label={t.back_to_floor}
          className="h-10 w-10 shrink-0 grid place-items-center rounded-lg text-slate-600 hover:bg-slate-100 transition-colors duration-150"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold text-slate-900 leading-none truncate">
            {bill.table.name} · {t.bill}
          </h1>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            {t.opened_at} {clock(bill.openedAt)}
            {bill.closedAt && ` · ${t.closed_at} ${clock(bill.closedAt)}`}
          </p>
        </div>
        <Button variant="outline" className="h-11 shrink-0 border-slate-300" disabled={busy} onClick={printBill}>
          <Printer className="w-4 h-4 sm:mr-1.5" />
          <span className="hidden sm:inline">{t.print_bill}</span>
        </Button>
      </header>

      <main className="flex-1 p-3 md:p-4">
        <div className="max-w-2xl mx-auto space-y-2.5">
          {rounds.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-12 h-12 rounded-full bg-slate-100 grid place-items-center mx-auto mb-3">
                <Receipt className="w-6 h-6 text-slate-400" />
              </div>
              <p className="text-slate-900 font-semibold">{t.no_orders_yet}</p>
            </div>
          ) : (
            rounds.map((order) => {
              const voided = order.status === "CANCELLED"
              return (
                <section
                  key={order.id}
                  className={`rounded-xl border border-slate-200 bg-white p-3.5 ${voided ? "opacity-55" : ""}`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-baseline gap-2 min-w-0">
                      <span className="text-sm font-bold text-slate-900 shrink-0">
                        {t.round_no} #{order.tableOrderNumber ?? "-"}
                      </span>
                      <span className="text-xs text-slate-500 truncate">
                        {order.user?.name || "—"} · {order.waiter?.name || "—"}
                      </span>
                      <span className="text-xs text-slate-400 tabular-nums shrink-0">
                        {clock(order.createdAt)}
                      </span>
                    </div>
                    <span className={`font-bold text-slate-900 tabular-nums shrink-0 ${voided ? "line-through" : ""}`}>
                      {formatTHB(order.total)}
                    </span>
                  </div>
                  <ul className="space-y-1">
                    {order.items.map((item) => (
                      <li key={item.id} className="flex justify-between gap-3 text-sm text-slate-600">
                        <span className="min-w-0">
                          <span className="tabular-nums text-slate-400 me-1.5">{item.quantity}×</span>
                          {item.localName || item.name}
                        </span>
                        <span className="tabular-nums shrink-0">{formatTHB(item.total)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })
          )}

          {rounds.length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white p-3.5 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-slate-500 shrink-0">{t.pos_staff}</span>
                <span className="text-slate-800 text-right">{posStaff.join(", ") || "—"}</span>
              </div>
              <div className="flex justify-between gap-3 mt-1">
                <span className="text-slate-500 shrink-0">{t.server_staff}</span>
                <span className="text-slate-800 text-right">{servers.join(", ") || "—"}</span>
              </div>
            </section>
          )}

          {bill.payments.length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white p-3.5">
              <h2 className="text-sm font-semibold text-slate-900 mb-2">{t.payments_taken}</h2>
              <ul className="space-y-1">
                {bill.payments.map((p) => {
                  const pending = p.method === "ONEPAY" && p.paymentStatus === "PENDING"
                  const dead = p.paymentStatus === "CANCELLED"
                  return (
                    <li key={p.id} className="flex justify-between gap-3 text-sm">
                      <span className={pending || dead ? "text-slate-400" : "text-slate-600"}>
                        {methodLabel(p.method)}
                        <span className="text-slate-400 text-xs ms-2 tabular-nums">{clock(p.createdAt)}</span>
                        {pending && <span className="text-xs text-amber-600 ms-2">{t.waiting_for_payment}</span>}
                        {dead && <span className="text-xs text-slate-400 ms-2">({t.cancelled_status})</span>}
                      </span>
                      <span className={`tabular-nums ${pending || dead ? "text-slate-400 line-through" : "text-slate-700"}`}>
                        {formatTHB(p.amount)}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
        </div>
      </main>

      {/* sticky, not fixed: a fixed bar is measured from the viewport edge, so
          it slides under the sidebar and ignores its collapse animation. */}
      <div className="sticky bottom-0 bg-white border-t border-slate-200 p-3 md:p-4">
        <div className="max-w-2xl mx-auto">
          {bill.discount > 0 && (
            <>
              <div className="flex items-baseline justify-between text-sm text-slate-500">
                <span>{t.gross_sales}</span>
                <span className="tabular-nums">{formatTHB(bill.gross)}</span>
              </div>
              <div className="flex items-baseline justify-between text-sm text-rose-600 mt-0.5">
                <span>
                  {t.apply_discount}
                  {bill.discountType === "PERCENT" && ` ${bill.discountValue}%`}
                </span>
                <span className="tabular-nums">− {formatTHB(bill.discount)}</span>
              </div>
            </>
          )}

          <div className="flex items-baseline justify-between">
            <span className="text-sm text-slate-600">{t.bill_total}</span>
            <span className="text-2xl font-black text-slate-900 tabular-nums">{formatTHB(bill.total)}</span>
          </div>

          <div className="flex items-baseline justify-between text-sm text-slate-500 mt-1">
            <span className="tabular-nums">1 ฿ = {bill.fxRateLAK.toLocaleString("en-US")} ₭</span>
            <span className="tabular-nums">{formatLAK(thbToLak(bill.total, bill.fxRateLAK))}</span>
          </div>
          {bill.showUsd && (
            <div className="flex justify-end text-sm text-slate-500 tabular-nums">
              {formatUSD(thbToUsd(bill.total, bill.fxRateUSD))}
            </div>
          )}

          {paid > 0 && (
            <div className="flex items-baseline justify-between text-sm mt-2 pt-2 border-t">
              <span className="text-slate-500">{t.amount_paid}</span>
              <span className="text-slate-700 tabular-nums">− {formatTHB(paid)}</span>
            </div>
          )}

          {closed && bill.balance <= 0 && (
            <div className="text-center py-3">
              <p className="text-sm text-slate-500">{t.session_closed}</p>
              {bill.isOwnerVip && (
                <p className="text-sm font-semibold text-purple-600 mt-1">{t.owner_vip}</p>
              )}
            </div>
          )}

          {/* Anything still owing goes to the till. This screen never takes money. */}
          {bill.balance > 0 && (
            <>
              <div className="flex items-baseline justify-between mt-1">
                <span className="text-sm font-bold text-slate-900">{t.balance_due}</span>
                <span className="text-xl font-black text-amber-700 tabular-nums">
                  {formatTHB(bill.balance)}
                </span>
              </div>
              <Button
                className="w-full h-12 mt-3 rounded-xl bg-amber-600 hover:bg-amber-700 text-white"
                onClick={() => router.push(`/pos/settle?session=${bill.id}`)}
              >
                <CreditCard className="w-4 h-4 mr-2" />
                {closed ? t.settle_tab : t.settle_bill}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
