"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useTranslation } from "@/hooks/use-translation"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ArrowLeft, Clock, User, ChevronDown, UserRound, Search, X, SplitSquareHorizontal } from "lucide-react"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"
import { formatDuration, openedClock } from "@/lib/sessions"
// One rule for lettering a table's bills, shared with the floor plan picker.
import { billLabel, orderBills } from "@/lib/table-ops"
// The same dialog the floor plan opens, so the question looks the same.
import { BillPickerDialog, type PickableBill } from "@/components/pos/bill-picker-dialog"
import { formatTHB } from "@/lib/currency"

export type BannerSession = {
  id: string
  status: string
  openedAt: string
  // `sessions` is every bill still open at this table, oldest first: one entry
  // on an ordinary table, two once a bill has been split. Optional because the
  // banner renders before the bill has loaded.
  table: {
    name: string
    area: string
    sessions?: { id: string; status: string; openedAt: string }[]
  }
}

export type Waiter = { id: string; name: string }

export type BannerCustomer = { id: string; name: string; phone: string | null }

/**
 * Which table, and whose order. Full width across the top of the till.
 *
 * These are the two facts a busy person must never hunt for, so they get the
 * width of the screen rather than a corner of a panel. Anything unset is amber,
 * the same amber the floor plan uses for a missing server, so one colour means
 * one thing everywhere.
 */
