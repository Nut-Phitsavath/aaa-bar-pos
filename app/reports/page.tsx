'use client'

import { useState, useEffect, Fragment } from "react"
import { motion, useReducedMotion } from "motion/react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ServerPerformance } from "@/components/reports/server-performance"
import { VoidAudit } from "@/components/reports/void-audit"
import { NotesReport } from "@/components/reports/notes-report"
import { VarianceReport } from "@/components/reports/variance"
import { ExchangeAudit } from "@/components/reports/exchange-audit"
import {
  Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip, Legend,
  Line, LineChart, Pie, PieChart, Cell
} from "recharts"
import {
  Calendar as CalendarIcon, Download, TrendingUp, DollarSign, ShoppingBag,
  CreditCard, TrendingDown, Clock, Tag, Package, AlertTriangle, Search, Filter, Target, ArrowRightLeft, ShoppingCart, History, ChevronRight
} from "lucide-react"
import Link from "next/link"
import { formatTHB } from "@/lib/currency"
import { formatStockOf } from "@/lib/units"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { format, subDays, startOfDay, endOfDay, isSameDay, startOfToday, endOfToday } from "date-fns"
import { DateRange } from "react-day-picker"
import { useTranslation } from "@/hooks/use-translation"
import { APP_NAME } from "@/lib/shop"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"

const COLORS = ['#d39d40', '#2563eb', '#16a34a', '#7c3aed', '#db2777', '#4b5563']

