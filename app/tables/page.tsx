"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useTranslation } from "@/hooks/use-translation"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useShift } from "@/components/shift-provider"
import { ShiftDialog } from "@/components/shift-dialog"
import { Users, Clock, Receipt, ShoppingCart, AlertTriangle, LayoutGrid, Sparkles, CalendarClock, X } from "lucide-react"
import { formatTHB } from "@/lib/currency"
import { BillPickerDialog } from "@/components/pos/bill-picker-dialog"
// One place decides what a table is doing; the card, the counts and the legend
// all read it. See lib/table-state.
import { resolveTableState, isSeatable, type TableState } from "@/lib/table-state"
import { formatDuration, openedClock } from "@/lib/sessions"
import { canManageTables } from "@/lib/roles"
import { notify } from "@/components/ui/sonner"

type TableBill = {
  id: string
  status: string
  openedAt: string
  createdAt: string
  /** Confirmed tenders so far. Below `total` means they have started paying. */
  paid: number
  /** When the bill was asked for, so the wait can be aged. */
  billRequestedAt: string | null
  orderCount: number
  waiterCount: number
  total: number
  customer: { id: string; name: string; owes: number } | null
}

type TableWithSession = {
  id: string
  name: string
  area: string
  seats: number
  displayOrder: number
  /** A room sold on a floor, so the booking list can show what it costs. */
  minSpend: number | null
  /** Settled but not yet cleared. */
  needsClearing: boolean
  /** A booking held on this table: who, and when. */
  reservedFor: string | null
  reservedAt: string | null
  session: TableBill | null
  /** Every open bill here. A split leaves two on one table (req #2), and the
   *  card has to reach both — showing only one made the other unreachable
   *  until the first was settled. */
  sessions: TableBill[]
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
  // Which table is being asked "which of these two bills?"
  const [pickingBill, setPickingBill] = useState<TableWithSession | null>(null)
  // Only a manager or the owner edits the floor, so only they see the way in.
  const [canManage, setCanManage] = useState(false)
  // Which table is being cleared, so its button can say so.
  const [clearing, setClearing] = useState<string | null>(null)
  // The bookings dialog: which table, for whom, at what time.
  const [reserving, setReserving] = useState(false)
  const [reserveTable, setReserveTable] = useState("")
  const [reserveName, setReserveName] = useState("")
  const [reserveTime, setReserveTime] = useState("")
  const [savingReserve, setSavingReserve] = useState(false)

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setCanManage(canManageTables(d?.user?.role)))
      .catch(() => setCanManage(false))
  }, [])

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
  /** Hoisted out of the poll so a booking can refresh the floor immediately
   *  rather than waiting up to five seconds for the next tick. */
  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/tables")
      if (!res.ok) return
      setTables(await res.json())
    } catch {
      // A tablet that dropped off the wifi keeps showing the last known floor
      // rather than blanking mid-service.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
    const poll = setInterval(reload, POLL_MS)
    return () => clearInterval(poll)
  }, [reload])

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(tick)
  }, [])

  const areas = useMemo(
    () => ["ALL", ...Array.from(new Set(tables.map((tbl) => tbl.area)))],
    [tables]
  )

  const visible = area === "ALL" ? tables : tables.filter((tbl) => tbl.area === area)

  // One resolver for every table, then counted by state. The header used to
  // work these out with its own filters while the cards used different ones,
  // so the two could disagree about the same floor.
  //
  // Recomputed on the `now` tick as well as on new data, because two of the
  // states age: a booking expires and a wait becomes overdue with no request
  // to the server at all.
  const states = useMemo(
    () => new Map(tables.map((tbl) => [tbl.id, resolveTableState(tbl, now)])),
    [tables, now]
  )
  const countOf = (state: TableState) =>
    tables.filter((tbl) => states.get(tbl.id)?.state === state).length

  const freeCount = countOf("FREE")
  const occupiedCount = countOf("OCCUPIED")
  const billCount = countOf("BILL_REQUESTED")
  const dirtyCount = countOf("DIRTY")
  const reservedCount = countOf("RESERVED")
  // Not a state - a table can be overdue while occupied by the next party's
  // eyes on it - so counted separately and shown only when it is happening.
  const overdueCount = tables.filter((tbl) => states.get(tbl.id)?.overdue).length

  /** One set of words per state, so the card, the counts and a screen reader
   *  never describe the same table differently. */
  const stateLabel = useCallback((state: TableState) => {
    if (state === "BILL_REQUESTED") return t.bill_requested
    if (state === "OCCUPIED") return t.occupied
    if (state === "DIRTY") return t.state_dirty
    if (state === "RESERVED") return t.state_reserved
    return t.free
  }, [t])

  const areaLabel = useCallback((value: string) => {
    if (value === "ALL") return t.all_areas
    if (value === "INDOOR") return t.area_indoor
    if (value === "OUTDOOR") return t.area_outdoor
    if (value === "VIP") return t.area_vip
    return value
  }, [t])

  /** The glasses are gone; the table can take the next party. */
  const clearTable = async (table: TableWithSession) => {
    setClearing(table.id)
    try {
      const res = await fetch(`/api/tables/${table.id}/clear`, { method: "POST" })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        notify.error(err.error === "TABLE_OCCUPIED" ? t.table_has_open_session : t.save_failed)
        return
      }
      // Optimistic, so the card stops looking dirty under the finger that
      // tapped it rather than at the next poll up to five seconds later.
      setTables((prev) => prev.map((x) =>
        x.id === table.id ? { ...x, needsClearing: false } : x))
      notify.success(`${table.name} · ${t.state_cleared}`)
    } catch {
      notify.error(t.save_failed)
    } finally { setClearing(null) }
  }

  /**
   * Hold a table for a party who is coming.
   *
   * The time is a clock time, so it means tonight - and if that time has
   * already passed on the wall clock it means the small hours of tomorrow,
   * which is when this bar is busiest. Booking "01:30" at 23:00 has to land
   * after midnight, not fourteen hours into the past.
   */
  const saveReservation = async () => {
    const [h, m] = reserveTime.split(":").map(Number)
    const at = new Date(now)
    at.setHours(h, m, 0, 0)
    if (at.getTime() < now.getTime()) at.setDate(at.getDate() + 1)

    setSavingReserve(true)
    try {
      const res = await fetch(`/api/tables/${reserveTable}/reserve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reservedFor: reserveName.trim(), reservedAt: at.toISOString() }),
      })
      if (!res.ok) { notify.error(t.save_failed); return }
      notify.success(t.reserved_saved)
      setReserveTable(""); setReserveName(""); setReserveTime("")
      await reload()
    } catch { notify.error(t.save_failed) }
    finally { setSavingReserve(false) }
  }

  const cancelReservation = async (table: TableWithSession) => {
    try {
      const res = await fetch(`/api/tables/${table.id}/reserve`, { method: "DELETE" })
      if (!res.ok) { notify.error(t.save_failed); return }
      setTables((prev) => prev.map((x) =>
        x.id === table.id ? { ...x, reservedFor: null, reservedAt: null } : x))
    } catch { notify.error(t.save_failed) }
  }

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
    // A split table carries two bills. Tapping it has to ask which, rather
    // than silently picking one and leaving the other unreachable.
    if (table.sessions.length > 1) {
      setPickingBill(table)
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
              {/* Only when there is something to say. A row of zeroes teaches
                  staff to stop reading the line. */}
              {dirtyCount > 0 && (
                <span className="inline-flex items-center gap-1.5 text-sky-700 font-semibold">
                  <span className="w-2 h-2 rounded-full bg-sky-500" aria-hidden />
                  {dirtyCount} {t.state_dirty}
                </span>
              )}
              {reservedCount > 0 && (
                <span className="inline-flex items-center gap-1.5 text-violet-700 font-semibold">
                  <span className="w-2 h-2 rounded-full bg-violet-500" aria-hidden />
                  {reservedCount} {t.state_reserved}
                </span>
              )}
              {/* The one number that means somebody is standing there waiting.
                  Loud on purpose, and absent the rest of the night. */}
              {overdueCount > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-rose-600 text-white font-bold px-2 py-0.5">
                  <AlertTriangle className="w-3.5 h-3.5" aria-hidden />
                  {overdueCount} {t.state_waiting_too_long}
                </span>
              )}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {canManage && (
              <Button
                variant="outline"
                className="h-11 border-slate-300 text-slate-700"
                onClick={() => router.push("/tables/manage")}
              >
                <LayoutGrid className="w-4 h-4 mr-2" />
                {t.manage_floor}
              </Button>
            )}
            {/* One control for bookings rather than a button on every free
                card: taking a booking happens a few times a night, and a
                control repeated across twenty cards to be used twice is
                twenty chances to mis-tap while seating somebody. */}
            <Button
              variant="outline"
              className="h-11 border-slate-300 text-slate-700"
              onClick={() => { setReserveTable(""); setReserveName(""); setReserveTime(""); setReserving(true) }}
            >
              <CalendarClock className="w-4 h-4 mr-2" />
              {t.reserve_table}
            </Button>)
            <Button
              variant="outline"
              className="h-11 border-slate-300 text-slate-700"
              onClick={() => router.push("/pos")}
            >
              <ShoppingCart className="w-4 h-4 mr-2" />
              {t.walk_in_sale}
            </Button>
          </div>
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
              // A split table carries two parties. The card is a map of the
              // room, so it stays one card - but it has to say so, and show
              // what the table owes in total rather than half of it.
              const splitCount = table.sessions.length
              const tableTotal = table.sessions.reduce((sum, x) => sum + x.total, 0)
              const isOpening = opening === table.id
              // The one answer, from the one resolver. Everything the card
              // colours or says reads off this.
              const st = states.get(table.id)!
              const needsBill = st.state === "BILL_REQUESTED"
              const isDirty = st.state === "DIRTY"
              const isReserved = st.state === "RESERVED"

              return (
                <Card
                  key={table.id}
                  role="button"
                  tabIndex={0}
                  /* All three states, not two: a bill-requested table used to
                     announce itself as merely "occupied", which is the one
                     state a screen reader user most needs told apart. */
                  aria-label={[
                    table.name,
                    needsBill ? t.bill_requested : session ? t.occupied : t.free,
                    splitCount > 1 ? `${splitCount} ${t.bills_on_table}` : null,
                    session ? formatTHB(tableTotal) : null,
                  ].filter(Boolean).join(", ")}
                  aria-busy={isOpening}
                  onClick={() => !opening && openTable(table)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      if (!opening) openTable(table)
                    }
                  }}
                  /* Three states told by how much ink the card carries, not by
                     a 10px dot. A discotheque runs coloured lighting: under a
                     red or blue wash green and grey stop being distinguishable,
                     but empty-versus-full-versus-flagged still reads. So the
                     progression is a value one - a free table is nearly blank,
                     an occupied one is dense with money and time, and a table
                     waiting to pay is a solid block of amber visible across the
                     room. Hue agrees with it; it does not carry it alone. */
                  className={`p-4 flex flex-col min-h-[168px] cursor-pointer select-none transition-[border-color,box-shadow,background-color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 motion-safe:active:scale-[0.985] ${isOpening ? "opacity-60 pointer-events-none" : ""
                    } ${st.overdue
                      // Nobody went. Louder than every other state on the floor,
                      // and the only one that uses rose - which everywhere else
                      // in this app means money owed.
                      ? "bg-rose-500 border-2 border-rose-600 hover:bg-rose-400 shadow-lg"
                      : needsBill
                        ? "bg-amber-400 border-2 border-amber-500 hover:bg-amber-300 shadow-md"
                        : session
                          ? "bg-white border-2 border-slate-300 hover:border-slate-400 hover:shadow-md"
                          : isDirty
                            // Sky, not a shade of grey: dirty has to be told
                            // apart from free at a glance, and it is the state
                            // most likely to be misread as "available".
                            ? "bg-sky-100 border-2 border-sky-400 hover:bg-sky-50"
                            : isReserved
                              ? "bg-white border-2 border-violet-400 border-dashed hover:bg-violet-50"
                              // Dashed and pale: a free table should read as a
                              // gap in the grid, which is what staff are
                              // scanning for with a party at the door.
                              : "bg-slate-50/60 border-2 border-dashed border-slate-300 hover:border-slate-400 hover:bg-white"
                    }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <h2 className={`font-black leading-none truncate ${needsBill
                      ? "text-xl text-slate-900"
                      : session
                        ? "text-xl text-slate-900"
                        // The only thing on an empty card, so it gets the size.
                        : "text-2xl text-slate-500"
                      }`}>
                      {table.name}
                    </h2>
                    {/* A split table is a second question - how many parties,
                        not what state - so it answers on its own channel: a dark
                        chip that reads as a mark on the card from across the
                        room, rather than a line of small amber text below. */}
                    {splitCount > 1 && (
                      <span className="shrink-0 px-1.5 h-5 grid place-items-center rounded bg-slate-900 text-white text-[11px] font-black tabular-nums">
                        {splitCount}
                      </span>
                    )}
                  </div>

                  {/* The state, in words. The dot alone failed anyone reading
                      from more than a step away, and colour alone fails anyone
                      who cannot separate these hues - or any tablet under a
                      coloured light. */}
                  <p className={`mt-2 text-[11px] font-black uppercase tracking-widest leading-none ${st.overdue
                    ? "text-white"
                    : needsBill ? "text-amber-900"
                      : session ? "text-slate-500"
                        : isDirty ? "text-sky-800"
                          : isReserved ? "text-violet-700"
                            : "text-emerald-700"
                    }`}>
                    {stateLabel(st.state)}
                    {/* How long they have been waiting, on the same line as the
                        state, because "waiting" without "how long" is the thing
                        that was already on the screen. */}
                    {st.waitingMinutes !== null && (
                      <span className="ms-1.5 tabular-nums">· {st.waitingMinutes}m</span>
                    )}
                  </p>

                  {/* Money has been taken and something is still owed. It rides
                      under the state rather than replacing it: they are still
                      sitting there, they have just started settling. */}
                  {st.partPaid && (
                    <p className={`mt-1 text-[11px] font-black uppercase tracking-wide leading-none ${st.overdue ? "text-white/90" : needsBill ? "text-amber-900" : "text-emerald-700"
                      }`}>
                      {t.state_part_paid}
                    </p>
                  )}

                  {/* A booking, shown whatever the state - a table can be dirty
                      AND due at eleven, and whoever is clearing it needs to
                      know somebody is coming. */}
                  {st.reservation && (
                    <p className="mt-1 text-[11px] font-bold text-violet-700 truncate leading-none tabular-nums">
                      {openedClock(st.reservation.at)} · {st.reservation.for}
                    </p>
                  )}

                  <p className={`text-xs mt-1.5 flex items-center gap-1 ${needsBill ? "text-amber-800" : "text-slate-500"
                    }`}>
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
                          <p className={`text-xs font-bold truncate mb-1 ${needsBill
                            ? "text-amber-900"
                            : session.customer.owes > 0 ? "text-amber-700" : "text-slate-500"
                            }`}>
                            {session.customer.name}
                            {session.customer.owes > 0 && (
                              <span className="ms-1.5 tabular-nums">
                                · {t.owes} {formatTHB(session.customer.owes)}
                              </span>
                            )}
                          </p>
                        )}
                        {/* What the table is worth is the figure staff actually
                            scan a floor for, so it is the largest thing on an
                            occupied card - larger than the table's own name. */}
                        <p className="text-2xl font-black text-slate-900 leading-none tabular-nums">
                          {formatTHB(tableTotal)}
                        </p>
                        <p className={`text-xs mt-1.5 flex items-center gap-1 tabular-nums ${needsBill ? "text-amber-800" : "text-slate-500"
                          }`}>
                          <Clock className="w-3.5 h-3.5" aria-hidden />
                          {formatDuration(session.openedAt, now)}
                          <span className={needsBill ? "text-amber-800/50" : "text-slate-300"}>·</span>
                          {session.orderCount} {t.orders}
                          {session.waiterCount > 1 && (
                            <>
                              <span className={needsBill ? "text-amber-800/50" : "text-slate-300"}>·</span>
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
                          /* Dark on the amber card, the same pairing the settle
                             screen's minimum-spend strip uses: on a surface that
                             is already the alert colour, an amber button is the
                             one thing that stops standing out. */
                          className={`mt-3 w-full h-11 rounded-md text-sm font-bold inline-flex items-center justify-center gap-1.5 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${needsBill
                            ? "bg-slate-900 hover:bg-slate-800 text-white focus-visible:ring-slate-900"
                            : "border-2 border-slate-300 text-slate-700 hover:bg-slate-50 focus-visible:ring-slate-400"
                            }`}
                        >
                          <Receipt className="w-3.5 h-3.5" aria-hidden />
                          {t.settle_bill}
                        </button>
                      </>
                    ) : (
                      // A dirty table gets the action that unblocks it, not an
                      // invitation to seat somebody onto glasses. Tapping the
                      // card still opens it - staff who decide to seat anyway
                      // are not stopped, they are just not invited.
                      isDirty ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); clearTable(table) }}
                          disabled={clearing === table.id}
                          className="w-full h-11 rounded-md text-sm font-bold bg-sky-600 hover:bg-sky-700 text-white inline-flex items-center justify-center gap-1.5 transition-colors duration-150 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1"
                        >
                          <Sparkles className="w-3.5 h-3.5" aria-hidden />
                          {clearing === table.id ? `${t.state_clear}…` : t.state_clear}
                        </button>
                      ) : (
                        <p className="text-sm font-bold text-slate-400 h-11 flex items-center">
                          {isOpening ? `${t.open_table}…` : t.open_table}
                        </p>
                      )
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

      {/* Bookings. Deliberately small: a name, a time, and the bookings that
          already exist so one screen answers "what is held tonight" without
          reading twenty cards. See the note on Table.reservedFor for what a
          real diary would add. */}
      <Dialog open={reserving} onOpenChange={(o) => { if (!o) setReserving(false) }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t.reserve_table}</DialogTitle></DialogHeader>

          {/* What is already held, each with the way to cancel it. */}
          {tables.some((x) => states.get(x.id)?.reservation) && (
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              {tables.filter((x) => states.get(x.id)?.reservation).map((x) => {
                const r = states.get(x.id)!.reservation!
                return (
                  <div key={x.id} className="flex items-center gap-3 px-3 py-2.5 border-b border-slate-100 last:border-0">
                    <span className="font-black text-slate-900 w-16 shrink-0">{x.name}</span>
                    <span className="text-sm text-slate-600 flex-1 min-w-0 truncate tabular-nums">
                      {openedClock(r.at)} · {r.for}
                    </span>
                    <button
                      onClick={() => cancelReservation(x)}
                      aria-label={t.reserve_cancel}
                      className="h-9 w-9 grid place-items-center rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          <div className="space-y-3">
            {/* Only tables nobody is sitting at. Booking an occupied table is a
                different promise - "when they leave" - and this does not make
                that promise. */}
            <select
              value={reserveTable}
              onChange={(e) => setReserveTable(e.target.value)}
              className="w-full h-11 rounded-xl border-2 border-slate-300 px-3 font-bold text-slate-800 bg-white"
            >
              <option value="">{t.tables}…</option>
              {tables.filter((x) => x.sessions.length === 0).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} · {areaLabel(x.area)}
                  {x.minSpend ? ` · ${formatTHB(x.minSpend)}` : ""}
                </option>
              ))}
            </select>
            <Input
              className="h-11"
              placeholder={t.reserve_for}
              value={reserveName}
              onChange={(e) => setReserveName(e.target.value)}
              maxLength={80}
            />
            {/* A native time input: staff already know it, it validates itself,
                and it is one tap on a tablet keyboard. */}
            <Input
              className="h-11"
              type="time"
              value={reserveTime}
              onChange={(e) => setReserveTime(e.target.value)}
            />
            <Button
              className="w-full h-12 bg-amber-600 hover:bg-amber-700 font-bold"
              disabled={savingReserve || !reserveTable || !reserveName.trim() || !reserveTime}
              onClick={saveReservation}
            >
              {savingReserve ? `${t.reserve_table}…` : t.reserve_table}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Which of the two bills? A split table has two parties sitting at it,
          and picking one for the staff member would leave the other one
          unreachable. The same dialog the till opens - see BillPickerDialog. */}
      <BillPickerDialog
        open={!!pickingBill}
        onClose={() => setPickingBill(null)}
        tableName={pickingBill?.name ?? ""}
        bills={pickingBill?.sessions ?? []}
        onPick={(billId) => { setPickingBill(null); router.push(`/pos?session=${billId}`) }}
      />

      {/* The same dialog the sidebar's cash widget opens. A prompt where you
          are blocked, not a trip to another page to press a second button. */}
      <ShiftDialog open={shiftDialogOpen} onOpenChange={setShiftDialogOpen} />
    </div>
  )
}
