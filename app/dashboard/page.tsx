"use client"

import { useState, useEffect } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { DollarSign, ShoppingCart, TrendingUp, AlertTriangle, Play, Calendar, Wallet } from "lucide-react"
import { useTranslation } from "@/hooks/use-translation"
import { useRouter } from "next/navigation"
import { formatLAK } from "@/lib/currency"
import { useShift } from "@/components/shift-provider"
import { ShiftDialog } from "@/components/shift-dialog"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Input as ShiftInput } from "@/components/ui/input"
import { Label as ShiftLabel } from "@/components/ui/label"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell
} from "recharts"
import { cn } from "@/lib/utils"
import { formatLongDate } from "@/lib/date"

export default function DashboardPage() {
  const { t, lang } = useTranslation()
  const router = useRouter()
  const { status: shiftStatus, startCash, cashPayments, activeShiftId, checkShiftStatus } = useShift()

  const [data, setData] = useState<any>(null)
  const [analytics, setAnalytics] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [user, setUser] = useState<any>(null)

  // Shift Management States
  const [isShiftDialogOpen, setIsShiftDialogOpen] = useState(false)
  const [isEndShiftOpen, setIsEndShiftOpen] = useState(false)
  const [actualCash, setActualCash] = useState("")
  const [isProcessing, setIsProcessing] = useState(false)

  useEffect(() => {
    document.title = "Dashboard | Memories Lane"
    const initDashboard = async () => {
      try {
        // 1. Fetch user
        const userRes = await fetch('/api/auth/me')
        if (userRes.ok) {
          const userData = await userRes.json()
          setUser(userData.user)

          // If staff, dashboard is not for them
          if (userData.user.role === 'STAFF') {
            window.location.href = '/pos'
            return
          }
        }

        // 2. Fetch stats
        const statsRes = await fetch('/api/dashboard/stats')
        if (statsRes.ok) {
          setData(await statsRes.json())
        }

        // 3. Fetch analytics for peak hours (today)
        const today = new Date().toISOString().split('T')[0]
        const analyticsRes = await fetch(`/api/reports/analytics?startDate=${today}&endDate=${today}`)
        if (analyticsRes.ok) {
          setAnalytics(await analyticsRes.json())
        }
      } catch (e) {
        console.error(e)
      } finally {
        setIsLoading(false)
      }
    }

    initDashboard()
  }, [router])

  const handleEndShift = async () => {
    if (!activeShiftId || !actualCash) return
    setIsProcessing(true)
    try {
      const res = await fetch('/api/shifts', {
        method: 'PUT',
        body: JSON.stringify({
          id: activeShiftId,
          actualCash: parseFloat(actualCash)
        }),
        headers: { 'Content-Type': 'application/json' }
      })
      if (res.ok) {
        setIsEndShiftOpen(false)
        setActualCash("")
        await checkShiftStatus()
        // Refresh dashboard data
        const statsRes = await fetch('/api/dashboard/stats')
        if (statsRes.ok) setData(await statsRes.json())
      }
    } catch (error) {
      console.error('Failed to end shift:', error)
    } finally {
      setIsProcessing(false)
    }
  }

  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="flex flex-col items-center gap-4">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-900"></div>
        <p className="text-amber-900 font-medium">{t.loading_dashboard || "Loading Dashboard..."}</p>
      </div>
    </div>
  )

  const currentCash = (startCash || 0) + (cashPayments || 0)

  const statIcons: Record<string, any> = {
    "Today's Sales": DollarSign,
    "Orders": ShoppingCart,
    "Avg Order Value": TrendingUp,
    "Low Stock Items": AlertTriangle
  }

  const statColors: Record<string, string> = {
    "Today's Sales": "text-emerald-600",
    "Orders": "text-blue-600",
    "Avg Order Value": "text-violet-600",
    "Low Stock Items": "text-orange-600"
  }

  const statBgs: Record<string, string> = {
    "Today's Sales": "bg-emerald-50",
    "Orders": "bg-blue-50",
    "Avg Order Value": "bg-violet-50",
    "Low Stock Items": "bg-orange-50"
  }

  // Find peak hour
  const peakHour = analytics?.hourlySales?.reduce((prev: any, current: any) =>
    (prev.revenue > current.revenue) ? prev : current, { hour: '--', revenue: 0 }
  )

  return (
    <div className="p-6 lg:p-10 space-y-8">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-row items-center gap-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">{t.dashboard}</h1>
            <p className="text-slate-500 mt-1">{t.dashboard_welcome || "Welcome back! Here's what's happening today."}</p>
          </div>
          <div className="items-center align-center justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push('/shifts')}
              className="rounded-xl font-bold text-slate-600 hover:text-amber-900 border-slate-200"
            >
              {t.shift_history || "Shift History"}
            </Button>
          </div>

        </div>



        <div className="flex items-center gap-3">
          <div className={cn(
            "px-4 py-2 rounded-full flex items-center gap-2 border font-bold text-sm cursor-pointer hover:bg-slate-50 transition-colors",
            shiftStatus === 'OPEN' ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-rose-50 text-rose-700 border-rose-200"
          )} onClick={() => shiftStatus === 'CLOSED' ? setIsShiftDialogOpen(true) : setIsEndShiftOpen(true)}>
            <div className={cn("w-2 h-2 rounded-full", shiftStatus === 'OPEN' ? "bg-emerald-500 animate-pulse" : "bg-rose-500")} />
            {shiftStatus === 'OPEN' ? t.shift_open : t.shift_closed}
          </div>
          <div className="px-4 py-2 rounded-full bg-white border border-slate-200 shadow-sm flex items-center gap-2 text-sm font-bold text-slate-700">
            <Calendar className="w-4 h-4 text-slate-400" />
            {formatLongDate(new Date(), lang, { weekday: true })}
          </div>

        </div>
      </div>

      {/* Primary Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        {data?.summary.map((stat: any) => {
          const Icon = statIcons[stat.title] || DollarSign
          return (
            <Card key={stat.title} className="p-6 border-none shadow-sm hover:shadow-md transition-shadow bg-white">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-500 mb-1">
                    {stat.title === "Today's Sales" ? t.today_sales :
                      stat.title === "Orders" ? t.orders :
                        stat.title === "Avg Order Value" ? t.avg_order_value :
                          stat.title === "Low Stock Items" ? t.low_stock_items : stat.title}
                  </p>
                  <p className="text-2xl font-black text-slate-900 mb-1">
                    {stat.type === "currency" ? formatLAK(stat.value) : stat.value}
                  </p>
                  <div className="flex items-center gap-1.5">
                    <span className={cn(
                      "text-xs font-bold px-1.5 py-0.5 rounded",
                      stat.change.startsWith('-') ? 'text-red-600 bg-red-50' :
                        stat.title == "Low Stock Items" ? 'text-red-600 bg-red-50'
                          : 'text-emerald-600 bg-emerald-50'
                    )}>
                      {stat.change}
                    </span>
                    <span className="text-[10px] text-slate-400 font-medium">{t.vs_yesterday}</span>
                  </div>
                </div>
                <div className={cn(statBgs[stat.title], "p-3 rounded-2xl shadow-inner")}>
                  <Icon className={cn("w-7 h-7", statColors[stat.title])} />
                </div>
              </div>
            </Card>
          )
        })}
      </div>

      <div className="grid xl:grid-cols-3 gap-8">
        {/* Hourly Sales / Peak Hours Chart */}
        <Card className="xl:col-span-2 p-6 border-none shadow-sm bg-white">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-xl font-bold text-slate-900">{t.hourly_sales || "Hourly Sales (Peak Hours)"}</h2>
              <p className="text-sm text-slate-500 font-medium">{t.busiest_hours_today} <span className="text-amber-600 font-bold">{peakHour?.hour}:00</span></p>
            </div>
            <div className="p-3 bg-amber-50 rounded-xl text-center min-w-[100px]">
              <p className="text-[10px] text-amber-700 font-bold uppercase tracking-wider">{t.peak_revenue}</p>
              <p className="text-lg font-black text-amber-900 leading-tight">{formatLAK(peakHour?.revenue)}</p>
            </div>
          </div>

          <div className="h-[300px] w-full mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics?.hourlySales || []} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis
                  dataKey="hour"
                  axisLine={{ stroke: '#e2e8f0' }}
                  tickLine={false}
                  tick={{ fill: '#64748b', fontSize: 12, fontWeight: 600 }}
                  tickFormatter={(val) => `${val}:00`}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 500 }}
                  tickFormatter={(val) => val > 0 ? `${(val / 1000).toFixed(0)}k` : ''}
                />
                <Tooltip
                  cursor={{ fill: '#f8fafc' }}
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className="bg-white p-3 shadow-xl rounded-lg border border-slate-100">
                          <p className="text-xs font-bold text-slate-500 mb-1">{payload[0].payload.hour}:00</p>
                          <p className="text-sm font-black text-amber-900">{formatLAK(payload[0].value as number)}</p>
                          <p className="text-[10px] text-slate-400 font-medium">{payload[0].payload.orders} orders</p>
                        </div>
                      )
                    }
                    return null
                  }}
                />
                <Bar
                  dataKey="revenue"
                  radius={[6, 6, 0, 0]}
                  barSize={40}
                >
                  {(analytics?.hourlySales || []).map((entry: any, index: number) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={entry.hour === peakHour?.hour ? '#92400e' : '#d97706'}
                      opacity={entry.revenue > 0 ? 1 : 0.1}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Right Column: Cash & Quick Stats */}
        <div className="space-y-6">
          {/* Cash in Drawer Card */}
          <Card className="p-6 border-none shadow-sm bg-amber-900 text-white overflow-hidden relative group">
            <div className="absolute -right-6 -bottom-6 opacity-10 group-hover:scale-110 transition-transform duration-500">
              <Wallet className="w-32 h-32" />
            </div>
            <div className="relative z-10">
              <p className="text-amber-200/80 font-bold text-xs uppercase tracking-widest mb-2">{t.cash_in_drawer || "Current Cash in Drawer"}</p>
              <h3 className="text-4xl font-black mb-4">{formatLAK(currentCash)}</h3>
              <div className="flex items-center gap-4 text-sm font-medium">
                <div className="bg-white/10 px-3 py-1.5 rounded-lg border border-white/10">
                  <span className="text-amber-200/60 mr-1.5">{t.start_label}</span>
                  <span className="font-bold">{formatLAK(startCash || 0)}</span>
                </div>
                <div className="bg-white/10 px-3 py-1.5 rounded-lg border border-white/10">
                  <span className="text-amber-200/60 mr-1.5">{t.sales_label}</span>
                  <span className="font-bold">{formatLAK(cashPayments || 0)}</span>
                </div>
              </div>
            </div>
          </Card>

          {/* Active Orders Count Snippet */}
          <Card className="p-6 border-none shadow-sm bg-white">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-800">{t.active_orders}</h3>
              <span className="bg-blue-100 text-blue-700 text-xs font-black px-2 py-1 rounded-full">{data?.activeOrders.length || 0}</span>
            </div>
            <div className="space-y-3">
              {data?.activeOrders.slice(0, 3).map((order: any) => (
                <div key={order.id} className="flex items-center justify-between text-sm py-2 border-b border-slate-50 last:border-0">
                  <span className="font-semibold text-slate-700">{order.orderNumber}</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{order.status}</span>
                </div>
              ))}
              <Button
                variant="ghost"
                className="w-full text-blue-600 font-bold text-xs hover:bg-blue-50"
                onClick={() => router.push('/orders')}
              >
                {t.view_all_orders || "View All Orders"}
              </Button>
            </div>
          </Card>

          {/* Low Stock Highlight */}
          {data?.lowStockAlerts.length > 0 && (
            <Card className="p-6 border-none shadow-sm bg-orange-50 border-l-4 border-orange-500">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="w-5 h-5 text-orange-600" />
                <h3 className="font-bold text-orange-950">{t.low_stock_alerts}</h3>
              </div>
              <div className="space-y-2">
                {data?.lowStockAlerts.slice(0, 2).map((item: any) => (
                  <div key={item.name} className="flex justify-between items-center text-xs">
                    <span className="font-medium text-orange-800">{item.name}</span>
                    <span className="font-bold text-orange-600">{item.current} {item.unit}</span>
                  </div>
                ))}
                <Button
                  variant="link"
                  className="px-0 h-auto text-[11px] text-orange-700 font-bold hover:text-orange-900"
                  onClick={() => router.push('/inventory')}
                >
                  {t.manage_inventory || "Manage Inventory"} →
                </Button>
              </div>
            </Card>
          )}
        </div>
      </div>

      <ShiftDialog open={isShiftDialogOpen} onOpenChange={setIsShiftDialogOpen} />

      <Dialog open={isEndShiftOpen} onOpenChange={setIsEndShiftOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.end_current_shift}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="p-4 bg-muted rounded-lg space-y-2">
              <div className="flex justify-between text-sm">
                <span>{t.starting_cash_with_colon || "Starting Cash:"}</span>
                <span>{formatLAK(startCash || 0)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>{t.cash_sales_with_colon || "Cash Sales:"}</span>
                <span>{formatLAK(cashPayments || 0)}</span>
              </div>
              <div className="flex justify-between font-bold border-t pt-2">
                <span>{t.expected_cash_with_colon || "Expected Cash:"}</span>
                <span className="text-amber-600">
                  {formatLAK((startCash || 0) + (cashPayments || 0))}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <ShiftLabel htmlFor="actualCash">{t.actual_cash_counted || "Actual Cash Counted"}</ShiftLabel>
              <ShiftInput
                id="actualCash"
                type="number"
                placeholder={t.enter_cash_drawer || "Enter cash amount"}
                value={actualCash}
                onChange={e => setActualCash(e.target.value)}
                className="text-lg font-bold"
              />
            </div>

            {actualCash && (
              <div className={cn(
                "p-3 rounded-md text-sm font-medium",
                parseFloat(actualCash) - ((startCash || 0) + (cashPayments || 0)) >= 0
                  ? 'bg-green-50 text-green-700'
                  : 'bg-red-50 text-red-700'
              )}>
                {t.difference_label || "Difference"}: {formatLAK(parseFloat(actualCash) - ((startCash || 0) + (cashPayments || 0)))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEndShiftOpen(false)}>{t.cancel}</Button>
            <Button
              variant="destructive"
              className="font-bold"
              disabled={!actualCash || isProcessing}
              onClick={handleEndShift}
            >
              {isProcessing ? t.ending_shift_status || "Ending..." : t.confirm_close_shift || "Confirm & Close Shift"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
