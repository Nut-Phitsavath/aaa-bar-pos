"use client"

import { useState, useEffect, useCallback, use } from "react"
import { useRouter } from "next/navigation"
import { useTranslation } from "@/hooks/use-translation"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Receipt, Plus, Banknote, QrCode, Check } from "lucide-react"
import { formatTHB, formatLAK, formatUSD, thbToLak, thbToUsd } from "@/lib/currency"
import { QRCodeSVG } from "qrcode.react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"

type BillOrder = {
  id: string
  orderNumber: string
  status: string
  total: number
  createdAt: string
  waiter: { id: string; name: string } | null
  items: { id: string; name: string; quantity: number; total: number }[]
}

type Bill = {
  id: string
  status: string
  openedAt: string
  closedAt: string | null
  total: number
  table: { name: string; area: string }
  orders: BillOrder[]
  payments: BillPayment[]
  // Derived server-side so the screen and the settle endpoint cannot disagree.
  balance: number
  changeDue: number
  // Live rate while open, the settled rate once closed. Resolved server-side.
  fxRateLAK: number
  fxRateUSD: number
  showUsd: boolean
}

type BillPayment = {
  id: string
  method: string
  amount: number
  paymentStatus: string | null
  qrCodeData: string | null
  createdAt: string
  user: { id: string; name: string } | null
}

// en-GB gives 24h HH:mm on both server and client. Never pass 'lo-LA' to a
// browser for dates - see the note in lib/date.ts.
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })

