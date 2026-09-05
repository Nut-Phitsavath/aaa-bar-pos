"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useTranslation } from "@/hooks/use-translation"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useShift } from "@/components/shift-provider"
import { ShiftDialog } from "@/components/shift-dialog"
import { Users, Clock, Receipt, ShoppingCart, AlertTriangle } from "lucide-react"
import { formatTHB } from "@/lib/currency"
import { formatDuration } from "@/lib/sessions"
import { notify } from "@/components/ui/sonner"

type TableWithSession = {
  id: string
  name: string
  area: string
  seats: number
  displayOrder: number
  session: {
    id: string
    status: string
    openedAt: string
    orderCount: number
    waiterCount: number
    total: number
    customer: { id: string; name: string; owes: number } | null
  } | null
}

const POLL_MS = 5000

export default function TablesPage() {
  const { t } = useTranslation()
  const { status: shiftStatus } = useShift()
  const router = useRouter()
  const [tables, setTables] = useState<TableWithSession[]>([])
  const [area, setArea] = useState("ALL")
  const [now, setNow] = useState(() => new Date())
  const [loading, setLoading] = useState(true)
  const [opening, setOpening] = useState<string | null>(null)
  const [waiters, setWaiters] = useState<{ id: string; name: string }[]>([])
  const [waiterId, setWaiterId] = useState("")
  const [serverPrompt, setServerPrompt] = useState(false)
  const [shiftDialogOpen, setShiftDialogOpen] = useState(false)

  // The server who carried the order to the till. Remembered per device: one
  // server works a section all night, so re-picking every table is noise.
  useEffect(() => {
    fetch("/api/waiters")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: { id: string; name: string }[]) => {
        const active = Array.isArray(list) ? list : []
        setWaiters(active)
        const remembered = localStorage.getItem("pos_waiter")
        if (remembered && active.some((w) => w.id === remembered)) setWaiterId(remembered)
      })
      .catch(() => setWaiters([]))
  }, [])

  const pickWaiter = (id: string) => {
    setWaiterId(id)
    localStorage.setItem("pos_waiter", id)
    setServerPrompt(false)
  }

  // Two independent clocks. The poll pulls fresh totals from the server so a
  // round rung up on another device shows here; the tick only re-renders the
  // durations in between, so cards never look frozen between polls.
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch("/api/tables")
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) setTables(data)
      } catch {
        // A tablet that dropped off the wifi keeps showing the last known
        // floor rather than blanking mid-service.
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    const poll = setInterval(load, POLL_MS)
    return () => { cancelled = true; clearInterval(poll) }
  }, [])

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(tick)
  }, [])

  const areas = useMemo(
    () => ["ALL", ...Array.from(new Set(tables.map((tbl) => tbl.area)))],
    [tables]
  )

  const visible = area === "ALL" ? tables : tables.filter((tbl) => tbl.area === area)

  const freeCount = tables.filter((tbl) => !tbl.session).length
  const occupiedCount = tables.filter((tbl) => tbl.session?.status === "OPEN").length
  const billCount = tables.filter((tbl) => tbl.session?.status === "BILL_REQUESTED").length

  const areaLabel = useCallback((value: string) => {
    if (value === "ALL") return t.all_areas
    if (value === "INDOOR") return t.area_indoor
    if (value === "OUTDOOR") return t.area_outdoor
    if (value === "VIP") return t.area_vip
    return value
  }, [t])

  const openTable = async (table: TableWithSession) => {
    // The API refuses this too - this is so staff read why on the screen they
    // are looking at, rather than tapping a table that silently does nothing.
    if (shiftStatus !== "OPEN") {
      notify.warn(t.please_open_shift_first)
      return
    }
    // Server first, then table, then menu - the order the bar actually works
    // in. Blocking here rather than at Send means a round can never get as far
    // as being keyed with nobody to attribute it to.
    if (!waiterId) {
      setServerPrompt(true)
      return
    }
    if (table.session) {
      router.push(`/pos?session=${table.session.id}`)
      return
    }
    setOpening(table.id)
    try {
      const res = await fetch("/api/table-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableId: table.id }),
      })
      if (res.ok) {
        const session = await res.json()
        router.push(`/pos?session=${session.id}`)
      } else {
        setOpening(null)
      }
    } catch {
      setOpening(null)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="px-4 md:px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-xl md:text-2xl font-bold text-slate-900 leading-tight">{t.tables}</h1>
            <p className="text-sm text-slate-600 mt-0.5 flex items-center gap-3 flex-wrap">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden />
                {freeCount} {t.free}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-slate-400" aria-hidden />
                {occupiedCount} {t.occupied}
              </span>
              {billCount > 0 && (
                <span className="inline-flex items-center gap-1.5 text-amber-700 font-semibold">
                  <span className="w-2 h-2 rounded-full bg-amber-500" aria-hidden />
                  {billCount} {t.bill_requested}
                </span>
              )}
            </p>
          </div>

          <Button
            variant="outline"
            className="h-11 border-slate-300 text-slate-700"
            onClick={() => router.push("/pos")}
          >
            <ShoppingCart className="w-4 h-4 mr-2" />
            {t.walk_in_sale}
          </Button>
        </div>

        {/* Read before anyone taps, not after. A table that silently refuses to
            open reads as a broken till; this says the till is fine and the
            night has not been started yet. */}
        {shiftStatus === "CLOSED" && (
          <div className="mx-4 md:mx-6 mb-3 flex flex-wrap items-center gap-3 rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3">
            <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0" />
            <p className="font-bold text-amber-900">{t.please_open_shift_first}</p>
            <Button
              className="ms-auto h-11 bg-amber-600 hover:bg-amber-700 text-white font-bold"
              onClick={() => setShiftDialogOpen(true)}
            >
              {t.open_shift}
            </Button>
          </div>
        )}

        {/* Step 1 of the flow, and impossible to miss. Until a server is
            picked no table opens, so this is not a setting tucked in a corner -
            it is the gate. */}
        <div className={`px-4 md:px-6 py-2.5 border-t transition-colors duration-200 ${waiterId ? "border-slate-100 bg-white" : "border-amber-200 bg-amber-50"
          }`}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-bold uppercase tracking-widest shrink-0 ${waiterId ? "text-slate-400" : "text-amber-700"
              }`}>
              {waiterId ? t.server_staff : t.select_server_first}
            </span>
            {waiters.map((w) => {
              const active = waiterId === w.id
              return (
                <button
                  key={w.id}
                  onClick={() => pickWaiter(w.id)}
                  aria-pressed={active}
                  className={`h-11 px-5 rounded-xl border-2 font-bold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${active
                    ? "bg-slate-900 border-slate-900 text-white"
                    : "bg-white border-slate-300 text-slate-700 hover:border-amber-400 hover:bg-amber-50"
                    }`}
                >
                  {w.name}
                </button>
              )
            })}
            {waiters.length === 0 && (
              <span className="text-sm text-slate-400">{t.no_servers}</span>
            )}
          </div>
        </div>

        {areas.length > 2 && (
          <div className="px-4 md:px-6 pb-2.5 flex gap-2 overflow-x-auto">
            {areas.map((value) => {
              const active = area === value
              return (
                <button
                  key={value}
                  onClick={() => setArea(value)}
                  aria-pressed={active}
                  className={`h-9 px-3.5 shrink-0 rounded-md text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-1 ${active
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    }`}
                >
                  {areaLabel(value)}
                </button>
              )
            })}
          </div>
        )}
      </header>

      <main className="p-4 md:p-6">
        {loading ? (
          <div className="grid gap-3 md:gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-[168px] rounded-lg bg-white border border-slate-200 animate-pulse" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="max-w-md mx-auto mt-16 text-center">
            <div className="w-12 h-12 rounded-full bg-slate-100 grid place-items-center mx-auto mb-3">
              <Users className="w-6 h-6 text-slate-400" />
            </div>
            <p className="text-slate-900 font-semibold">{t.no_tables_yet}</p>
            <p className="text-sm text-slate-500 mt-1">
              {t.walk_in_sale} &rarr; {t.pos}
            </p>
            <Button variant="outline" className="mt-4 h-11" onClick={() => router.push("/pos")}>
              {t.walk_in_sale}
            </Button>
          </div>
        ) : (
          <div className="grid gap-3 md:gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            {visible.map((table) => {
              const session = table.session
              const needsBill = session?.status === "BILL_REQUESTED"
              const isOpening = opening === table.id

              return (
                <Card
                  key={table.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${table.name}, ${session ? t.occupied : t.free}`}
                  aria-busy={isOpening}
                  onClick={() => !opening && openTable(table)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      if (!opening) openTable(table)
                    }
                  }}
                  className={`p-4 flex flex-col min-h-[168px] cursor-pointer select-none transition-[border-color,box-shadow,background-color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 motion-safe:active:scale-[0.985] ${isOpening ? "opacity-60 pointer-events-none" : ""
                    } ${needsBill
                      ? "bg-amber-50 border-2 border-amber-400 hover:border-amber-500 shadow-sm"
                      : session
                        ? "bg-white border border-slate-300 hover:border-slate-400 hover:shadow-md"
                        : "bg-white border border-slate-200 hover:border-slate-300 hover:shadow-sm"
                    }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h2 className={`text-lg font-bold leading-none ${session ? "text-slate-900" : "text-slate-700"}`}>
                      {table.name}
                    </h2>
                    <span
                      className={`w-2.5 h-2.5 rounded-full mt-1 shrink-0 ${needsBill ? "bg-amber-500" : session ? "bg-slate-400" : "bg-emerald-500"
                        }`}
                      aria-hidden
                    />
                  </div>

                  <p className="text-xs text-slate-500 mt-1.5 flex items-center gap-1">
                    <Users className="w-3.5 h-3.5" aria-hidden />
                    {table.seats} {t.seats}
                  </p>

                  <div className="mt-auto pt-3">
                    {session ? (
                      <>
                        {/* Naming the table exists for this line. A regular who
                            already owes money is only collectable while they are
                            sitting in the room, and nobody opens the Tabs screen
                            on the off-chance. */}
                        {session.customer && (
                          <p className={`text-xs font-bold truncate mb-1 ${session.customer.owes > 0 ? "text-amber-700" : "text-slate-500"
                            }`}>
                            {session.customer.name}
                            {session.customer.owes > 0 && (
                              <span className="ms-1.5 tabular-nums">
                                · {t.owes} {formatTHB(session.customer.owes)}
                              </span>
                            )}
                          </p>
                        )}
                        <p className="text-xl font-bold text-slate-900 leading-none tabular-nums">
                          {formatTHB(session.total)}
                        </p>
                        <p className="text-xs text-slate-500 mt-1.5 flex items-center gap-1 tabular-nums">
                          <Clock className="w-3.5 h-3.5" aria-hidden />
                          {formatDuration(session.openedAt, now)}
                          <span className="text-slate-300">·</span>
                          {session.orderCount} {t.orders}
                          {session.waiterCount > 1 && (
                            <>
                              <span className="text-slate-300">·</span>
                              {session.waiterCount} {t.waiters_count}
                            </>
                          )}
                        </p>

                        {/* Two destinations from one card: tapping it opens the
                            ticket to order, this goes straight to taking money.
                            There is no third "view the bill" screen - the ticket
                            already shows every round. */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            router.push(`/pos/settle?session=${session.id}`)
                          }}
                          className={`mt-3 w-full h-11 rounded-md text-sm font-semibold inline-flex items-center justify-center gap-1.5 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${needsBill
                            ? "bg-amber-600 hover:bg-amber-700 text-white focus-visible:ring-amber-500"
                            : "border border-slate-300 text-slate-700 hover:bg-slate-50 focus-visible:ring-slate-400"
                            }`}
                        >
                          <Receipt className="w-3.5 h-3.5" aria-hidden />
                          {t.settle_bill}
                        </button>
                      </>
                    ) : (
                      <p className="text-sm text-slate-400 h-11 flex items-center">
                        {isOpening ? `${t.open_table}…` : t.open_table}
                      </p>
                    )}
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </main>

      {/* Tapping a table without a server says so plainly, and lets you fix it
          right there rather than sending you back to hunt for the bar. */}
      <Dialog open={serverPrompt} onOpenChange={setServerPrompt}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{t.select_server_first}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {waiters.map((w) => (
              <button
                key={w.id}
                onClick={() => pickWaiter(w.id)}
                className="h-14 rounded-xl border-2 border-slate-300 font-bold text-slate-700 hover:border-amber-400 hover:bg-amber-50 transition-all"
              >
                {w.name}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* The same dialog the sidebar's cash widget opens. A prompt where you
          are blocked, not a trip to another page to press a second button. */}
      <ShiftDialog open={shiftDialogOpen} onOpenChange={setShiftDialogOpen} />
    </div>
  )
}
