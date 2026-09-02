"use client"

import { useState, useEffect, useCallback, use } from "react"
import { useRouter } from "next/navigation"
import { useTranslation } from "@/hooks/use-translation"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Receipt, Plus } from "lucide-react"
import { formatLAK } from "@/lib/currency"
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

  const settle = async (paymentMethod: string) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/table-sessions/${sessionId}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMethod }),
      })
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
                      {formatLAK(order.total)}
                    </span>
                  </div>
                  <ul className="space-y-1">
                    {order.items.map((item) => (
                      <li key={item.id} className="flex justify-between gap-3 text-sm text-slate-600">
                        <span className="min-w-0">
                          <span className="tabular-nums text-slate-400 me-1.5">{item.quantity}×</span>
                          {item.name}
                        </span>
                        <span className="tabular-nums shrink-0">{formatLAK(item.total)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })
          )}
        </div>
      </main>

      <div className="fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 p-3 md:p-4">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-baseline justify-between mb-3">
            <span className="text-sm text-slate-600">{t.bill_total}</span>
            <span className="text-2xl font-bold text-slate-900 tabular-nums">
              {formatLAK(bill.total)}
            </span>
          </div>

          {closed ? (
            <p className="text-center text-sm text-slate-500 py-3">{t.session_closed}</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                className="h-12 border-slate-300"
                disabled={busy || bill.status === "BILL_REQUESTED"}
                onClick={requestBill}
              >
                <Receipt className="w-4 h-4 mr-2" />
                {t.request_bill}
              </Button>
              <Button
                className="h-12 bg-amber-600 hover:bg-amber-700 text-white"
                disabled={busy}
                onClick={() => settle("CASH")}
              >
                {busy ? `${t.settle_bill}…` : t.settle_bill}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