export default function ReportsPage() {
  const { t } = useTranslation()
  const [productSearch, setProductSearch] = useState("")
  // By area: which areas are opened out to their tables. Opening one keeps
  // the others as they were and never moves the page.
  const [openAreas, setOpenAreas] = useState<Set<string>>(new Set())
  const reduceMotion = useReducedMotion()
  const [data, setData] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subDays(new Date(), 30),
    to: new Date()
  })

  useEffect(() => {
    document.title = `Reports | ${APP_NAME}`
    const checkRole = async () => {
      try {
        const res = await fetch('/api/auth/me')
        if (res.ok) {
          const d = await res.json()
          if (d.user.role === 'STAFF') {
            window.location.href = '/pos'
          }
        }
      } catch (e) { }
    }
    checkRole()
  }, [])

  useEffect(() => {
    if (dateRange?.from && dateRange?.to) {
      fetchReports()
    }
  }, [dateRange])

  const fetchReports = async () => {
    if (!dateRange?.from || !dateRange?.to) return
    setIsLoading(true)
    try {
      const start = startOfDay(dateRange.from).toISOString()
      const end = endOfDay(dateRange.to).toISOString()
      const res = await fetch(`/api/reports/analytics?startDate=${start}&endDate=${end}`)
      if (res.ok) {
        setData(await res.json())
      }
    } catch (e) {
      console.error(e)
    } finally {
      setIsLoading(false)
    }
  }

  // Which hours a deal ran. Indices into hourlySales, which the route already
  // returns in trading-day order - so a window that crosses midnight is just a
  // contiguous slice and needs no wrap-around arithmetic.
  //
  // Null until somebody picks, so the card can fall back to a window derived
  // from the data. Deriving it rather than seeding state in an effect keeps
  // this a plain render and avoids a second pass.
  const [windowFrom, setWindowFrom] = useState<number | null>(null)
  const [windowTo, setWindowTo] = useState<number | null>(null)

  const [refunds, setRefunds] = useState<any>(null)
  const [isLoadingRefunds, setIsLoadingRefunds] = useState(false)

  const fetchRefunds = async () => {
    if (!dateRange?.from || !dateRange?.to) return
    setIsLoadingRefunds(true)
    try {
      const start = startOfDay(dateRange.from).toISOString()
      const end = endOfDay(dateRange.to).toISOString()
      const res = await fetch(`/api/reports/refunds?startDate=${start}&endDate=${end}`)
      if (res.ok) {
        setRefunds(await res.json())
      }
    } catch (e) {
      console.error(e)
    } finally {
      setIsLoadingRefunds(false)
    }
  }

  const handleExport = async () => {
    if (!dateRange?.from || !dateRange?.to) return
    const start = startOfDay(dateRange.from).toISOString()
    const end = endOfDay(dateRange.to).toISOString()
    const url = `/api/reports/export?startDate=${start}&endDate=${end}`
    window.open(url, '_blank')
  }

  const handleExportInventory = async () => {
    if (!dateRange?.from || !dateRange?.to) return
    const start = startOfDay(dateRange.from).toISOString()
    const end = endOfDay(dateRange.to).toISOString()
    const url = `/api/reports/export-inventory?startDate=${start}&endDate=${end}`
    window.open(url, '_blank')
  }

  const getSalesTitle = () => {
    if (!dateRange?.from || !dateRange?.to) return t.today_sales

    const from = startOfToday()
    const isToday = isSameDay(dateRange.from, from) && isSameDay(dateRange.to, endOfToday())
    if (isToday) return t.today_sales_text

    const is7Days = isSameDay(dateRange.from, startOfDay(subDays(new Date(), 7)))
    if (is7Days) return t.this_week_sales

    const is30Days = isSameDay(dateRange.from, startOfDay(subDays(new Date(), 30)))
    if (is30Days) return t.in_30_days_sales

    const is90Days = isSameDay(dateRange.from, startOfDay(subDays(new Date(), 90)))
    if (is90Days) return t.this_quarter_sales

    return t.selected_period_sales
  }

  /**
   * Did the deal work?
   *
   * Compares the hours a promotion ran against the rest of the night, on ALL
   * sales - table bills included. That matters because the promo engine can
   * only attach a code to a counter order, so the promotions report can never
   * see the 87% of trade that goes through a table. A clock does not have that
   * problem: whatever the deal was, it ran between two hours, and those hours
   * either sold better than the others or they did not.
   *
   * Revenue per hour is the figure to read, not the total. A four-hour window
   * will always out-sell a two-hour one, and comparing the raw totals of
   * unequal windows is how a bad deal looks like a good one.
   */
  const hours: any[] = data?.hourlySales ?? []

  // Where to point the card before anyone touches it. The trading day starts
  // at 06:00, so indices 0-2 are the dead morning and a fixed default opened
  // this card reading "-96%" on three empty hours - which looks like a broken
  // report rather than an honest one. The busiest hour and its neighbours is
  // both meaningful and true of any bar, whatever hours it keeps.
  const peak = hours.reduce((best, h, i) => (h.revenue > (hours[best]?.revenue ?? -1) ? i : best), 0)
  const lo = Math.min(windowFrom ?? Math.max(0, peak - 1), windowTo ?? Math.min(hours.length - 1, peak + 1))
  const hi = Math.max(windowFrom ?? Math.max(0, peak - 1), windowTo ?? Math.min(hours.length - 1, peak + 1))
  const inWindow = hours.slice(lo, hi + 1)
  const outWindow = hours.filter((_, i) => i < lo || i > hi)

  const band = (rows: any[]) => {
    const revenue = rows.reduce((n, h) => n + (h.revenue || 0), 0)
    const rounds = rows.reduce((n, h) => n + (h.orders || 0), 0)
    return {
      revenue,
      rounds,
      hours: rows.length,
      perHour: rows.length ? revenue / rows.length : 0,
      avgRound: rounds ? revenue / rounds : 0,
    }
  }
  const inside = band(inWindow)
  const outside = band(outWindow)
  // Percent difference in the per-hour rate. Null rather than Infinity when
  // there is nothing to compare against, so the card says "—" instead of a
  // number that means nothing.
  const lift = outside.perHour > 0 ? ((inside.perHour - outside.perHour) / outside.perHour) * 100 : null

  if (isLoading && !data) return <div className="p-10 text-center">{t.loading_analytics}</div>

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-white sticky top-0 z-10">
        <div className="flex items-center justify-between p-4">
          <h1 className="text-2xl font-bold text-amber-900">{t.advanced_analytics}</h1>

        </div>
      </header>

      <div className="p-6 space-y-6">
        {/* Controls */}
        <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-white p-4 rounded-xl border shadow-sm">
          <div className="flex items-center gap-4 w-full md:w-auto">
            <p className="text-sm font-medium hidden md:block">{t.timeframe}:</p>
            <div className="flex gap-2">
              <Button
                variant={dateRange?.from && isSameDay(dateRange.from, startOfDay(new Date())) && dateRange?.to && isSameDay(dateRange.to, endOfDay(new Date())) ? "default" : "outline"}
                size="sm"
                onClick={() => setDateRange({ from: startOfDay(new Date()), to: endOfDay(new Date()) })}
                className={dateRange?.from && isSameDay(dateRange.from, startOfDay(new Date())) && dateRange?.to && isSameDay(dateRange.to, endOfDay(new Date())) ? "bg-amber-600 text-amber-950 hover:bg-amber-700" : ""}
              >
                {t.today_caps}
              </Button>
              <Button
                variant={dateRange?.from && isSameDay(dateRange.from, startOfDay(subDays(new Date(), 7))) ? "default" : "outline"}
                size="sm"
                onClick={() => setDateRange({ from: startOfDay(subDays(new Date(), 7)), to: new Date() })}
                className={dateRange?.from && isSameDay(dateRange.from, startOfDay(subDays(new Date(), 7))) ? "bg-amber-600 text-amber-950 hover:bg-amber-700" : ""}
              >
                7 {t.days}
              </Button>
              <Button
                variant={dateRange?.from && isSameDay(dateRange.from, startOfDay(subDays(new Date(), 30))) ? "default" : "outline"}
                size="sm"
                onClick={() => setDateRange({ from: startOfDay(subDays(new Date(), 30)), to: new Date() })}
                className={dateRange?.from && isSameDay(dateRange.from, startOfDay(subDays(new Date(), 30))) ? "bg-amber-600 text-amber-950 hover:bg-amber-700" : ""}
              >
                30 {t.days}
              </Button>
              <Button
                variant={dateRange?.from && isSameDay(dateRange.from, startOfDay(subDays(new Date(), 90))) ? "default" : "outline"}
                size="sm"
                onClick={() => setDateRange({ from: startOfDay(subDays(new Date(), 90)), to: new Date() })}
                className={dateRange?.from && isSameDay(dateRange.from, startOfDay(subDays(new Date(), 90))) ? "bg-amber-600 text-amber-950 hover:bg-amber-700" : ""}
              >
                90 {t.days}
              </Button>
            </div>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="flex items-center gap-2">
                  <CalendarIcon className="w-4 h-4" />
                  {dateRange?.from ? (
                    dateRange.to ? (
                      <>
                        {format(dateRange.from, "LLL dd, y")} - {format(dateRange.to, "LLL dd, y")}
                      </>
                    ) : (
                      format(dateRange.from, "LLL dd, y")
                    )
                  ) : (
                    <span>{t.select_date_range}</span>
                  )}

                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  initialFocus
                  mode="range"
                  defaultMonth={dateRange?.from}
                  selected={dateRange}
                  onSelect={setDateRange}
                  numberOfMonths={2}
                />
              </PopoverContent>
            </Popover>
          </div>
          <Button variant="outline" size="sm" onClick={handleExport} className="bg-amber-600 text-amber-950 hover:bg-amber-700 hover:text-white border-amber-600">
            <Download className="w-4 h-4 mr-2" />
            {t.export_report}
          </Button>
        </div>

        {/* Grouped Summary Section */}
        <div className="bg-white p-6 rounded-2xl border shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b pb-4">
            <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <TrendingUp className="w-6 h-6 text-amber-800" />
              {getSalesTitle()}
            </h3>
            <Badge variant="outline" className="text-amber-800 bg-amber-50 border-amber-200 uppercase font-black tracking-widest px-3 py-1">
              {t.summary_overview || "Summary Overview"}
            </Badge>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
            <Card className="shadow-none bg-slate-50/50">
              <CardHeader className="p-4">
                <CardDescription>{t.revenue || "Revenue"}</CardDescription>
                <CardTitle className="text-2xl font-bold">{formatTHB(data?.summary.totalRevenue || 0)}</CardTitle>
                {/* Net of the per-table discount, so this is the same figure
                    the Z-report calls `net`. It used to be the gross, which is
                    why the two documents disagreed on the same night. */}
                <p className="text-[14px] text-muted-foreground mt-1 uppercase tracking-wider font-semibold">{t.billed_tax_incl}</p>
              </CardHeader>
            </Card>
            <Card className="shadow-none bg-slate-50/50">
              <CardHeader className="p-4">
                <CardDescription>{t.net_sales}</CardDescription>
                <CardTitle className="text-2xl font-bold">{formatTHB(data?.summary.netSales || 0)}</CardTitle>
                <p className="text-[14px] text-muted-foreground mt-1 uppercase tracking-wider font-semibold">{t.revenue_before_tax}</p>
              </CardHeader>
            </Card>
            <Card className="shadow-none bg-slate-50/50">
              <CardHeader className="p-4">
                <CardDescription>{t.tax_collected}</CardDescription>
                <CardTitle className="text-2xl font-bold">{formatTHB(data?.summary.taxCollected || 0)}</CardTitle>
                <p className="text-[14px] text-muted-foreground mt-1 uppercase tracking-wider font-semibold">{t.estimated_vat_sales_tax}</p>
              </CardHeader>
            </Card>
            <Card className="shadow-none bg-slate-50/50">
              <CardHeader className="p-4">
                <CardDescription>{t.orders}</CardDescription>
                <CardTitle className="text-2xl font-bold">{data?.summary.totalOrders || 0}</CardTitle>
                <p className="text-[14px] text-muted-foreground mt-1 uppercase tracking-wider font-semibold">{t.total_completed_transactions}</p>
              </CardHeader>
            </Card>
            <Card className="shadow-none bg-slate-50/50">
              <CardHeader className="p-4">
                <CardDescription>{t.aov}</CardDescription>
                <CardTitle className="text-2xl font-bold">{formatTHB(data?.summary.aov || 0)}</CardTitle>
                <p className="text-[14px] text-muted-foreground mt-1 uppercase tracking-wider font-semibold">{t.average_order_value}</p>
              </CardHeader>
            </Card>
            <Card className="shadow-none bg-slate-50/50">
              <CardHeader className="p-4">
                <CardDescription>{t.cogs}</CardDescription>
                <CardTitle className="text-2xl font-bold">{formatTHB(data?.summary.totalCOGS || 0)}</CardTitle>
                <p className="text-[14px] text-muted-foreground mt-1 uppercase tracking-wider font-semibold">{t.cost_of_goods_sold}</p>
              </CardHeader>
            </Card>
            <Card className="shadow-none bg-slate-50/50">
              <CardHeader className="p-4">
                <CardDescription>{t.gross_profit}</CardDescription>
                {/* Colour that says something: green while the bar makes money on what it
                    sells, red if it does not. It was indigo either way. */}
                <CardTitle className={`text-2xl font-bold ${(data?.summary.grossProfit || 0) < 0 ? "text-rose-600" : "text-emerald-700"}`}>{formatTHB(data?.summary.grossProfit || 0)}</CardTitle>
                <p className="text-[14px] text-muted-foreground mt-1 uppercase tracking-wider font-semibold">{t.revenue_minus_cogs}</p>
              </CardHeader>
            </Card>
            {/* What the bar gave away at the table (req #15). It was computed
                and returned and then rendered nowhere, so a manager could not
                see the number even when it was right - and it was reading the
                cafe's per-order column, which this bar never writes, so it was
                ฿0 on every night a table was discounted. */}
            <Card className="shadow-none bg-slate-50/50">
              <CardHeader className="p-4">
                <CardDescription>{t.discounts_given}</CardDescription>
                <CardTitle className="text-2xl font-bold text-orange-700">{formatTHB(data?.summary.totalDiscounts || 0)}</CardTitle>
                <p className="text-[14px] text-muted-foreground mt-1 uppercase tracking-wider font-semibold">{t.table_discounts_desc}</p>
              </CardHeader>
            </Card>
            {/* The number a bar is actually run on, and the one this page made
                you derive from two other cards. Coloured against the same
                bands the recipe editor uses. */}
            <Card className="shadow-none bg-slate-50/50">
              <CardHeader className="p-4">
                <CardDescription>{t.pour_cost}</CardDescription>
                <CardTitle className="text-2xl font-bold tabular-nums">
                  {typeof data?.summary.pourCostPct === "number"
                    ? `${data.summary.pourCostPct.toFixed(1)}%`
                    : "—"}
                </CardTitle>
                <p className="text-[14px] text-muted-foreground mt-1 uppercase tracking-wider font-semibold">{t.pour_cost_desc}</p>
              </CardHeader>
            </Card>

          </div>
        </div>

        <Tabs defaultValue="overview" className="space-y-6">
          {/* Sticky under the 65px page header.
              Clicking a trigger focuses it, and a focused element that has
              scrolled out of view gets scrolled back into view by the browser -
              which is why switching tabs part-way down a long report threw you
              back to the top. Keeping the bar on screen removes the cause
              rather than fighting the symptom, and on a report three thousand
              pixels tall it also means you can change tab without scrolling
              all the way back up to find the tabs. */}
          <div className="sticky top-[65px] z-10 bg-background -mx-6 px-6 py-3 border-b">
            {/* Wraps rather than overflowing: the default TabsList is a fixed
                height inline-flex, so past about seven triggers the last ones are
                clipped off the edge with nothing to indicate they exist. */}
            <TabsList className="bg-muted p-1 rounded-lg flex flex-wrap h-auto justify-start gap-1">
            <TabsTrigger value="overview">{t.overview}</TabsTrigger>
            <TabsTrigger value="products">{t.product_performance}</TabsTrigger>
            <TabsTrigger value="inventory">{t.inventory}</TabsTrigger>
            <TabsTrigger value="advanced" onClick={fetchRefunds}>{t.advanced_and_refunds}</TabsTrigger>
            <TabsTrigger value="operations">{t.operations_payments}</TabsTrigger>
            <TabsTrigger value="promotions">{t.promotions_roi}</TabsTrigger>
            <TabsTrigger value="servers">{t.server_staff}</TabsTrigger>
            <TabsTrigger value="voids">{t.void_audit}</TabsTrigger>
            <TabsTrigger value="exchanges">{t.exchange_log}</TabsTrigger>
            <TabsTrigger value="variance">{t.variance}</TabsTrigger>
            </TabsList>
          </div>

          {/* Holds a screenful open while a tab swaps.

              Radix unmounts the old panel, and every report here renders a
              128-256px skeleton before its data arrives. Switching tabs from
              part-way down a long report therefore collapsed the document from
              thousands of pixels to a few hundred, the browser clamped the
              scroll position to whatever was left, and the reader was thrown to
              the top - which is exactly what making the tab strip sticky was
              meant to avoid. */}
          <div className="min-h-[calc(100vh-10rem)]">

          <TabsContent value="servers">
            {dateRange?.from && dateRange?.to && (
              <ServerPerformance
                startDate={startOfDay(dateRange.from).toISOString()}
                endDate={endOfDay(dateRange.to).toISOString()}
              />
            )}
          </TabsContent>

          {/* Voids and notes share a tab because they are the same kind of
              question: what did staff do during service that nobody stopped
              them doing? One is a line struck off, the other a line annotated,
              and both are read the morning after rather than at the till. */}
          <TabsContent value="voids" className="space-y-6">
            {dateRange?.from && dateRange?.to && (
              <>
                <VoidAudit
                  startDate={startOfDay(dateRange.from).toISOString()}
                  endDate={endOfDay(dateRange.to).toISOString()}
                />
                <NotesReport
                  startDate={startOfDay(dateRange.from).toISOString()}
                  endDate={endOfDay(dateRange.to).toISOString()}
                />
              </>
            )}
          </TabsContent>

          <TabsContent value="variance">
            {dateRange?.from && dateRange?.to && (
              <VarianceReport
                startDate={startOfDay(dateRange.from).toISOString()}
                endDate={endOfDay(dateRange.to).toISOString()}
              />
            )}
          </TabsContent>

          <TabsContent value="exchanges">
            {dateRange?.from && dateRange?.to && (
              <ExchangeAudit
                startDate={startOfDay(dateRange.from).toISOString()}
                endDate={endOfDay(dateRange.to).toISOString()}
              />
            )}
          </TabsContent>

          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Card className="col-span-2">
                <CardHeader>
                  <CardTitle>{t.revenue_trend}</CardTitle>
                </CardHeader>
                <CardContent className="h-[400px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data?.dailyTrend}>
                      <XAxis dataKey="date" fontSize={11} tickFormatter={(val) => val.split('-').slice(1).join('/')} />
                      <YAxis yAxisId="left" orientation="left" stroke="#d39d40" fontSize={11} tickFormatter={(v) => `${(v / 1000)}k`} />
                      <YAxis yAxisId="right" orientation="right" stroke="#2563eb" fontSize={11} />
                      <Tooltip formatter={(v, name) => [name === 'revenue' ? formatTHB(v as number) : v, name]} />
                      <Legend />
                      <Line yAxisId="left" type="monotone" dataKey="revenue" stroke="#d39d40" strokeWidth={2} dot={false} />
                      <Line yAxisId="right" type="monotone" dataKey="orders" stroke="#2563eb" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t.category_share}</CardTitle>
                </CardHeader>
                <CardContent className="h-[400px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={data?.categoryShare}
                        dataKey="revenue"
                        nameKey="category"
                        cx="50%" cy="50%"
                        outerRadius={80}
                        label={(e) => e.category}
                      >
                        {data?.categoryShare.map((entry: any, index: number) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v) => formatTHB(v as number)} />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            {/* Where in the room the money came from.
                `Table.area` has carried INDOOR / OUTDOOR / VIP and this bar's
                own named floors since the floor plan was built, and no report
                had ever grouped by it - the first question an owner asks about
                a bar with VIP rooms, and the page could not answer it.

                Per-hour is the column to read. Takings alone reward a table for
                sitting there all night; a room that turns 8,000 in two hours
                and one that turns 9,000 in six are not the same room. */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Target className="w-5 h-5 text-amber-800" />
                    {t.by_area}
                  </CardTitle>
                  <CardDescription>{t.by_area_desc}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-xs uppercase text-muted-foreground">
                        <tr>
                          <th className="py-2 px-3 text-left">{t.area_label}</th>
                          <th className="py-2 px-3 text-right">{t.revenue}</th>
                          <th className="py-2 px-3 text-right">{t.bills}</th>
                          <th className="py-2 px-3 text-right">{t.avg_bill}</th>
                          <th className="py-2 px-3 text-right">{t.avg_time}</th>
                          <th className="py-2 px-3 text-right">{t.per_hour}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(data?.areaStats || []).map((a: any) => {
                          const open = openAreas.has(a.area)
                          const hm = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
                          return (
                            <Fragment key={a.area}>
                              <tr className="border-b last:border-0">
                                <td className="py-2 px-3 font-bold text-slate-800">
                                  {/* Each area opens to its tables. Per seat-hour is the
                                      table's column: it divides by the seats too, so a
                                      two-top and an eight-seat room compare fairly. */}
                                  <button
                                    type="button"
                                    aria-expanded={open}
                                    aria-label={`${t.show_area_tables} ${a.area}`}
                                    onClick={() => setOpenAreas(prev => {
                                      const next = new Set(prev)
                                      if (next.has(a.area)) next.delete(a.area); else next.add(a.area)
                                      return next
                                    })}
                                    className="-mx-1 flex items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                                  >
                                    <ChevronRight className={`h-4 w-4 shrink-0 text-slate-500 transition-transform duration-200 ease-out motion-reduce:transition-none ${open ? 'rotate-90' : ''}`} />
                                    {a.area}
                                  </button>
                                </td>
                                <td className="py-2 px-3 text-right tabular-nums font-semibold">{formatTHB(a.revenue)}</td>
                                <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">{a.bills}</td>
                                <td className="py-2 px-3 text-right tabular-nums">{formatTHB(a.avgBill)}</td>
                                <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">{hm(a.avgMinutes)}</td>
                                <td className="py-2 px-3 text-right tabular-nums font-black text-amber-800">{formatTHB(a.revenuePerHour)}</td>
                              </tr>
                              {open && (
                                <>
                                  <tr className="bg-slate-50 text-[11px] uppercase text-slate-600">
                                    <th scope="col" className="py-1.5 pl-9 pr-3 text-left font-medium">{t.table}</th>
                                    <th scope="col" className="py-1.5 px-3 text-right font-medium">{t.revenue}</th>
                                    <th scope="col" className="py-1.5 px-3 text-right font-medium">{t.bills}</th>
                                    <th scope="col" className="py-1.5 px-3 text-right font-medium">{t.avg_bill}</th>
                                    <th scope="col" className="py-1.5 px-3 text-right font-medium">{t.avg_time}</th>
                                    <th scope="col" className="py-1.5 px-3 text-right font-medium">{t.per_seat_hour}</th>
                                  </tr>
                                  {(a.tables || []).map((tb: any, i: number) => (
                                    <motion.tr
                                      key={tb.id}
                                      initial={reduceMotion ? false : { opacity: 0 }}
                                      animate={{ opacity: 1 }}
                                      transition={{ duration: 0.18, delay: Math.min(i, 8) * 0.025, ease: [0.25, 1, 0.5, 1] }}
                                      className="border-b bg-slate-50 last:border-0"
                                    >
                                      <td className="py-1.5 pl-9 pr-3 text-slate-800">
                                        <span className="font-semibold">{tb.name}</span>
                                        {tb.seats > 0 && <span className="ml-1.5 whitespace-nowrap text-xs text-slate-600">{tb.seats} {t.seats}</span>}
                                      </td>
                                      <td className="py-1.5 px-3 text-right tabular-nums">{formatTHB(tb.revenue)}</td>
                                      <td className="py-1.5 px-3 text-right tabular-nums text-slate-600">{tb.bills}</td>
                                      <td className="py-1.5 px-3 text-right tabular-nums">{formatTHB(tb.avgBill)}</td>
                                      <td className="py-1.5 px-3 text-right tabular-nums text-slate-600">{hm(tb.avgMinutes)}</td>
                                      <td className="py-1.5 px-3 text-right tabular-nums font-bold text-amber-800">{formatTHB(tb.revenuePerSeatHour)}</td>
                                    </motion.tr>
                                  ))}
                                </>
                              )}
                            </Fragment>
                          )
                        })}
                        {(!data?.areaStats || data.areaStats.length === 0) && (
                          <tr><td colSpan={6} className="py-10 text-center italic text-muted-foreground">{t.no_data_for_period}</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              {/* Pour cost per shelf, against the band that shelf is judged on.
                  Beer at 25% and spirits at 25% are not the same news, which is
                  exactly what a single bar-wide percentage hides. */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Target className="w-5 h-5 text-teal-600" />
                    {t.pour_cost_by_category}
                  </CardTitle>
                  <CardDescription>{t.pour_cost_by_category_desc}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {(data?.categoryShare || []).map((c: any) => (
                      <div key={c.category} className="flex items-center justify-between border-b pb-2 last:border-0 last:pb-0">
                        <div>
                          <p className="font-bold text-slate-800">{c.category}</p>
                          <p className="text-xs text-muted-foreground">{formatTHB(c.revenue)} · {formatTHB(c.cost || 0)} {t.value_at_cost}</p>
                        </div>
                        <div className="text-right">
                          <p className={`font-black tabular-nums ${c.verdict === "OK" ? "text-emerald-600"
                            : c.verdict === "BELOW_COST" ? "text-rose-600"
                              : "text-amber-800"}`}>
                            {typeof c.pourCostPct === "number" ? `${c.pourCostPct.toFixed(1)}%` : "—"}
                          </p>
                          {c.band && (
                            <p className="text-[10px] text-muted-foreground uppercase">{t.target} {c.band[0]}–{c.band[1]}%</p>
                          )}
                        </div>
                      </div>
                    ))}
                    {(!data?.categoryShare || data.categoryShare.length === 0) && (
                      <p className="text-center py-10 text-muted-foreground italic">{t.no_data_for_period}</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Table service vs the walk-in counter: the split that means something
                in a bar, where takeaway vs dine-in always read 100/0. */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>{t.tables_vs_walkin}</CardTitle>
                  <CardDescription>{t.revenue_dist_by_order_type}</CardDescription>
                </CardHeader>
                <CardContent className="h-[350px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={data?.serviceStats || []}
                        dataKey="revenue"
                        nameKey="name"
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={5}
                        label={(e) => `${e.name}: ${formatTHB(e.revenue)}`}
                      >
                        {(data?.serviceStats || []).map((entry: any, index: number) => (
                          <Cell key={`cell-${index}`} fill={index === 0 ? '#d39d40' : '#2563eb'} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v) => formatTHB(v as number)} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card className="">
                <CardHeader>
                  <CardTitle>{t.complimentary_orders}</CardTitle>
                  <CardDescription>{t.owner_friends_not_revenue}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center p-4 bg-rose-50 rounded-lg border border-rose-100">
                      <div>
                        <p className="text-sm text-muted-foreground">{t.total_orders}</p>
                        <p className="text-3xl font-bold text-rose-700">{data?.summary.complimentaryOrders || 0}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-muted-foreground">{t.total_value}</p>
                        <p className="text-2xl font-bold text-orange-600">{formatTHB(data?.summary.complimentaryValue || 0)}</p>
                      </div>
                    </div>
                    {data?.complimentaryDetails?.length > 0 ? (
                      <div className="space-y-2">
                        <p className="text-sm font-semibold text-slate-700">{t.complimentary_customers}</p>
                        {data.complimentaryDetails.map((c: any, i: number) => (
                          <div key={i} className="flex justify-between items-center p-3 bg-white rounded-lg border">
                            <div>
                              <p className="font-semibold text-slate-900">{c.customerName}</p>
                              <p className="text-xs text-muted-foreground">{c.orderCount} {t.orders_lower}</p>
                            </div>
                            <p className="font-bold text-rose-600">{formatTHB(c.totalValue)}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-center text-muted-foreground py-4">{t.no_complimentary_in_period}</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="products" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="lg:col-span-1">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <div>
                    <CardTitle className="text-green-700">{t.best_sellers_caps}</CardTitle>
                    <CardDescription>{t.top_performing_items}</CardDescription>
                  </div>
                  <TrendingUp className="w-5 h-5 text-emerald-500" />
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {data?.topProducts.map((p: any, i: number) => (
                      <div key={i} className="flex justify-between items-center p-4 rounded-xl border bg-white shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex items-center gap-4">
                          <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center font-bold text-amber-900 border border-amber-200 text-xs">
                            {i + 1}
                          </div>
                          <div>
                            <p className="font-bold text-slate-900 leading-tight">{p.productName}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-lg text-emerald-600 leading-none">{p.sold} <span className="text-[10px] text-muted-foreground uppercase font-normal">{t.sold}</span></p>
                          <p className="text-sm font-semibold text-slate-500 mt-1">{formatTHB(p.revenue)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card className="lg:col-span-1 border-amber-200">
                <CardHeader>
                  <div className="flex items-center justify-between mb-2">
                    <CardTitle className="text-amber-800 flex items-center gap-2">
                      <Search className="w-5 h-5" />
                      {t.all_menu_performance}
                    </CardTitle>
                    <Badge className="bg-amber-100 text-amber-800 border-amber-200">{data?.productPerformance?.length || 0} {t.items}</Badge>
                  </div>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input 
                      placeholder={t.search_menu_items} 
                      className="pl-9 bg-slate-50 border-slate-200"
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                    />
                  </div>
                </CardHeader>
                <CardContent className="max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                  <div className="space-y-2">
                    {data?.productPerformance
                      ?.filter((p: any) => p.productName.toLowerCase().includes(productSearch.toLowerCase()))
                      .map((p: any, i: number) => (
                      <div key={i} className="flex justify-between items-center p-3 rounded-lg border bg-white hover:bg-slate-50 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="w-6 h-6 rounded bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-400 border border-slate-200">
                            {i + 1}
                          </div>
                          <div>
                            <p className="font-bold text-sm text-slate-800 leading-tight">{p.productName}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-black text-amber-800">{p.sold}</p>
                          <p className="text-[10px] font-bold text-slate-400">{formatTHB(p.revenue)}</p>
                        </div>
                      </div>
                    ))}
                    {data?.productPerformance?.filter((p: any) => p.productName.toLowerCase().includes(productSearch.toLowerCase())).length === 0 && (
                      <div className="text-center py-12 text-slate-400 italic text-sm">
                        {t.no_product_matches}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-rose-700">
                      <TrendingDown className="w-5 h-5" />
                      {t.low_performance}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {data?.worstProducts.map((p: any, i: number) => (
                        <div key={i} className="flex justify-between items-center text-sm p-3 rounded-lg border bg-slate-50/50">
                          <div>
                            <p className="font-semibold">{p.name}</p>
                          </div>
                          <p className="font-bold text-rose-600">{p.sold} sales</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-rose-200">
                  <CardHeader className="">
                    <CardTitle className="flex items-center gap-2 text-rose-800">
                      <AlertTriangle className="w-5 h-5" />
                      {t.trash_items}
                    </CardTitle>
                    <CardDescription>{t.trash_items_desc}</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-4">
                    <div className="grid grid-cols-2 gap-2">
                      {data?.zeroSales.map((p: any, i: number) => (
                        <div key={i} className="p-2 text-xs bg-muted rounded flex justify-between">
                          <span className="truncate mr-2">{p.name}</span>
                          <span className="text-muted-foreground">{formatTHB(p.price)}</span>
                        </div>
                      ))}
                      {data?.zeroSales.length === 0 && <p className="text-sm text-green-600">{t.great_all_items_sold}</p>}
                    </div>
                  </CardContent>
                </Card>
              </div>

            {/* Sugar level and extra shot used to be reported here. They are a
                cafe's modifier axis - one drink sold four ways - and this bar
                sells four drinks. Across the whole database they hold a single
                value each, "Normal Sweet" and "Normal Shot", on the 50 lines
                that carry them at all: the defaults, never chosen by anyone. */}
          </TabsContent>

          <TabsContent value="promotions" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>{t.promotions_roi}</CardTitle>
                <CardDescription>{t.promo_efficiency}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {(data?.promoImpact || []).map((p: any, i: number) => (
                    <Card key={i} className="p-4 bg-muted/50">
                      <div className="flex items-center gap-2 mb-3">
                        <Tag className="w-5 h-5 text-rose-600 shrink-0" />
                        <h4 className="font-bold text-amber-900 truncate">{p.name}</h4>
                        {p.code && (
                          <Badge variant="outline" className="ms-auto font-mono text-[10px]">{p.code}</Badge>
                        )}
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">{t.times_used}</span>
                          <span className="font-bold tabular-nums">{p.usageCount}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">{t.revenue_gained}</span>
                          <span className="font-bold text-green-600 tabular-nums">{formatTHB(p.totalRevenue)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">{t.total_discount_cost}</span>
                          <span className="font-bold text-rose-600 tabular-nums">−{formatTHB(p.totalDiscount)}</span>
                        </div>
                        {/* What the deal actually left behind, which is the
                            question "ROI" is asking and the old card made you
                            work out in your head. */}
                        <div className="flex justify-between text-sm border-t pt-2">
                          <span className="font-semibold">{t.net_after_promo}</span>
                          <span className="font-black tabular-nums">{formatTHB(p.totalRevenue - p.totalDiscount)}</span>
                        </div>
                      </div>
                    </Card>
                  ))}
                  {(!data?.promoImpact || data.promoImpact.length === 0) && (
                    <p className="text-center py-10 text-muted-foreground w-full col-span-full italic">{t.no_promo_usage}</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="operations" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>{t.peak_hours}</CardTitle>
                  <CardDescription>{t.peak_activity_desc || "Peak activity hours."}</CardDescription>
                </CardHeader>
                <CardContent className="h-[350px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data?.hourlySales}>
                      <XAxis dataKey="hour" tickFormatter={(h) => `${h}:00`} />
                      <YAxis fontSize={11} tickFormatter={(v) => `${(v / 1000)}k`} />
                      <Tooltip formatter={(v) => formatTHB(v as number)} />
                      <Bar dataKey="revenue" fill="#d39d40" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t.payment_method_distribution}</CardTitle>
                  <CardDescription>{t.revenue_split || "Revenue split."}</CardDescription>
                </CardHeader>
                <CardContent className="h-[350px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={data?.paymentMethods}
                        dataKey="revenue"
                        nameKey="paymentMethod"
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={5}
                        label
                      >
                        {data?.paymentMethods.map((entry: any, index: number) => (
                          <Cell key={`cell-${index}`} fill={index === 0 ? '#16a34a' : '#2563eb'} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v) => formatTHB(v as number)} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            {/* Did the deal work?
                Deliberately keyed on the clock rather than on a promo code.
                A promotion can only attach to a counter order, so the ROI tab
                cannot see a table bill - but every deal ran between two hours,
                and the hours are on every sale the bar makes. */}
            <Card>
              <CardHeader className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 space-y-0">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Clock className="w-5 h-5 text-amber-800" />
                    {t.happy_hour_check}
                  </CardTitle>
                  <CardDescription>{t.happy_hour_desc}</CardDescription>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <label className="text-xs text-muted-foreground" htmlFor="hh-from">{t.window_from}</label>
                  <select
                    id="hh-from"
                    value={lo}
                    onChange={(e) => setWindowFrom(Number(e.target.value))}
                    className="h-10 rounded-md border border-slate-200 bg-white px-2 text-sm tabular-nums"
                  >
                    {hours.map((h: any, i: number) => (
                      <option key={i} value={i}>{h.hour}:00</option>
                    ))}
                  </select>
                  <label className="text-xs text-muted-foreground" htmlFor="hh-to">{t.window_to}</label>
                  <select
                    id="hh-to"
                    value={hi}
                    onChange={(e) => setWindowTo(Number(e.target.value))}
                    className="h-10 rounded-md border border-slate-200 bg-white px-2 text-sm tabular-nums"
                  >
                    {hours.map((h: any, i: number) => (
                      <option key={i} value={i}>{h.hour}:59</option>
                    ))}
                  </select>
                </div>
              </CardHeader>
              <CardContent>
                {hours.length === 0 ? (
                  <p className="py-10 text-center italic text-muted-foreground">{t.no_hourly_data}</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                      <p className="text-[11px] font-black uppercase tracking-widest text-amber-800">{t.in_window}</p>
                      <p className="mt-1 text-2xl font-black tabular-nums text-amber-900">{formatTHB(inside.perHour)}</p>
                      <p className="text-[11px] uppercase text-amber-800/70">{t.per_hour}</p>
                      <div className="mt-3 space-y-0.5 text-xs text-slate-600 tabular-nums">
                        <p>{formatTHB(inside.revenue)} · {inside.rounds} {t.rounds_label}</p>
                        <p>{t.avg_round} {formatTHB(inside.avgRound)}</p>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">{t.outside_window}</p>
                      <p className="mt-1 text-2xl font-black tabular-nums text-slate-800">{formatTHB(outside.perHour)}</p>
                      <p className="text-[11px] uppercase text-slate-400">{t.per_hour}</p>
                      <div className="mt-3 space-y-0.5 text-xs text-slate-600 tabular-nums">
                        <p>{formatTHB(outside.revenue)} · {outside.rounds} {t.rounds_label}</p>
                        <p>{t.avg_round} {formatTHB(outside.avgRound)}</p>
                      </div>
                    </div>

                    {/* The whole point of the card, so it gets the big number. */}
                    <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col justify-center">
                      <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">{t.vs_rest}</p>
                      <p className={`mt-1 text-3xl font-black tabular-nums ${lift === null ? "text-slate-400"
                        : lift > 0 ? "text-emerald-700" : "text-rose-600"}`}>
                        {lift === null ? "—" : `${lift > 0 ? "+" : ""}${lift.toFixed(0)}%`}
                      </p>
                      <p className="mt-1 text-xs text-slate-500 tabular-nums">
                        {inside.hours}h {t.vs_rest} {outside.hours}h
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Staff Sales Performance */}
            <div className="grid grid-cols-1 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-indigo-600" />
                    {t.server_sales_performance}
                  </CardTitle>
                  {/* Credited to the waiter who worked the table, not the
                      person who keyed it in. Three staff rotating on the till
                      made this a chart of the roster - three near-identical
                      bars - where the servers behind the same sales differ by
                      almost threefold. Counter sales have no waiter and are
                      nobody's performance, so they are not in here. */}
                  <CardDescription>{t.revenue_per_server}</CardDescription>
                </CardHeader>
                <CardContent className="h-[350px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data?.serverSales || []}>
                      <XAxis dataKey="name" />
                      <YAxis fontSize={11} tickFormatter={(v) => `${(v / 1000)}k`} />
                      <Tooltip formatter={(v) => formatTHB(v as number)} />
                      <Bar dataKey="revenue" fill="#4f46e5" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="inventory" className="space-y-6">
            {/* Counted on the movements this bar actually writes. The row
                used to lead with Transfers, Withdrawals and Total Usage -
                three types the database has never held a single row of - so
                three of five cards read 0 every night while the movements
                that do happen had no card at all. */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
              <Card className="p-4 ">
                <div className="flex items-center gap-3">
                  <div className="bg-purple-100 p-2 rounded-lg">
                    <ShoppingCart className="w-5 h-5 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase font-bold">{t.poured_caps}</p>
                    <p className="text-xl font-bold">{data?.inventoryStats?.transactionTypes?.sold || 0}</p>
                  </div>
                </div>
              </Card>
              <Card className="p-4 ">
                <div className="flex items-center gap-3">
                  <div className="bg-green-100 p-2 rounded-lg">
                    <Package className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase font-bold">{t.received_caps}</p>
                    <p className="text-xl font-bold">{data?.inventoryStats?.transactionTypes?.received || 0}</p>
                  </div>
                </div>
              </Card>
              <Card className="p-4 ">
                <div className="flex items-center gap-3">
                  <div className="bg-blue-100 p-2 rounded-lg">
                    <History className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase font-bold">{t.returned_caps}</p>
                    <p className="text-xl font-bold">{data?.inventoryStats?.transactionTypes?.returned || 0}</p>
                  </div>
                </div>
              </Card>
              <Card className="p-4 ">
                <div className="flex items-center gap-3">
                  <div className="bg-indigo-100 p-2 rounded-lg">
                    <ArrowRightLeft className="w-5 h-5 text-indigo-600" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase font-bold">{t.exchanged_caps}</p>
                    <p className="text-xl font-bold">{data?.inventoryStats?.transactionTypes?.exchanged || 0}</p>
                  </div>
                </div>
              </Card>
              <Card className="p-4 ">
                <div className="flex items-center gap-3">
                  <div className="bg-amber-100 p-2 rounded-lg">
                    <Package className="w-5 h-5 text-amber-800" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase font-bold">{t.adjusted_caps}</p>
                    <p className="text-xl font-bold">{data?.inventoryStats?.transactionTypes?.adjusted || 0}</p>
                  </div>
                </div>
              </Card>
              <Card className="p-4 ">
                <div className="flex items-center gap-3">
                  <div className="bg-rose-100 p-2 rounded-lg">
                    <AlertTriangle className="w-5 h-5 text-rose-600" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase font-bold">{t.voided_back_caps}</p>
                    <p className="text-xl font-bold">{data?.inventoryStats?.transactionTypes?.voidedBack || 0}</p>
                  </div>
                </div>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-orange-500" />
                    {t.most_added_warehouse}
                  </CardTitle>
                  <CardDescription>{t.top_ingredients_added}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {data?.inventoryStats?.mostAdded?.map((item: any, i: number) => (
                      <div key={i} className="flex items-center justify-between border-b pb-2 last:border-0 last:pb-0">
                        <div className="flex items-center gap-3">
                          <Badge variant="outline" className="w-6 h-6 rounded-full flex items-center justify-center p-0">{i + 1}</Badge>
                          <div>
                            <p className="font-bold text-slate-800">{item.name}</p>
                            <p className="text-xs text-muted-foreground">{item.transactions} {t.transactions_lower}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-black text-amber-800">{item.quantity} {item.unit}</p>
                        </div>
                      </div>
                    ))}
                    {(!data?.inventoryStats?.mostAdded || data.inventoryStats.mostAdded.length === 0) && (
                      <p className="text-center py-10 text-muted-foreground italic">{t.no_data_for_period}</p>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* This was "Most Transferred to Shop", reading TRANSFER rows -
                  a movement this bar does not have, so the card was always
                  empty while the movement that matters, stock leaving as
                  drinks, had no card at all. Valued as well as counted: "180
                  bottles" and "3,200 baht" are the same fact told to two
                  different people, and only one of them orders stock. */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ShoppingCart className="w-5 h-5 text-purple-500" />
                    {t.off_the_shelf}
                  </CardTitle>
                  <CardDescription>{t.off_the_shelf_desc}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {data?.inventoryStats?.depletion?.map((item: any, i: number) => (
                      <div key={i} className="flex items-center justify-between border-b pb-2 last:border-0 last:pb-0">
                        <div className="flex items-center gap-3">
                          <Badge variant="outline" className="w-6 h-6 rounded-full flex items-center justify-center p-0">{i + 1}</Badge>
                          <div>
                            <p className="font-bold text-slate-800">{item.name}</p>
                            <p className="text-xs text-muted-foreground">{formatStockOf(item.quantity, item)}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-black text-purple-600">{formatTHB(item.valueAtCost)}</p>
                          <p className="text-[10px] text-muted-foreground uppercase">{t.value_at_cost}</p>
                        </div>
                      </div>
                    ))}
                    {(!data?.inventoryStats?.depletion || data.inventoryStats.depletion.length === 0) && (
                      <p className="text-center py-10 text-muted-foreground italic">{t.no_data_for_period}</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Every one of these is stock back on the shelf on a member of
                staff's word, with nobody checking it arrived (req #14). When a
                count comes up short, this is where to look first. */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <History className="w-5 h-5 text-blue-500" />
                    {t.returned_unopened_title}
                  </CardTitle>
                  <CardDescription>{t.returned_unopened_desc}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {data?.inventoryStats?.returnedUnopened?.map((item: any, i: number) => (
                      <div key={i} className="flex items-center justify-between border-b pb-2 last:border-0 last:pb-0">
                        <div className="flex items-center gap-3">
                          <Badge variant="outline" className="w-6 h-6 rounded-full flex items-center justify-center p-0">{i + 1}</Badge>
                          <div>
                            <p className="font-bold text-slate-800">{item.name}</p>
                            <p className="text-xs text-muted-foreground">{item.transactions} {t.transactions_lower}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-black text-blue-600">{item.quantity} {item.unit}</p>
                        </div>
                      </div>
                    ))}
                    {(!data?.inventoryStats?.returnedUnopened || data.inventoryStats.returnedUnopened.length === 0) && (
                      <p className="text-center py-10 text-muted-foreground italic">{t.no_data_for_period}</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <div>
                  <CardTitle>{t.recent_inventory_tx}</CardTitle>
                  <CardDescription>{t.latest_20_movements}</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={handleExportInventory} className="text-amber-800 border-amber-200 hover:bg-amber-50">
                  <Download className="w-4 h-4 mr-2" />
                  {t.export_excel || "Export Excel"}
                </Button>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30 text-slate-500 font-bold">
                        <th className="py-2 px-3 text-left">{t.date_label}</th>
                        <th className="py-2 px-3 text-left">{t.type_label}</th>
                        <th className="py-2 px-3 text-left">{t.item}</th>
                        <th className="py-2 px-3 text-right">{t.qty}</th>
                        <th className="py-2 px-3 text-left">{t.from_label}</th>
                        <th className="py-2 px-3 text-left">{t.to_label}</th>
                        <th className="py-2 px-3 text-left">{t.staff}</th>
                        <th className="py-2 px-3 text-left">{t.reason}</th>
                        <th className="py-2 px-3 text-left">{t.notes}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data?.inventoryStats?.recentTransactions?.map((tx: any) => (
                        <tr key={tx.id} className="border-b hover:bg-muted/20">
                          <td className="py-2 px-3 text-muted-foreground">{new Date(tx.createdAt).toLocaleDateString('en-GB')}</td>
                          <td className="py-2 px-3">
                            <Badge variant={tx.type === 'TRANSFER' ? 'default' : tx.type === 'PURCHASE' ? 'outline' : 'secondary'} className="text-[10px] font-bold">
                              {tx.type}
                            </Badge>
                          </td>
                          <td className="py-2 px-3 font-medium">{tx.ingredientName}</td>
                          <td className="py-2 px-3 text-right font-bold">{tx.quantity} {tx.unit}</td>
                          <td className="py-2 px-3 text-xs text-muted-foreground">{tx.fromStore || '-'}</td>
                          <td className="py-2 px-3 text-xs text-muted-foreground">{tx.toStore || '-'}</td>
                          <td className="py-2 px-3 text-xs font-semibold">{tx.user || '-'}</td>
                          <td className="py-2 px-3 text-xs italic text-muted-foreground">{tx.reason || '-'}</td>
                          <td className="py-2 px-3 text-xs text-muted-foreground">{tx.notes || '-'}</td>
                        </tr>
                      ))}
                      {(!data?.inventoryStats?.recentTransactions || data.inventoryStats.recentTransactions.length === 0) && (
                        <tr>
                          <td colSpan={9} className="py-10 text-center text-muted-foreground italic">{t.no_transactions_found}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>


          <TabsContent value="advanced" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Money handed back.
                  This listed cancelled ORDERS - rounds struck before anyone
                  paid - under a heading promising refunds, so the one thing a
                  manager opens this for, cash leaving the drawer after a sale,
                  appeared nowhere on the page. It now reads Payment.voidedAt,
                  the source the Z-report has used all along.

                  Two names per row: one rang the money in, the other signed it
                  back out. The pattern worth finding is the same name in the
                  second column over and over. */}
              <Card>
                <CardHeader className="flex flex-row items-start justify-between space-y-0">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <History className="w-5 h-5 text-rose-500" />
                      {t.refund_tracking}
                    </CardTitle>
                    <CardDescription>{t.refunds_desc}</CardDescription>
                  </div>
                  {refunds?.totalCount > 0 && (
                    <div className="text-right">
                      <p className="text-xl font-black text-rose-600 tabular-nums">{formatTHB(refunds.totalValue)}</p>
                      <p className="text-[10px] uppercase text-muted-foreground">{refunds.totalCount} {t.refunded}</p>
                    </div>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30 text-slate-500 font-bold">
                          <th className="py-2 px-3 text-left">{t.date_label}</th>
                          <th className="py-2 px-3 text-left">{t.table}</th>
                          <th className="py-2 px-3 text-left">{t.payment_method}</th>
                          <th className="py-2 px-3 text-right">{t.amount}</th>
                          <th className="py-2 px-3 text-left">{t.staff}</th>
                          <th className="py-2 px-3 text-left">{t.reason}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {isLoadingRefunds ? (
                          <tr><td colSpan={6} className="py-10 text-center">{t.loading_refunds}</td></tr>
                        ) : !refunds?.rows?.length ? (
                          <tr><td colSpan={6} className="py-10 text-center italic text-muted-foreground">{t.no_refunds_found}</td></tr>
                        ) : (
                          refunds.rows.map((r: any) => (
                            <tr key={r.id} className="border-b hover:bg-muted/10">
                              <td className="py-2 px-3 text-slate-500 whitespace-nowrap">
                                {r.refundedAt ? format(new Date(r.refundedAt), "d MMM HH:mm") : "—"}
                              </td>
                              {/* A walk-in counter sale has no table; saying so
                                  beats an empty cell. */}
                              <td className="py-2 px-3 font-medium text-slate-700">{r.table ?? t.walk_in}</td>
                              <td className="py-2 px-3 text-slate-500">{r.method}</td>
                              <td className="py-2 px-3 text-right font-bold text-rose-600">{formatTHB(r.amount)}</td>
                              <td className="py-2 px-3 text-xs text-slate-500">
                                {r.refundedBy ?? "—"}
                                {r.takenBy && r.takenBy !== r.refundedBy && (
                                  <span className="text-slate-400"> · {r.takenBy}</span>
                                )}
                              </td>
                              <td className="py-2 px-3 text-xs italic text-slate-400">{r.reason || "—"}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              {/* Margin Analysis */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingDown className="w-5 h-5 text-amber-500" />
                    {t.low_margin_analysis}
                  </CardTitle>
                  <CardDescription>{t.items_high_cost_vs_price}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {data?.advanced?.lowMarginItems?.map((item: any, i: number) => (
                      <div key={i} className="flex flex-col p-3 rounded-xl border bg-white shadow-sm">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <p className="font-bold text-slate-800">{item.menuName}</p>
                          </div>
                          <Badge variant={item.marginPercent < 20 ? "destructive" : "outline"} className="text-[10px] font-black">
                            {item.marginPercent.toFixed(1)}% {t.margin}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center border-t pt-2">
                          <div>
                            <p className="text-[10px] text-muted-foreground uppercase">{t.price}</p>
                            <p className="font-bold text-blue-600">{formatTHB(item.price)}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground uppercase">{t.cost}</p>
                            <p className="font-bold text-rose-500">{formatTHB(item.cost)}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground uppercase">{t.profit}</p>
                            <p className="font-bold text-emerald-600">{formatTHB(item.margin)}</p>
                          </div>
                        </div>

                        {/* Pour cost, which is the number a bar actually runs
                            on. Margin says what is left; pour cost says whether
                            the pour itself is right, against a band that
                            differs by category - a beer at 30% is healthy where
                            a spirit at 30% is being given away. The verdict is
                            the same one the recipe editor shows, so a manager
                            reading a report and a manager editing a recipe are
                            looking at one number. */}
                        {typeof item.pourCostPct === "number" && item.band && (
                          <div className="flex items-center justify-between gap-2 border-t pt-2 mt-2">
                            <span className="text-[10px] text-muted-foreground uppercase">{t.pour_cost}</span>
                            <span className="flex items-baseline gap-1.5">
                              <span className={`font-black tabular-nums ${item.verdict === "OK" ? "text-emerald-600"
                                : item.verdict === "BELOW_COST" ? "text-rose-600"
                                  : "text-amber-800"
                                }`}>
                                {item.pourCostPct.toFixed(1)}%
                              </span>
                              <span className="text-[10px] text-slate-400 tabular-nums">
                                {t.target} {item.band[0]}–{item.band[1]}%
                              </span>
                            </span>
                          </div>
                        )}
                      </div>
                    ))}
                    {(!data?.advanced?.lowMarginItems || data.advanced.lowMarginItems.length === 0) && (
                      <p className="py-10 text-center italic text-muted-foreground">{t.no_margin_data}</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* COGS & Shrinkage Breakdown */}
              <Card className="lg:col-span-1">
                <CardHeader>
                  <CardTitle>{t.daily_cogs_breakdown}</CardTitle>
                  <CardDescription>{t.sales_vs_wastage_costs}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="p-4 bg-slate-50 rounded-2xl space-y-3">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground">{t.sales_usage_cost}</span>
                      <span className="font-bold">{formatTHB(data?.summary.salesCost || 0)}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground">{t.recorded_wastage}</span>
                      <span className="font-bold text-rose-600">{formatTHB(data?.summary.wastageCost || 0)}</span>
                    </div>
                    <div className="border-t pt-2 flex justify-between items-center text-lg">
                      <span className="font-bold text-slate-800">{t.total_cogs}</span>
                      <span className="font-black text-rose-600">{formatTHB(data?.summary.totalCOGS || 0)}</span>
                    </div>
                  </div>
                  <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-bold text-amber-900">{t.est_inventory_shrinkage}</span>
                      <span className="text-xl font-black text-rose-600">{formatTHB(data?.summary.shrinkageCost || 0)}</span>
                    </div>
                    <p className="text-[10px] text-amber-800 mt-1">{t.stock_loss_shift_discrepancies}</p>
                  </div>
                </CardContent>
              </Card>

              {/* Shrinkage Details */}
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>{t.inventory_shrinkage_details}</CardTitle>
                  <CardDescription>{t.items_with_discrepancies}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30 text-slate-500 font-bold">
                          <th className="py-2 px-3 text-left">{t.item}</th>
                          <th className="py-2 px-3 text-right">{t.qty_diff}</th>
                          <th className="py-2 px-3 text-left">{t.reason}</th>
                          <th className="py-2 px-3 text-left">{t.notes}</th>
                          <th className="py-2 px-3 text-right">{t.loss_value}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data?.advanced?.shrinkageDetails?.length === 0 ? (
                          <tr><td colSpan={5} className="py-10 text-center italic text-muted-foreground">{t.no_stock_shrinkage}</td></tr>
                        ) : (
                          data?.advanced?.shrinkageDetails?.map((s: any, i: number) => (
                            <tr key={i} className="border-b hover:bg-muted/10">
                              <td className="py-2 px-3 font-medium text-slate-700">{s.ingredientName}</td>
                              <td className="py-2 px-3 text-right font-bold text-rose-600">{s.difference}</td>
                              <td className="py-2 px-3 text-left whitespace-nowrap overflow-hidden text-ellipsis max-w-[150px]">{s.reason}</td>
                              <td className="py-2 px-3 text-left text-xs italic text-slate-500 max-w-[200px] truncate">{s.notes}</td>
                              <td className="py-2 px-3 text-right font-bold text-rose-700">{formatTHB(s.lossValue)}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          </div>
        </Tabs>
      </div>
    </div>
  )
}
