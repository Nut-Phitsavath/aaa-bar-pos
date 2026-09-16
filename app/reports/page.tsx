'use client'

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ZReport } from "@/components/reports/z-report"
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
  CreditCard, TrendingDown, Clock, Tag, Package, AlertTriangle, Search, Filter, Target, ArrowRightLeft, ShoppingCart, History, Droplets, Coffee
} from "lucide-react"
import Link from "next/link"
import { formatTHB } from "@/lib/currency"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { format, subDays, startOfDay, endOfDay, isSameDay, startOfToday, endOfToday } from "date-fns"
import { DateRange } from "react-day-picker"
import { useTranslation } from "@/hooks/use-translation"
import { APP_NAME } from "@/lib/shop"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"

const COLORS = ['#d97706', '#2563eb', '#16a34a', '#7c3aed', '#db2777', '#4b5563']

export default function ReportsPage() {
  const { t } = useTranslation()
  const [productSearch, setProductSearch] = useState("")
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

  const [refunds, setRefunds] = useState<any[]>([])
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
                className={dateRange?.from && isSameDay(dateRange.from, startOfDay(new Date())) && dateRange?.to && isSameDay(dateRange.to, endOfDay(new Date())) ? "bg-amber-600 text-white hover:bg-amber-700" : ""}
              >
                {t.today_caps}
              </Button>
              <Button
                variant={dateRange?.from && isSameDay(dateRange.from, startOfDay(subDays(new Date(), 7))) ? "default" : "outline"}
                size="sm"
                onClick={() => setDateRange({ from: startOfDay(subDays(new Date(), 7)), to: new Date() })}
                className={dateRange?.from && isSameDay(dateRange.from, startOfDay(subDays(new Date(), 7))) ? "bg-amber-600 text-white hover:bg-amber-700" : ""}
              >
                7 {t.days}
              </Button>
              <Button
                variant={dateRange?.from && isSameDay(dateRange.from, startOfDay(subDays(new Date(), 30))) ? "default" : "outline"}
                size="sm"
                onClick={() => setDateRange({ from: startOfDay(subDays(new Date(), 30)), to: new Date() })}
                className={dateRange?.from && isSameDay(dateRange.from, startOfDay(subDays(new Date(), 30))) ? "bg-amber-600 text-white hover:bg-amber-700" : ""}
              >
                30 {t.days}
              </Button>
              <Button
                variant={dateRange?.from && isSameDay(dateRange.from, startOfDay(subDays(new Date(), 90))) ? "default" : "outline"}
                size="sm"
                onClick={() => setDateRange({ from: startOfDay(subDays(new Date(), 90)), to: new Date() })}
                className={dateRange?.from && isSameDay(dateRange.from, startOfDay(subDays(new Date(), 90))) ? "bg-amber-600 text-white hover:bg-amber-700" : ""}
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
          <Button variant="outline" size="sm" onClick={handleExport} className="bg-amber-600 text-white hover:bg-amber-700 hover:text-white border-amber-600">
            <Download className="w-4 h-4 mr-2" />
            {t.export_report}
          </Button>
        </div>

        {/* Grouped Summary Section */}
        <div className="bg-white p-6 rounded-2xl border shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b pb-4">
            <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <TrendingUp className="w-6 h-6 text-amber-600" />
              {getSalesTitle()}
            </h3>
            <Badge variant="outline" className="text-amber-700 bg-amber-50 border-amber-200 uppercase font-black tracking-widest px-3 py-1">
              {t.summary_overview || "Summary Overview"}
            </Badge>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
            <Card className="border-l-4 border-l-amber-500 shadow-none bg-slate-50/50">
              <CardHeader className="p-4">
                <CardDescription>{t.revenue || "Revenue"}</CardDescription>
                <CardTitle className="text-2xl font-bold">{formatTHB(data?.summary.totalRevenue || 0)}</CardTitle>
                <p className="text-[14px] text-muted-foreground mt-1 uppercase tracking-wider font-semibold">{t.gross_sales_tax_incl}</p>
              </CardHeader>
            </Card>
            <Card className="border-l-4 border-l-emerald-500 shadow-none bg-slate-50/50">
              <CardHeader className="p-4">
                <CardDescription>{t.net_sales}</CardDescription>
                <CardTitle className="text-2xl font-bold">{formatTHB(data?.summary.netSales || 0)}</CardTitle>
                <p className="text-[14px] text-muted-foreground mt-1 uppercase tracking-wider font-semibold">{t.revenue_before_tax}</p>
              </CardHeader>
            </Card>
            <Card className="border-l-4 border-l-blue-500 shadow-none bg-slate-50/50">
              <CardHeader className="p-4">
                <CardDescription>{t.tax_collected}</CardDescription>
                <CardTitle className="text-2xl font-bold">{formatTHB(data?.summary.taxCollected || 0)}</CardTitle>
                <p className="text-[14px] text-muted-foreground mt-1 uppercase tracking-wider font-semibold">{t.estimated_vat_sales_tax}</p>
              </CardHeader>
            </Card>
            <Card className="border-l-4 border-l-purple-500 shadow-none bg-slate-50/50">
              <CardHeader className="p-4">
                <CardDescription>{t.orders}</CardDescription>
                <CardTitle className="text-2xl font-bold">{data?.summary.totalOrders || 0}</CardTitle>
                <p className="text-[14px] text-muted-foreground mt-1 uppercase tracking-wider font-semibold">{t.total_completed_transactions}</p>
              </CardHeader>
            </Card>
            <Card className="border-l-4 border-l-amber-500 shadow-none bg-slate-50/50">
              <CardHeader className="p-4">
                <CardDescription>{t.aov}</CardDescription>
                <CardTitle className="text-2xl font-bold">{formatTHB(data?.summary.aov || 0)}</CardTitle>
                <p className="text-[14px] text-muted-foreground mt-1 uppercase tracking-wider font-semibold">{t.average_order_value}</p>
              </CardHeader>
            </Card>
            <Card className="border-l-4 border-l-rose-500 shadow-none bg-slate-50/50">
              <CardHeader className="p-4">
                <CardDescription>{t.cogs}</CardDescription>
                <CardTitle className="text-2xl font-bold">{formatTHB(data?.summary.totalCOGS || 0)}</CardTitle>
                <p className="text-[14px] text-muted-foreground mt-1 uppercase tracking-wider font-semibold">{t.cost_of_goods_sold}</p>
              </CardHeader>
            </Card>
            <Card className="border-l-4 border-l-indigo-500 shadow-none bg-slate-50/50">
              <CardHeader className="p-4">
                <CardDescription>{t.gross_profit}</CardDescription>
                <CardTitle className="text-2xl font-bold text-indigo-600">{formatTHB(data?.summary.grossProfit || 0)}</CardTitle>
                <p className="text-[14px] text-muted-foreground mt-1 uppercase tracking-wider font-semibold">{t.revenue_minus_cogs}</p>
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
            <TabsTrigger value="customers">{t.customers}</TabsTrigger>
            <TabsTrigger value="inventory">{t.inventory}</TabsTrigger>
            <TabsTrigger value="advanced" onClick={fetchRefunds}>{t.advanced_and_refunds}</TabsTrigger>
            <TabsTrigger value="operations">{t.operations_payments}</TabsTrigger>
            <TabsTrigger value="promotions">{t.promotions_roi}</TabsTrigger>
            <TabsTrigger value="servers">{t.server_staff}</TabsTrigger>
            <TabsTrigger value="voids">{t.void_audit}</TabsTrigger>
            <TabsTrigger value="exchanges">{t.exchange_log}</TabsTrigger>
            <TabsTrigger value="variance">{t.variance}</TabsTrigger>
            <TabsTrigger value="zreport">{t.z_report}</TabsTrigger>
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

          <TabsContent value="zreport">
            <ZReport />
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
                      <YAxis yAxisId="left" orientation="left" stroke="#d97706" fontSize={11} tickFormatter={(v) => `${(v / 1000)}k`} />
                      <YAxis yAxisId="right" orientation="right" stroke="#2563eb" fontSize={11} />
                      <Tooltip formatter={(v, name) => [name === 'revenue' ? formatTHB(v as number) : v, name]} />
                      <Legend />
                      <Line yAxisId="left" type="monotone" dataKey="revenue" stroke="#d97706" strokeWidth={2} dot={false} />
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
                          <Cell key={`cell-${index}`} fill={index === 0 ? '#d97706' : '#2563eb'} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v) => formatTHB(v as number)} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card className="border-l-4 border-l-rose-500">
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
                          <p className="font-black text-amber-600">{p.sold}</p>
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

            {/* Customization Stats */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-indigo-800 flex items-center gap-2">
                    <Droplets className="w-5 h-5 text-blue-500" />
                    {t.sugar_levels_usage}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {data?.sugarStats?.map((s: any, i: number) => (
                      <div key={i} className="flex justify-between items-center p-3 rounded-xl border bg-white shadow-sm">
                        <span className="font-bold text-slate-700">{s.name}</span>
                        <Badge variant="secondary" className="font-black text-blue-700 bg-blue-50">{s.count} orders</Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-purple-800 flex items-center gap-2">
                    <Coffee className="w-5 h-5 text-purple-500" />
                    {t.extra_shot_usage}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {data?.shotStats?.map((s: any, i: number) => (
                      <div key={i} className="flex justify-between items-center p-3 rounded-xl border bg-white shadow-sm">
                        <span className="font-bold text-slate-700">{s.name}</span>
                        <Badge variant="secondary" className="font-black text-purple-700 bg-purple-50">{s.count} orders</Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="customers" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>{t.member_vs_guest_orders}</CardTitle>
                  <CardDescription>{t.order_dist_by_customer_type}</CardDescription>
                </CardHeader>
                <CardContent className="h-[350px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={data?.customerStats?.memberVsGuest || []}
                        dataKey="count"
                        nameKey="type"
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={5}
                        label
                      >
                        {(data?.customerStats?.memberVsGuest || []).map((entry: any, index: number) => (
                          <Cell key={`cell-${index}`} fill={index === 0 ? '#16a34a' : '#94a3b8'} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t.revenue_member_vs_guest}</CardTitle>
                  <CardDescription>{t.revenue_by_customer_type}</CardDescription>
                </CardHeader>
                <CardContent className="h-[350px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data?.customerStats?.memberVsGuest || []}>
                      <XAxis dataKey="type" />
                      <YAxis fontSize={11} tickFormatter={(v) => `${(v / 1000)}k`} />
                      <Tooltip formatter={(v) => formatTHB(v as number)} />
                      <Bar dataKey="revenue" fill="#16a34a" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Target className="w-5 h-5 text-amber-600" />
                    {t.top_customers_by_loyalty}
                  </CardTitle>
                  <CardDescription>{t.highest_loyalty_holders}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {(data?.customerStats?.topLoyalty || []).map((c: any, i: number) => (
                      <div key={i} className="flex justify-between items-center p-3 rounded-xl border bg-white shadow-sm">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center font-bold text-amber-900 border border-amber-200">
                            {i + 1}
                          </div>
                          <div>
                            <p className="font-bold text-slate-900">{c.name}</p>
                            <p className="text-xs text-muted-foreground">{c.visitCount} {t.visits}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-amber-600">{c.loyaltyPoints} {t.pts}</p>
                          <p className="text-xs text-muted-foreground">{formatTHB(c.totalSpent)}</p>
                        </div>
                      </div>
                    ))}
                    {(!data?.customerStats?.topLoyalty || data.customerStats.topLoyalty.length === 0) && (
                      <p className="text-sm text-center text-muted-foreground py-4">{t.no_customer_data}</p>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t.loyalty_points_overview}</CardTitle>
                  <CardDescription>{t.points_earned_and_redeemed}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="p-4 bg-green-50 rounded-lg border border-green-100">
                      <p className="text-sm text-muted-foreground">{t.total_points_earned}</p>
                      <p className="text-3xl font-bold text-green-700">{data?.customerStats?.totalPointsEarned || 0}</p>
                    </div>
                    <div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
                      <p className="text-sm text-muted-foreground">{t.total_points_redeemed}</p>
                      <p className="text-3xl font-bold text-blue-700">{data?.customerStats?.totalPointsRedeemed || 0}</p>
                    </div>
                    <div className="p-4 bg-amber-50 rounded-lg border border-amber-100">
                      <p className="text-sm text-muted-foreground">{t.active_members}</p>
                      <p className="text-3xl font-bold text-amber-700">{data?.customerStats?.activeMembers || 0}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
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
                      <Bar dataKey="revenue" fill="#d97706" radius={[4, 4, 0, 0]} />
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

            {/* Staff Sales Performance */}
            <div className="grid grid-cols-1 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-indigo-600" />
                    {t.staff_sales_performance}
                  </CardTitle>
                  <CardDescription>{t.revenue_per_staff}</CardDescription>
                </CardHeader>
                <CardContent className="h-[350px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data?.staffSales || []}>
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <Card className="p-4 border-l-4 border-l-blue-500">
                <div className="flex items-center gap-3">
                  <div className="bg-blue-100 p-2 rounded-lg">
                    <ArrowRightLeft className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase font-bold">{t.transfers_caps}</p>
                    <p className="text-xl font-bold">{data?.inventoryStats?.transactionTypes?.transfers || 0}</p>
                  </div>
                </div>
              </Card>
              <Card className="p-4 border-l-4 border-l-green-500">
                <div className="flex items-center gap-3">
                  <div className="bg-green-100 p-2 rounded-lg">
                    <ShoppingCart className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase font-bold">{t.deposits_caps}</p>
                    <p className="text-xl font-bold">{data?.inventoryStats?.transactionTypes?.deposits || 0}</p>
                  </div>
                </div>
              </Card>
              <Card className="p-4 border-l-4 border-l-rose-500">
                <div className="flex items-center gap-3">
                  <div className="bg-rose-100 p-2 rounded-lg">
                    <History className="w-5 h-5 text-rose-600" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase font-bold">{t.withdrawals_caps}</p>
                    <p className="text-xl font-bold">{data?.inventoryStats?.transactionTypes?.withdrawals || 0}</p>
                  </div>
                </div>
              </Card>
              <Card className="p-4 border-l-4 border-l-amber-500">
                <div className="flex items-center gap-3">
                  <div className="bg-amber-100 p-2 rounded-lg">
                    <Package className="w-5 h-5 text-amber-600" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase font-bold">{t.shop_adjusts_caps}</p>
                    <p className="text-xl font-bold">{data?.inventoryStats?.transactionTypes?.shopAdjustments || 0}</p>
                  </div>
                </div>
              </Card>
              <Card className="p-4 border-l-4 border-l-purple-500">
                <div className="flex items-center gap-3">
                  <div className="bg-purple-100 p-2 rounded-lg">
                    <Package className="w-5 h-5 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase font-bold">{t.total_usage_caps}</p>
                    <p className="text-xl font-bold">{data?.inventoryStats?.transactionTypes?.usage || 0}</p>
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
                          <p className="font-black text-amber-600">{item.quantity} {item.unit}</p>
                        </div>
                      </div>
                    ))}
                    {(!data?.inventoryStats?.mostAdded || data.inventoryStats.mostAdded.length === 0) && (
                      <p className="text-center py-10 text-muted-foreground italic">{t.no_data_for_period}</p>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ArrowRightLeft className="w-5 h-5 text-blue-500" />
                    {t.most_transferred_shop}
                  </CardTitle>
                  <CardDescription>{t.top_items_warehouse_to_shop}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {data?.inventoryStats?.mostTransferred?.map((item: any, i: number) => (
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
                    {(!data?.inventoryStats?.mostTransferred || data.inventoryStats.mostTransferred.length === 0) && (
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
                <Button variant="outline" size="sm" onClick={handleExportInventory} className="text-amber-600 border-amber-200 hover:bg-amber-50">
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
              {/* Refund Tracking */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <History className="w-5 h-5 text-rose-500" />
                    {t.refund_tracking}
                  </CardTitle>
                  <CardDescription>{t.all_cancelled_orders_reasons}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30 text-slate-500 font-bold">
                          <th className="py-2 px-3 text-left">{t.order_label}</th>
                          <th className="py-2 px-3 text-left">{t.customer}</th>
                          <th className="py-2 px-3 text-right">{t.amount}</th>
                          <th className="py-2 px-3 text-left">{t.reason}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {isLoadingRefunds ? (
                          <tr><td colSpan={4} className="py-10 text-center">{t.loading_refunds}</td></tr>
                        ) : refunds.length === 0 ? (
                          <tr><td colSpan={4} className="py-10 text-center italic text-muted-foreground">{t.no_refunds_found}</td></tr>
                        ) : (
                          refunds.map((r: any) => (
                            <tr key={r.id} className="border-b hover:bg-muted/10">
                              <td className="py-2 px-3 font-medium text-slate-700">{r.orderNumber}</td>
                              <td className="py-2 px-3 text-slate-500">{r.customerName}</td>
                              <td className="py-2 px-3 text-right font-bold text-rose-600">{formatTHB(r.total)}</td>
                              <td className="py-2 px-3 text-xs italic text-slate-400">{r.reason}</td>
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
                                  : "text-amber-600"
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
                    <p className="text-[10px] text-amber-700 mt-1">{t.stock_loss_shift_discrepancies}</p>
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

          <TabsContent value="promotions" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>{t.promotions_roi}</CardTitle>
                <CardDescription>{t.promo_efficiency || "Promo efficiency."}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {data?.promoImpact.map((p: any, i: number) => (
                    <Card key={i} className="p-4 bg-muted/50 border-rose-100">
                      <div className="flex items-center gap-2 mb-2">
                        <Tag className="w-5 h-5 text-rose-600" />
                        <h4 className="font-bold text-amber-900">{p.name}</h4>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span>{t.times_used}:</span>
                          <span className="font-bold">{p.usageCount}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span>{t.revenue_gained}:</span>
                          <span className="font-bold text-green-600">{formatTHB(p.totalRevenue)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span>{t.total_discount_cost}:</span>
                          <span className="font-bold text-rose-600">-{formatTHB(p.totalDiscount)}</span>
                        </div>
                      </div>
                    </Card>
                  ))}
                  {data?.promoImpact.length === 0 && <p className="text-center py-10 text-muted-foreground w-full col-span-full italic">{t.no_promo_usage}</p>}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  )
}