export function SessionBanner({
  session,
  waiters,
  waiterId,
  onWaiterChange,
  sessionId,
  customer,
  customerOwes,
  onCustomerChange,
}: {
  /** Null until the bill loads. The bar still occupies its space - see below. */
  session: BannerSession | null
  waiters: Waiter[]
  waiterId: string
  onWaiterChange: (id: string) => void
  sessionId: string
  customer: BannerCustomer | null
  customerOwes: number
  onCustomerChange: () => void
}) {
  const { t } = useTranslation()
  const router = useRouter()
  const [now, setNow] = useState(() => new Date())
  const [picking, setPicking] = useState(false)
  const [naming, setNaming] = useState(false)
  const [people, setPeople] = useState<BannerCustomer[]>([])
  const [q, setQ] = useState("")
  const [newName, setNewName] = useState("")
  const [newPhone, setNewPhone] = useState("")
  const [saving, setSaving] = useState(false)
  // The bill picker, and the rounds/totals it needs, loaded on open.
  const [switching, setSwitching] = useState(false)
  const [switchBills, setSwitchBills] = useState<PickableBill[]>([])

  useEffect(() => {
    if (!naming) return
    fetch("/api/customers")
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => setPeople(Array.isArray(list) ? list : (list?.customers ?? [])))
      .catch(() => setPeople([]))
  }, [naming])

  /** One endpoint for both: an existing id, or a name and phone to create. */
  const setCustomer = async (body: Record<string, unknown>) => {
    setSaving(true)
    try {
      const res = await fetch(`/api/table-sessions/${sessionId}/customer`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) { toast.error(t.error); return }
      const data = await res.json()
      if (data.outstanding > 0) {
        toast.warning(`${data.customer.name} · ${t.outstanding} ${formatTHB(data.outstanding)}`)
      }
      setNaming(false)
      setQ(""); setNewName(""); setNewPhone("")
      onCustomerChange()
    } finally { setSaving(false) }
  }

  const matches = people.filter((c) => {
    const needle = q.trim().toLowerCase()
    if (!needle) return true
    return c.name.toLowerCase().includes(needle) || (c.phone || "").includes(needle)
  })

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(tick)
  }, [])

  const serverName = waiters.find((w) => w.id === waiterId)?.name

  // Only worth showing when the table actually holds more than one bill. On an
  // ordinary table these collapse to the plain table name and no switcher.
  const siblings = session?.table.sessions ?? []
  const split = siblings.length > 1
  const label = session ? billLabel(session.table.name, siblings, session.id) : null
  const others = split ? orderBills(siblings).filter((s) => s.id !== session!.id) : []

  // Rounds and totals for the picker, fetched only when it opens. The bill
  // payload deliberately carries just enough to name the siblings; loading
  // every sibling's orders on every till refresh to fill a dialog nobody has
  // opened would be paying for it all night.
  useEffect(() => {
    if (!switching || !session) return
    let cancelled = false
    fetch("/api/tables")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: { id: string; sessions: PickableBill[] }[]) => {
        if (cancelled) return
        const mine = rows.find((x) => x.sessions?.some((s) => s.id === session.id))
        setSwitchBills(mine?.sessions ?? [])
      })
      .catch(() => { if (!cancelled) setSwitchBills([]) })
    return () => { cancelled = true }
  }, [switching, session])

  return (
    <>
      <div className="bg-slate-900 text-white flex items-stretch shrink-0">
        <button
          onClick={() => router.push("/tables")}
          aria-label={t.back_to_floor}
          className="px-4 grid place-items-center text-slate-300 hover:text-white hover:bg-white/10 transition-colors duration-150 shrink-0"
        >
          <ArrowLeft className="w-6 h-6" />
        </button>

        {/* The bar keeps its height and shape before the bill arrives, so it
            fills in rather than appearing and shoving the page down. The data
            takes ~25ms; the jump was what read as slow. */}
        <div className="flex items-center gap-4 py-2.5 pe-4 min-w-0">
          {/* The whole bill name, one weight and one colour. The suffix was a
              smaller amber "-b" hanging off the table name, which read as a
              rendering fault rather than part of what the bill is called. */}
          <div className="bg-white text-slate-900 rounded-xl px-5 py-1.5 leading-none shrink-0 min-w-[76px] text-center">
            {session
              ? <span className="text-4xl font-black whitespace-nowrap">{label}</span>
              : <span className="text-4xl font-black text-slate-200">·</span>}
          </div>

          {/* Only on a split table, and it opens the same dialog the floor plan
              opens - one question, asked one way, wherever staff meet it. The
              old version listed the sibling inline, which repeated the table
              name beside a box already showing it.

              Each bill keeps its own unsent cart (localStorage is keyed by
              session), so switching cannot carry drinks across. */}
          {split && (
            <button
              onClick={() => setSwitching(true)}
              className="h-11 px-3.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/25 text-sm font-bold inline-flex items-center gap-2 shrink-0 transition-colors duration-150"
            >
              <SplitSquareHorizontal className="w-4 h-4 shrink-0" aria-hidden />
              <span className="tabular-nums">{siblings.length}</span>
              {t.bills_on_table}
              {/* The other party has asked for their bill - worth seeing from
                  this screen, since that is the one you are not looking at. */}
              {others.some((o) => o.status === "BILL_REQUESTED") && (
                <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" aria-hidden />
              )}
            </button>
          )}
          <div className="min-w-0">
            {session ? (
              <>
                <p className="text-lg font-bold text-slate-100 leading-none truncate">
                  {session.table.area}
                </p>
                <p className="text-sm text-slate-400 mt-1.5 flex items-center gap-1.5 tabular-nums">
                  <Clock className="w-4 h-4" />
                  {/* The clock time the party sat down, not only how long ago.
                      "2h 40m" cannot be checked against anything; "19:00" can be
                      read back to a guest arguing about their bill, and matches
                      what the printed slip says. Elapsed time stays because it
                      is the figure staff actually scan the floor for. */}
                  <span className="text-slate-300">{openedClock(session.openedAt)}</span>
                  <span className="text-slate-600">·</span>
                  {formatDuration(session.openedAt, now)}
                  <span className="text-slate-600">·</span>
                  {session.status === "BILL_REQUESTED" ? t.bill_requested : t.occupied}
                </p>
              </>
            ) : (
              <>
                <div className="h-4 w-24 rounded bg-white/10 animate-pulse" />
                <div className="h-3.5 w-32 rounded bg-white/10 animate-pulse mt-2" />
              </>
            )}
          </div>
        </div>

        {/* Whose table this is. Optional - most tables are anonymous - so an
            unnamed one stays quiet rather than amber. Amber is reserved for the
            case that actually needs a decision: a named guest who is already
            down money on other nights, which the till must say now and not at
            settle time when they are halfway to the door. */}
        <button
          onClick={() => setNaming(true)}
          className={`ms-auto flex items-center gap-3 px-5 shrink-0 border-s border-white/10 transition-colors duration-150 ${customerOwes > 0
            ? "bg-amber-500 text-slate-900 hover:bg-amber-400"
            : "hover:bg-white/10"
            }`}
        >
          <UserRound className={`w-6 h-6 ${customerOwes > 0 ? "text-slate-900" : "text-slate-400"}`} />
          <span className="text-start leading-none min-w-0">
            <span
              className={`block text-[11px] font-bold uppercase tracking-widest ${customerOwes > 0 ? "text-slate-900" : "text-slate-400"
                }`}
            >
              {customerOwes > 0 ? t.outstanding : t.customer}
            </span>
            <span className={`block text-2xl font-black mt-1.5 truncate max-w-[220px] ${customer ? "" : "text-slate-500"
              }`}>
              {customerOwes > 0
                ? formatTHB(customerOwes)
                : customer?.name || t.guest}
            </span>
          </span>
          <ChevronDown className="w-5 h-5 opacity-60" />
        </button>

        {/* A named button, not a dropdown: the current server reads without
            opening anything, and changing it is one tap on a name. */}
        <button
          onClick={() => setPicking(true)}
          className={`flex items-center gap-3 px-5 shrink-0 transition-colors duration-150 ${waiterId
            ? "hover:bg-white/10"
            : "bg-amber-500 text-slate-900 hover:bg-amber-400"
            }`}
        >
          <User className={`w-6 h-6 ${waiterId ? "text-slate-400" : "text-slate-900"}`} />
          <span className="text-start leading-none">
            <span
              className={`block text-[11px] font-bold uppercase tracking-widest ${waiterId ? "text-slate-400" : "text-slate-900"
                }`}
            >
              {t.server_staff}
            </span>
            <span className="block text-2xl font-black mt-1.5">
              {serverName || t.select_waiter}
            </span>
          </span>
          <ChevronDown className="w-5 h-5 opacity-60" />
        </button>
      </div>

      <Dialog open={picking} onOpenChange={setPicking}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t.select_waiter}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {waiters.map((w) => (
              <button
                key={w.id}
                onClick={() => { onWaiterChange(w.id); setPicking(false) }}
                className={`h-16 rounded-xl border-2 text-lg font-bold transition-all ${w.id === waiterId
                  ? "bg-slate-900 border-slate-900 text-white"
                  : "border-slate-300 text-slate-700 hover:border-amber-400 hover:bg-amber-50"
                  }`}
              >
                {w.name}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={naming} onOpenChange={setNaming}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t.select_customer_tab}</DialogTitle></DialogHeader>

          {customer && (
            <button
              onClick={() => setCustomer({ customerId: null })}
              disabled={saving}
              className="flex items-center justify-between gap-2 w-full rounded-xl border-2 border-slate-200 px-4 h-12 text-slate-600 hover:border-slate-400 hover:bg-slate-50 transition-colors duration-150"
            >
              <span className="font-semibold truncate">{customer.name}</span>
              <span className="flex items-center gap-1.5 text-sm shrink-0">
                <X className="w-4 h-4" />
                {t.remove}
              </span>
            </button>
          )}

          <div className="relative">
            <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t.search}
              className="h-12 ps-9 rounded-xl border-2"
            />
          </div>

          <div className="max-h-56 overflow-y-auto -mx-1 px-1 space-y-1.5">
            {matches.length === 0 ? (
              <p className="text-sm text-slate-500 py-6 text-center">{t.no_customers_found}</p>
            ) : (
              matches.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCustomer({ customerId: c.id })}
                  disabled={saving}
                  className={`w-full h-14 px-4 rounded-xl border-2 flex items-center justify-between gap-3 transition-colors duration-150 ${c.id === customer?.id
                    ? "bg-slate-900 border-slate-900 text-white"
                    : "border-slate-200 hover:border-amber-400 hover:bg-amber-50"
                    }`}
                >
                  <span className="font-bold truncate">{c.name}</span>
                  {c.phone && (
                    <span className={`text-sm tabular-nums shrink-0 ${c.id === customer?.id ? "text-slate-300" : "text-slate-500"}`}>
                      {c.phone}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>

          {/* Creating here rather than sending someone to a Users screen at 1am.
              Without it the tab lands on whichever name is already in the list,
              and the ledger stops meaning anything. */}
          <div className="pt-3 border-t space-y-2">
            <div className="flex gap-2">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t.name}
                className="h-12 rounded-xl border-2"
              />
              <Input
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder={t.phone}
                inputMode="tel"
                className="h-12 rounded-xl border-2"
              />
            </div>
            <button
              onClick={() => setCustomer({ name: newName, phone: newPhone })}
              disabled={saving || !newName.trim()}
              className="w-full h-12 rounded-xl bg-amber-600 text-amber-950 font-bold hover:bg-amber-700 disabled:opacity-40 disabled:hover:bg-amber-600 transition-colors duration-150"
            >
              {t.add_customer}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Marks the bill already on screen rather than offering it again: two
          identical-looking rows and a tap that goes nowhere is how a waiter
          decides the button is broken. */}
      <BillPickerDialog
        open={switching}
        onClose={() => setSwitching(false)}
        tableName={session?.table.name ?? ""}
        bills={switchBills}
        currentId={session?.id}
        onPick={(billId) => { setSwitching(false); router.push(`/pos?session=${billId}`) }}
      />
    </>
  )
}