export default function BillPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params)
  const { t } = useTranslation()
  const router = useRouter()
  const [bill, setBill] = useState<Bill | null>(null)
  const [busy, setBusy] = useState(false)
  const [payOpen, setPayOpen] = useState(false)
  const [payAmount, setPayAmount] = useState("")
  const [pendingQr, setPendingQr] = useState<{ paymentId: string; qr: string; amount: number } | null>(null)

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

  // BCEL has no callback into this app - the till asks until the bank says
  // yes. Same mechanism the walk-in checkout already uses, pointed at a
  // Payment instead of an Order.
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
          setPayOpen(false)
          if (data.closed) {
            toast.success(t.session_closed)
            router.push("/tables")
          } else {
            toast.success(t.payment_confirmed)
            await load()
          }
        }
      } catch {
        // Keep asking. A dropped poll is not a failed payment.
      }
    }, 3000)

    return () => { stop = true; clearInterval(poll) }
  }, [pendingQr, load, router, t])

  const requestBill = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/table-sessions/${sessionId}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "BILL_REQUESTED" }),
      })
      if (res.ok) await load()
      else toast.error((await res.json().catch(() => ({}))).error || "Failed")
    } finally { setBusy(false) }
  }

  /** Take one tender. Cash lands immediately; a QR opens the waiting dialog. */
  const takePayment = async (method: "CASH" | "ONEPAY") => {
    if (!bill) return
    const amount = Number(payAmount)
    if (!Number.isFinite(amount) || amount <= 0) { toast.error(t.payment_amount); return }

    setBusy(true)
    try {
      const res = await fetch(`/api/table-sessions/${sessionId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method, amount }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || "Failed"); return }

      if (method === "CASH") {
        setPayOpen(false)
        if (data.closed) { toast.success(t.session_closed); router.push("/tables"); return }
        toast.success(t.payment_confirmed)
        await load()
      } else {
        // Ask BCEL for a QR covering just this leg, then poll exactly the way
        // the walk-in till does.
        const gen = await fetch("/api/payments/onepay/session-generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentId: data.payment.id }),
        })
        const genData = await gen.json().catch(() => ({}))
        if (!gen.ok) { toast.error(genData.error || "Failed"); await load(); return }
        setPendingQr({ paymentId: data.payment.id, qr: genData.qrCode, amount })
      }
    } finally { setBusy(false) }
  }

  /** Close a bill whose balance already reached zero (or that has nothing on it). */
  const finalise = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/table-sessions/${sessionId}/close`, { method: "POST" })
      if (res.ok) {
        toast.success(t.session_closed)
        router.push("/tables")
      } else {
        toast.error((await res.json().catch(() => ({}))).error || "Failed")
      }
    } finally { setBusy(false) }
  }

  if (!bill) {
    return (
      <div className="min-h-screen bg-slate-50 p-4">
        <div className="max-w-2xl mx-auto space-y-3">
          <div className="h-14 rounded-lg bg-white border border-slate-200 animate-pulse" />
          <div className="h-28 rounded-lg bg-white border border-slate-200 animate-pulse" />
          <div className="h-28 rounded-lg bg-white border border-slate-200 animate-pulse" />
        </div>
      </div>
    )
  }

  // Cancelled rounds stay on screen struck through rather than vanishing, so
  // staff can see a void happened instead of wondering where a round went.
  // HOLD orders belong to the beeper flow and are not part of a table bill.
  const rounds = bill.orders.filter((o) => o.status !== "HOLD")
  const closed = bill.status === "CLOSED"
  const paid = bill.total - bill.balance
  const methodLabel = (m: string) =>
    m === "CASH" ? t.pay_cash : m === "ONEPAY" ? t.pay_onepay : m

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20 px-3 md:px-4 py-2.5 flex items-center gap-2">
        <button
          onClick={() => router.push("/tables")}
          aria-label={t.back_to_floor}
          className="h-10 w-10 shrink-0 grid place-items-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-slate-900 leading-none truncate">
            {bill.table.name} · {t.bill}
          </h1>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            {t.opened_at} {clock(bill.openedAt)}
            {bill.closedAt && ` · ${t.closed_at} ${clock(bill.closedAt)}`}
          </p>
        </div>
      </header>

      <main className="flex-1 p-3 md:p-4 pb-40">
        <div className="max-w-2xl mx-auto space-y-2.5">
          {rounds.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-12 h-12 rounded-full bg-slate-100 grid place-items-center mx-auto mb-3">
                <Receipt className="w-6 h-6 text-slate-400" />
              </div>
              <p className="text-slate-900 font-semibold">{t.no_orders_yet}</p>
              {!closed && (
                <Button
                  variant="outline"
                  className="mt-4 h-11"
                  onClick={() => router.push(`/pos?session=${bill.id}`)}
                >
                  <Plus className="w-4 h-4 mr-1.5" />
                  {t.new_order}
                </Button>
              )}
            </div>
          ) : (
            rounds.map((order) => {
              const voided = order.status === "CANCELLED"
              return (
                <section
                  key={order.id}
                  className={`rounded-lg border bg-white p-3.5 ${voided ? "border-slate-200 opacity-55" : "border-slate-200"
                    }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-semibold text-slate-900 truncate">
                        {order.waiter?.name || "—"}
                      </span>
                      <span className="text-xs text-slate-500 tabular-nums shrink-0">
                        {clock(order.createdAt)}
                      </span>
                    </div>
                    <span
                      className={`font-bold text-slate-900 tabular-nums shrink-0 ${voided ? "line-through" : ""
                        }`}
                    >
                      {formatTHB(order.total)}
                    </span>
                  </div>
                  <ul className="space-y-1">
                    {order.items.map((item) => (
                      <li key={item.id} className="flex justify-between gap-3 text-sm text-slate-600">
                        <span className="min-w-0">
                          <span className="tabular-nums text-slate-400 me-1.5">{item.quantity}×</span>
                          {item.name}
                        </span>
                        <span className="tabular-nums shrink-0">{formatTHB(item.total)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })
          )}

          {bill.payments.length > 0 && (
            <section className="rounded-lg border border-slate-200 bg-white p-3.5">
              <h2 className="text-sm font-semibold text-slate-900 mb-2">{t.payments_taken}</h2>
              <ul className="space-y-1">
                {bill.payments.map((p) => {
                  const pending = p.method === "ONEPAY" && p.paymentStatus !== "PAID"
                  return (
                    <li key={p.id} className="flex justify-between gap-3 text-sm">
                      <span className={pending ? "text-slate-400" : "text-slate-600"}>
                        {methodLabel(p.method)}
                        <span className="text-slate-400 text-xs ms-2 tabular-nums">
                          {clock(p.createdAt)}
                        </span>
                        {pending && (
                          <span className="text-xs text-amber-600 ms-2">
                            {t.waiting_for_payment}
                          </span>
                        )}
                      </span>
                      <span className={`tabular-nums ${pending ? "text-slate-400" : "text-slate-700"}`}>
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

      {/* Take a tender. Defaults to the whole balance, which is the common
          case; the amount is editable for a split. */}
      <Dialog open={payOpen} onOpenChange={(o) => { if (!o && !pendingQr) setPayOpen(false) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {pendingQr ? t.scan_to_pay : `${t.take_payment} · ${formatTHB(bill.balance)}`}
            </DialogTitle>
          </DialogHeader>

          {pendingQr ? (
            <div className="text-center space-y-3">
              {/* Rendered locally. The till is on bar wifi and the QR has to
                  appear even when the connection is poor - the same reason the
                  walk-in checkout uses qrcode.react rather than an image API. */}
              <div className="mx-auto w-fit rounded-lg border bg-white p-3">
                <QRCodeSVG value={pendingQr.qr} size={240} level="H" />
              </div>
              <p className="text-2xl font-bold text-slate-900 tabular-nums">
                {formatTHB(pendingQr.amount)}
              </p>
              <p className="text-sm text-amber-700">{t.waiting_for_payment}</p>
              <Button
                variant="outline"
                className="w-full h-11"
                onClick={() => { setPendingQr(null); setPayOpen(false); load() }}
              >
                {t.cancel_qr}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="text-sm text-slate-600">{t.payment_amount}</label>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="h-12 text-lg mt-1 tabular-nums"
                />
                <button
                  onClick={() => setPayAmount(String(bill.balance))}
                  className="text-xs text-amber-700 hover:underline mt-1"
                >
                  {t.pay_full} · {formatTHB(bill.balance)}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button
                  className="h-14 bg-emerald-600 hover:bg-emerald-700 text-white"
                  disabled={busy}
                  onClick={() => takePayment("CASH")}
                >
                  <Banknote className="w-5 h-5 mr-2" />
                  {t.pay_cash}
                </Button>
                <Button
                  className="h-14 bg-slate-900 hover:bg-slate-800 text-white"
                  disabled={busy}
                  onClick={() => takePayment("ONEPAY")}
                >
                  <QrCode className="w-5 h-5 mr-2" />
                  {t.pay_onepay}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <div className="fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 p-3 md:p-4">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-slate-600">{t.bill_total}</span>
            <span className="text-2xl font-bold text-slate-900 tabular-nums">
              {formatTHB(bill.total)}
            </span>
          </div>

          {/* Requirement #17: the kip equivalent and the rate it was struck at.
              On a closed bill this is the rate stored on the row, so it reads
              the same tonight and next month. */}
          <div className="flex items-baseline justify-between text-sm text-slate-500 mt-1">
            <span className="tabular-nums">
              1 ฿ = {bill.fxRateLAK.toLocaleString("en-US")} ₭
            </span>
            <span className="tabular-nums">{formatLAK(thbToLak(bill.total, bill.fxRateLAK))}</span>
          </div>

          {bill.showUsd && (
            <div className="flex items-baseline justify-end text-sm text-slate-500 tabular-nums">
              {formatUSD(thbToUsd(bill.total, bill.fxRateUSD))}
            </div>
          )}

          {/* Only shown once part of the bill is paid - on an untouched bill
              the total is the balance and repeating it is noise. */}
          {!closed && paid > 0 && (
            <div className="flex items-baseline justify-between text-sm mt-2 pt-2 border-t">
              <span className="text-slate-500">{t.amount_paid}</span>
              <span className="text-slate-700 tabular-nums">− {formatTHB(paid)}</span>
            </div>
          )}
          {!closed && paid > 0 && (
            <div className="flex items-baseline justify-between mt-1">
              <span className="text-sm font-semibold text-slate-900">{t.balance_due}</span>
              <span className="text-xl font-bold text-amber-700 tabular-nums">
                {formatTHB(bill.balance)}
              </span>
            </div>
          )}

          {closed ? (
            <p className="text-center text-sm text-slate-500 py-3">{t.session_closed}</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 mt-3">
              <Button
                variant="outline"
                className="h-12 border-slate-300"
                disabled={busy || bill.status === "BILL_REQUESTED"}
                onClick={requestBill}
              >
                <Receipt className="w-4 h-4 mr-2" />
                {t.request_bill}
              </Button>
              {bill.balance > 0 ? (
                <Button
                  className="h-12 bg-amber-600 hover:bg-amber-700 text-white"
                  disabled={busy}
                  onClick={() => { setPayAmount(String(bill.balance)); setPayOpen(true) }}
                >
                  {t.take_payment}
                </Button>
              ) : (
                <Button
                  className="h-12 bg-emerald-600 hover:bg-emerald-700 text-white"
                  disabled={busy}
                  onClick={finalise}
                >
                  <Check className="w-4 h-4 mr-2" />
                  {t.settle_bill}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
