'use client'

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
    TrendingUp, TrendingDown, DollarSign, ShoppingBag,
    Calendar as CalendarIcon, Clock, Package, History, ArrowRightLeft,
    Store, Wallet, ShoppingCart, AlertTriangle, Target, Users, CreditCard, ChevronDown, Award
} from "lucide-react"
import { formatTHB } from "@/lib/currency"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { format, subDays, startOfDay, endOfDay, isSameDay } from "date-fns"
import { useTranslation } from "@/hooks/use-translation"
import { APP_NAME } from "@/lib/shop"
import { Badge } from "@/components/ui/badge"
import {
    Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip, Legend,
    Line, LineChart, Pie, PieChart, Cell, CartesianGrid
} from "recharts"
import { cn } from "@/lib/utils"

const COLORS = ['#92400e', '#d97706', '#f59e0b', '#fbbf24', '#fcd34d', '#78350f', '#451a03']
const PIE_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4']

export default function MonitorPage() {
    const { t } = useTranslation()
    const [data, setData] = useState<any>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({
        from: startOfDay(new Date()),
        to: endOfDay(new Date())
    })

    useEffect(() => {
        document.title = `Monitor | ${APP_NAME}`
        fetchData()
    }, [dateRange])

    const fetchData = async () => {
        setIsLoading(true)
        try {
            const start = dateRange.from.toISOString()
            const end = dateRange.to.toISOString()
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

    const setRange = (days: number | 'today') => {
        if (days === 'today') {
            setDateRange({ from: startOfDay(new Date()), to: endOfDay(new Date()) })
        } else {
            setDateRange({ from: startOfDay(subDays(new Date(), days)), to: endOfDay(new Date()) })
        }
    }

    const summary = data?.summary || {}
    const peakHour = data?.hourlySales?.reduce((prev: any, current: any) =>
        (prev.revenue > current.revenue) ? prev : current, { hour: '--', revenue: 0 }
    )

    const numFormat = new Intl.NumberFormat()

    return (
        <div className="min-h-screen bg-slate-50 pb-32 font-sans no-sidebar-monitor">
            {/* Premium Multi-Mode Header */}
            <header className="sticky top-0 z-30 bg-amber-900 text-white shadow-xl">
                <div className="p-4 flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="w-9 h-9 bg-amber-800 rounded-lg flex items-center justify-center border border-amber-700/50">
                                <Store className="w-5 h-5 text-amber-200" />
                            </div>
                            <h1 className="text-lg font-black tracking-tighter uppercase">{t.cafe_monitor}</h1>
                        </div>

                        <Popover>
                            <PopoverTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-9 px-3 bg-white/10 border-white/10 text-amber-100 font-bold text-[11px] uppercase tracking-wider rounded-xl hover:bg-white/20">
                                    <CalendarIcon className="w-3.5 h-3.5 mr-2" />
                                    {format(dateRange.from, "MMM dd")} - {format(dateRange.to, "MMM dd")}
                                    <ChevronDown className="w-3 h-3 ml-2 opacity-50" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0 border-none bg-white shadow-2xl rounded-2xl" align="end">
                                <Calendar
                                    initialFocus
                                    mode="range"
                                    selected={{ from: dateRange.from, to: dateRange.to }}
                                    onSelect={(range: any) => {
                                        if (range?.from && range?.to) {
                                            setDateRange({ from: startOfDay(range.from), to: endOfDay(range.to) })
                                        } else if (range?.from) {
                                            setDateRange({ from: startOfDay(range.from), to: endOfDay(range.from) })
                                        }
                                    }}
                                    numberOfMonths={1}
                                    className="p-3"
                                />
                            </PopoverContent>
                        </Popover>
                    </div>

                    <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                        {[
                            { label: 'Today', val: 'today' as const },
                            { label: '7D', val: 7 },
                            { label: '30D', val: 30 },
                            { label: '90D', val: 90 }
                        ].map((r) => (
                            <Button
                                key={r.label}
                                variant="ghost"
                                size="sm"
                                className={cn(
                                    "text-[10px] h-7 px-4 rounded-full font-black uppercase tracking-widest transition-all",
                                    ((r.val === 'today' && isSameDay(dateRange.from, startOfDay(new Date()))) || (typeof r.val === 'number' && isSameDay(dateRange.from, startOfDay(subDays(new Date(), r.val)))))
                                        ? "bg-white text-amber-900 shadow-lg"
                                        : "text-amber-400 hover:text-white"
                                )}
                                onClick={() => setRange(r.val)}
                            >
                                {r.label}
                            </Button>
                        ))}
                    </div>
                </div>
            </header>

            <main className="p-4 space-y-6 max-w-md mx-auto">
                {isLoading && !data ? (
                    <div className="flex flex-col items-center justify-center py-24">
                        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-amber-900 mb-4 opacity-20"></div>
                        <p className="text-[10px] font-black text-amber-900/40 uppercase tracking-[0.2em]">{t.synchronizing}</p>
                    </div>
                ) : (
                    <>
                        {/* 1. Core Revenue & Orders Trend */}
                        <Card className="border-none shadow-sm bg-white overflow-hidden">
                            <CardHeader className="p-5 pb-0 flex flex-row items-center justify-between">
                                <div>
                                    <CardTitle className="text-xs font-black uppercase tracking-widest text-slate-400">{t.growth_trend}</CardTitle>
                                    <CardDescription className="text-lg font-black text-slate-800 mt-1">{formatTHB(summary.totalRevenue || 0)}</CardDescription>
                                </div>
                                <TrendingUp className="w-5 h-5 text-emerald-500" />
                            </CardHeader>
                            <CardContent className="p-2 h-[220px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={data?.dailyTrend} margin={{ top: 10, right: 10, bottom: 20, left: -20 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                        <XAxis
                                            dataKey="date"
                                            tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 'bold' }}
                                            tickLine={false}
                                            axisLine={false}
                                            tickFormatter={(val) => val.split('-').slice(1).join('/')}
                                        />
                                        <YAxis
                                            yAxisId="left"
                                            tick={{ fill: '#cbd5e1', fontSize: 9 }}
                                            tickLine={false}
                                            axisLine={false}
                                            tickFormatter={(val) => val > 0 ? `${(val / 1000).toFixed(0)}k` : ''}
                                        />
                                        <Tooltip
                                            formatter={(value: number, name: string) => [numFormat.format(value) + ' LAK', name === 'revenue' ? 'Revenue' : 'Orders']}
                                            contentStyle={{ backgroundColor: '#451a03', border: 'none', borderRadius: '12px' }}
                                            itemStyle={{ color: '#fbbf24', fontSize: '11px', fontWeight: 'black' }}
                                            labelStyle={{ color: '#fff', fontSize: '10px' }}
                                        />
                                        <Line yAxisId="left" type="monotone" dataKey="revenue" stroke="#d97706" strokeWidth={4} dot={{ r: 2, fill: '#d97706' }} activeDot={{ r: 6 }} />
                                        <Line yAxisId="left" type="monotone" dataKey="orders" stroke="#2563eb" strokeWidth={2} strokeDasharray="4 4" dot={false} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>

                        {/* 2. Category Share & Payment Distribution */}
                        <div className="grid grid-cols-1 gap-4">
                            <Card className="border-none shadow-sm bg-white overflow-hidden">
                                <CardHeader className="p-4 pb-0">
                                    <CardTitle className="text-xs font-black uppercase tracking-widest text-slate-400">{t.category_mix}</CardTitle>
                                </CardHeader>
                                <CardContent className="p-4">
                                    <div className="flex items-center gap-4">
                                        <div className="w-32 h-32 relative shrink-0">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <PieChart>
                                                    <Pie data={data?.categoryShare} dataKey="revenue" nameKey="category" innerRadius="60%" outerRadius="90%" paddingAngle={2}>
                                                        {data?.categoryShare?.map((_: any, index: number) => (
                                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                                        ))}
                                                    </Pie>
                                                    <Tooltip formatter={(value: number) => numFormat.format(value) + ' LAK'} />
                                                </PieChart>
                                            </ResponsiveContainer>
                                        </div>
                                        <div className="flex-1 space-y-1.5 max-h-32 overflow-y-auto no-scrollbar">
                                            {data?.categoryShare?.slice(0, 6).map((c: any, i: number) => (
                                                <div key={i} className="flex items-center justify-between text-[10px] font-bold">
                                                    <div className="flex items-center gap-1.5 truncate">
                                                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                                                        <span className="truncate uppercase text-slate-600">{c.category}</span>
                                                    </div>
                                                    <span className="text-slate-400">{((c.revenue / summary.totalRevenue) * 100).toFixed(0)}%</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>

                            <Card className="border-none shadow-sm bg-white overflow-hidden">
                                <CardHeader className="p-4 pb-0">
                                    <CardTitle className="text-xs font-black uppercase tracking-widest text-slate-400">{t.payment_distribution}</CardTitle>
                                </CardHeader>
                                <CardContent className="p-4">
                                    <div className="flex items-center gap-4">
                                        <div className="w-32 h-32 relative shrink-0">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <PieChart>
                                                    <Pie data={data?.paymentMethods} dataKey="revenue" nameKey="paymentMethod" innerRadius="60%" outerRadius="90%" paddingAngle={2}>
                                                        {data?.paymentMethods?.map((_: any, index: number) => (
                                                            <Cell key={`cell-pm-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                                                        ))}
                                                    </Pie>
                                                    <Tooltip formatter={(value: number) => numFormat.format(value) + ' LAK'} />
                                                </PieChart>
                                            </ResponsiveContainer>
                                        </div>
                                        <div className="flex-1 space-y-1.5 max-h-32 overflow-y-auto no-scrollbar">
                                            {data?.paymentMethods?.map((pm: any, i: number) => (
                                                <div key={i} className="flex items-center justify-between text-[10px] font-bold">
                                                    <div className="flex items-center gap-1.5 truncate">
                                                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                                                        <span className="truncate uppercase text-slate-600">{pm.paymentMethod}</span>
                                                    </div>
                                                    <span className="text-slate-400">{((pm.revenue / summary.totalRevenue) * 100).toFixed(0)}%</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>

                        {/* 3. Complimentary Orders (Restored) */}
                        <Card className="border-none shadow-sm bg-rose-50 border-l-4 border-l-rose-500 overflow-hidden">
                            <CardHeader className="p-4 pb-0 flex flex-row items-center justify-between">
                                <CardTitle className="text-[10px] font-black uppercase tracking-[0.1em] text-rose-800/60">{t.complimentary_orders}</CardTitle>
                                <Badge className="bg-rose-500/10 text-rose-600 border border-rose-500/20 text-[10px] font-black">{summary.complimentaryOrders || 0} {t.orders_lower}</Badge>
                            </CardHeader>
                            <CardContent className="p-4 pt-2">
                                <p className="text-lg font-black text-rose-950 mb-3">{formatTHB(summary.complimentaryValue || 0)} <span className="text-[10px] font-bold text-rose-400/80 uppercase ml-1 tracking-tighter">{t.market_value}</span></p>
                                <div className="flex gap-2 overflow-x-auto no-scrollbar">
                                    {data?.complimentaryDetails?.map((c: any, i: number) => (
                                        <Badge key={i} variant="outline" className="bg-white/50 border-rose-200 text-rose-700 text-[10px] whitespace-nowrap px-3 py-1 font-bold">
                                            {c.customerName}: {c.orderCount}
                                        </Badge>
                                    ))}
                                    {(!data?.complimentaryDetails || data.complimentaryDetails.length === 0) && <p className="text-[10px] text-rose-400 italic">{t.no_complimentary_recorded}</p>}
                                </div>
                            </CardContent>
                        </Card>

                        {/* 4. Variations & Choices (Restored) */}
                        <div className="grid grid-cols-2 gap-4">
                            <Card className="border-none shadow-sm bg-white p-4">
                                <p className="text-[9px] font-black uppercase text-slate-400 tracking-widest mb-3">{t.variation_performance}</p>
                                <div className="space-y-3">
                                    {data?.variationStats?.slice(0, 4).map((v: any, i: number) => (
                                        <div key={i}>
                                            <div className="flex justify-between text-[10px] font-bold uppercase mb-1">
                                                <span className="text-slate-700 truncate mr-2">{v.name}</span>
                                                <span className="text-amber-700">{v.sold}</span>
                                            </div>
                                            <div className="w-full bg-slate-100 h-1 rounded-full overflow-hidden">
                                                <div className="bg-amber-500 h-full" style={{ width: `${(v.sold / (data.variationStats[0]?.sold || 1)) * 100}%` }} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </Card>

                            <Card className="border-none shadow-sm bg-white p-4">
                                <p className="text-[9px] font-black uppercase text-slate-400 tracking-widest mb-3">{t.choice_performance}</p>
                                <div className="space-y-3">
                                    {data?.sizeStats?.slice(0, 4).map((s: any, i: number) => (
                                        <div key={i}>
                                            <div className="flex justify-between text-[10px] font-bold uppercase mb-1">
                                                <span className="text-slate-700 truncate mr-2">{s.name}</span>
                                                <span className="text-blue-700">{s.sold}</span>
                                            </div>
                                            <div className="w-full bg-slate-100 h-1 rounded-full overflow-hidden">
                                                <div className="bg-blue-500 h-full" style={{ width: `${(s.sold / (data.sizeStats[0]?.sold || 1)) * 100}%` }} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </Card>
                        </div>

                        {/* 5. 24H Activity Window */}
                        <Card className="border-none shadow-sm bg-white overflow-hidden">
                            <CardHeader className="p-5 pb-1">
                                <CardTitle className="text-xs font-black uppercase tracking-widest text-slate-800">24H Revenue Intensity</CardTitle>
                            </CardHeader>
                            <CardContent className="p-2 h-[180px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={data?.hourlySales} margin={{ top: 10, right: 10, bottom: 20, left: -15 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                        <XAxis dataKey="hour" tick={{ fontSize: 9 }} tickFormatter={(h) => `${h}h`} />
                                        <YAxis tick={{ fontSize: 8 }} tickFormatter={(v) => v > 0 ? `${(v / 1000).toFixed(0)}k` : ''} />
                                        <Tooltip formatter={(value: number) => numFormat.format(value) + ' LAK'} />
                                        <Bar dataKey="revenue" radius={[2, 2, 0, 0]} fill="#fbbf24" barSize={8}>
                                            {data?.hourlySales?.map((entry: any, index: number) => (
                                                <Cell key={`cell-${index}`} fill={entry.hour === peakHour?.hour ? '#92400e' : '#fbbf24'} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>

                        {/* 6. Top Loyalty Customers (New) */}
                        <Card className="border-none shadow-sm bg-white overflow-hidden">
                            <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between border-b border-slate-50">
                                <CardTitle className="text-[10px] font-black uppercase tracking-widest text-emerald-600">{t.top_loyalty_members}</CardTitle>
                                <Award className="w-3.5 h-3.5 text-emerald-500" />
                            </CardHeader>
                            <CardContent className="p-0">
                                {data?.customerStats?.topLoyalty?.slice(0, 5).map((c: any, i: number) => (
                                    <div key={i} className="flex items-center justify-between p-3 border-b border-slate-50 last:border-0">
                                        <div className="flex items-center gap-3">
                                            <div className="w-7 h-7 bg-emerald-50 rounded-full flex items-center justify-center text-[10px] font-black text-emerald-600 border border-emerald-100 uppercase">{c.name.slice(0, 1)}</div>
                                            <div>
                                                <p className="text-xs font-black text-slate-800 uppercase leading-none">{c.name}</p>
                                                <p className="text-[9px] font-bold text-slate-400 mt-1 uppercase">{c.visitCount} {t.visits}</p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-xs font-black text-emerald-700 leading-none">{c.loyaltyPoints} {t.pts}</p>
                                            <p className="text-[9px] font-bold text-slate-400 mt-1">{formatTHB(c.totalSpent)}</p>
                                        </div>
                                    </div>
                                ))}
                                {(!data?.customerStats?.topLoyalty || data.customerStats.topLoyalty.length === 0) && <p className="p-4 text-xs text-center text-slate-400 italic">{t.no_member_data}</p>}
                            </CardContent>
                        </Card>

                        {/* 7. Recent Inventory Transactions (New) */}
                        <Card className="border-none shadow-sm bg-white overflow-hidden">
                            <CardHeader className="p-4 pb-2 border-b border-slate-50">
                                <div className="flex items-center justify-between">
                                    <CardTitle className="text-[10px] font-black uppercase tracking-widest text-blue-600">{t.inventory_feed}</CardTitle>
                                    <History className="w-3.5 h-3.5 text-blue-500" />
                                </div>
                            </CardHeader>
                            <CardContent className="p-0">
                                <div className="max-h-[300px] overflow-y-auto no-scrollbar">
                                    {data?.inventoryStats?.recentTransactions?.map((tx: any, i: number) => (
                                        <div key={i} className="p-3 border-b border-slate-50 last:border-0 flex items-start gap-3">
                                            <div className={cn(
                                                "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                                                tx.type === 'TRANSFER' ? "bg-blue-50 text-blue-600" :
                                                    tx.type === 'USAGE' ? "bg-purple-50 text-purple-600" :
                                                        "bg-emerald-50 text-emerald-600"
                                            )}>
                                                {tx.type === 'TRANSFER' ? <ArrowRightLeft className="w-4 h-4" /> :
                                                    tx.type === 'USAGE' ? <ShoppingBag className="w-4 h-4" /> :
                                                        <Download className="w-4 h-4" />}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex justify-between items-start mb-0.5">
                                                    <p className="text-xs font-black text-slate-800 uppercase truncate">{tx.ingredientName}</p>
                                                    <p className="text-[10px] font-black text-slate-900 whitespace-nowrap ml-2">{tx.quantity} {tx.unit}</p>
                                                </div>
                                                <div className="flex justify-between items-center">
                                                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">
                                                        {tx.type} • {format(new Date(tx.createdAt), "HH:mm")} • BY {tx.user || "STAFF"}
                                                    </p>
                                                    <Badge variant="secondary" className="text-[8px] h-4 font-bold bg-slate-100 text-slate-500 px-1.5 uppercase tracking-widest">
                                                        {tx.toStore || "STOCK"}
                                                    </Badge>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    </>
                )}
            </main>

            {/* Bottom Sync Navigation */}
            <nav className="fixed bottom-0 left-0 right-0 p-4 z-40 bg-white/90 backdrop-blur-xl border-t border-slate-100 shadow-[0_-10px_30px_-15px_rgba(0,0,0,0.1)]">
                <div className="max-w-md mx-auto flex gap-4">
                    <Button className="flex-1 bg-amber-900 text-white rounded-2xl h-14 font-black uppercase text-[11px] tracking-widest shadow-xl shadow-amber-900/40 active:scale-95 transition-all border-none" onClick={() => {
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                        fetchData();
                    }}>
                        <TrendingUp className="w-5 h-5 mr-3" />
                        Live Sync Stats
                    </Button>

                    <Popover>
                        <PopoverTrigger asChild>
                            <Button variant="outline" className="w-14 h-14 rounded-2xl border-slate-200 text-slate-800 bg-slate-50 flex flex-col items-center justify-center p-0">
                                <CalendarIcon className="w-6 h-6" />
                                <span className="text-[8px] font-black uppercase mt-1">{t.date_label}</span>
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0 border-none shadow-2xl rounded-2xl mb-4" side="top" align="end">
                            <Calendar mode="range" selected={{ from: dateRange.from, to: dateRange.to }} onSelect={(range: any) => {
                                if (range?.from && range?.to) { setDateRange({ from: startOfDay(range.from), to: endOfDay(range.to) }) }
                                else if (range?.from) { setDateRange({ from: startOfDay(range.from), to: endOfDay(range.from) }) }
                            }} className="p-3" />
                        </PopoverContent>
                    </Popover>
                </div>
            </nav>
        </div>
    )
}

function Download(props: any) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" x2="12" y1="15" y2="3" />
        </svg>
    )
}
