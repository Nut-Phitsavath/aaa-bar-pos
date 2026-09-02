"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useTranslation } from "@/hooks/use-translation"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ArrowLeft, Clock, Receipt } from "lucide-react"
import { formatLAK } from "@/lib/currency"
import { formatDuration } from "@/lib/sessions"

export type BannerSession = {
  id: string
  openedAt: string
  total: number
  table: { name: string; area: string }
}

export type Waiter = { id: string; name: string }

/**
 * The strip that turns the counter POS into a table terminal.
 *
 * Deliberately dark rather than amber: it sits above a screen already full of
 * amber actions, and its job is to say "you are on a table" without competing
 * with the Send button for attention.
 */
export function SessionBanner({
  session,
  waiters,
  waiterId,
  onWaiterChange,
}: {
  session: BannerSession
  waiters: Waiter[]
  waiterId: string
  onWaiterChange: (id: string) => void
}) {
  const { t } = useTranslation()
  const router = useRouter()
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(tick)
  }, [])

  const needsWaiter = !waiterId

  return (
    <div className="bg-slate-900 text-white px-3 md:px-4 py-2 flex items-center gap-3 flex-wrap shrink-0">
      <button
        onClick={() => router.push("/tables")}
        className="h-10 px-2.5 -ml-1 rounded-md inline-flex items-center gap-1.5 text-sm text-slate-300 hover:text-white hover:bg-white/10 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden />
        <span className="hidden sm:inline">{t.back_to_floor}</span>
      </button>

      <div className="flex items-baseline gap-2 min-w-0">
        <span className="text-lg font-bold leading-none truncate">{session.table.name}</span>
        <span className="text-xs text-slate-400 hidden sm:inline">{session.table.area}</span>
      </div>

      <span className="inline-flex items-center gap-1 text-sm text-slate-300 tabular-nums">
        <Clock className="w-3.5 h-3.5" aria-hidden />
        {formatDuration(session.openedAt, now)}
      </span>

      <div className="ms-auto flex items-center gap-2 md:gap-3">
        <div className="text-right leading-none">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">{t.running_total}</p>
          <p className="text-lg font-bold tabular-nums mt-0.5">{formatLAK(session.total)}</p>
        </div>

        <Select value={waiterId} onValueChange={onWaiterChange}>
          <SelectTrigger
            aria-label={t.select_waiter}
            className={`w-[130px] md:w-[150px] h-10 bg-white text-slate-900 border-0 ${needsWaiter ? "ring-2 ring-amber-400" : ""
              }`}
          >
            <SelectValue placeholder={t.select_waiter} />
          </SelectTrigger>
          <SelectContent>
            {waiters.map((w) => (
              <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <button
          onClick={() => router.push(`/tables/${session.id}/bill`)}
          className="h-10 px-3 rounded-md inline-flex items-center gap-1.5 text-sm font-semibold bg-white/10 hover:bg-white/20 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
        >
          <Receipt className="w-4 h-4" aria-hidden />
          <span className="hidden md:inline">{t.view_bill}</span>
        </button>
      </div>
    </div>
  )
}
