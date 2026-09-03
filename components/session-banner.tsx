"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useTranslation } from "@/hooks/use-translation"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ArrowLeft, Clock, User, ChevronDown } from "lucide-react"
import { formatDuration } from "@/lib/sessions"

export type BannerSession = {
  id: string
  status: string
  openedAt: string
  table: { name: string; area: string }
}

export type Waiter = { id: string; name: string }

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
}: {
  /** Null until the bill loads. The bar still occupies its space - see below. */
  session: BannerSession | null
  waiters: Waiter[]
  waiterId: string
  onWaiterChange: (id: string) => void
}) {
  const { t } = useTranslation()
  const router = useRouter()
  const [now, setNow] = useState(() => new Date())
  const [picking, setPicking] = useState(false)

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(tick)
  }, [])

  const serverName = waiters.find((w) => w.id === waiterId)?.name

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
          <div className="bg-white text-slate-900 rounded-xl px-5 py-1.5 leading-none shrink-0 min-w-[76px] text-center">
            {session
              ? <span className="text-4xl font-black">{session.table.name}</span>
              : <span className="text-4xl font-black text-slate-200">·</span>}
          </div>
          <div className="min-w-0">
            {session ? (
              <>
                <p className="text-lg font-bold text-slate-100 leading-none truncate">
                  {session.table.area}
                </p>
                <p className="text-sm text-slate-400 mt-1.5 flex items-center gap-1.5 tabular-nums">
                  <Clock className="w-4 h-4" />
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

        {/* A named button, not a dropdown: the current server reads without
            opening anything, and changing it is one tap on a name. */}
        <button
          onClick={() => setPicking(true)}
          className={`ms-auto flex items-center gap-3 px-5 shrink-0 transition-colors duration-150 ${waiterId
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
    </>
  )
}
