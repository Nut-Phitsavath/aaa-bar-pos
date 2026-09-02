"use client"

import { usePathname, useRouter } from "next/navigation"
import Link from "next/link"
import { useEffect, useState } from "react"
import {
    LayoutDashboard,
    LayoutGrid,
    ShoppingCart,
    Receipt,
    List,
    Package,
    Users,
    Tag,
    ChartLine,
    Settings,
    LogOut,
    Store,
    Wallet,
    ChevronLeft,
    ChevronRight,
    Menu,
    ShieldCheck,
    UserCircle
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { useTranslation } from "@/hooks/use-translation"
import { notify } from "@/components/ui/sonner"
import { useShift } from "@/components/shift-provider"
import { ShiftDialog } from "@/components/shift-dialog"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatLAK } from "@/lib/currency"
import { cn } from "@/lib/utils"
import { useSidebar } from "@/components/sidebar-provider"

export function Sidebar() {
    const pathname = usePathname()
    const router = useRouter()
    const { t } = useTranslation()
    const {
        status, startCash, cashPayments,
        onePayPayments, onePayCount, transferPayments, transferCount,
        activeShiftId, checkShiftStatus
    } = useShift()
    const { isCollapsed, toggleSidebar } = useSidebar()
    const [user, setUser] = useState<any>(null)
    const [isShiftDialogOpen, setIsShiftDialogOpen] = useState(false)
    const [isEndShiftOpen, setIsEndShiftOpen] = useState(false)
    const [actualCash, setActualCash] = useState("")
    const [isProcessingShift, setIsProcessingShift] = useState(false)

    useEffect(() => {
        fetch('/api/auth/me')
            .then(res => res.json())
            .then(data => setUser(data.user))
            .catch(() => { })
    }, [])

    const handleLogout = async () => {
        await fetch('/api/auth/logout', { method: 'POST' })
        router.push('/pin-login')
    }

    const currentCash = (startCash || 0) + (cashPayments || 0)

    const handleEndShift = async () => {
        if (!actualCash) return
        setIsProcessingShift(true)
        try {
            const res = await fetch(`/api/shifts`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: activeShiftId,
                    actualCash: Number(actualCash)
                })
            })
            if (res.ok) {
                await checkShiftStatus()
                setIsEndShiftOpen(false)
                setActualCash("")
                router.push('/dashboard')
            } else {
                const err = await res.json()
                notify.error(err.error || t.close_shift_failed)
            }
        } catch (e) {
            console.error(e)
            notify.error(t.close_shift_error)
        } finally {
            setIsProcessingShift(false)
        }
    }

    // Navigation Items
    const mainNavItems = [
        { name: t.dashboard, href: "/dashboard", icon: LayoutDashboard },
        { name: t.tables, href: "/tables", icon: LayoutGrid },
        { name: t.pos, href: "/pos", icon: ShoppingCart },
        { name: t.orders, href: "/orders", icon: Receipt },
        { name: t.menu, href: "/menu", icon: List },
        { name: t.inventory, href: "/inventory", icon: Package },
        { name: t.user_management, href: "/users", icon: Users },
        { name: t.promotions, href: "/promotions", icon: Tag },
        { name: t.reports, href: "/reports", icon: ChartLine, managerAllowed: true },
    ]

    const systemActions = [
        { name: t.settings, href: "/settings", icon: Settings, managerAllowed: true },
    ]

    // Filter items based on user role
    const isSpecialRole = user?.role === 'ADMIN' || user?.role === 'MANAGER'
    const isStaff = user?.role === 'STAFF'

    const filteredNavItems = mainNavItems.filter(item => {
        // Staff restrictions
        if (isStaff) {
            const staffAllowed = ['/pos', '/orders', '/users', '/inventory']
            return staffAllowed.includes(item.href)
        }

        if ((item as any).adminOnly) return user?.role === 'ADMIN'
        if ((item as any).managerAllowed) return isSpecialRole
        return true
    })

    const filteredSystemItems = systemActions.filter(item => {
        if (isStaff) return false // Hide settings for staff
        if ((item as any).adminOnly) return user?.role === 'ADMIN'
        if ((item as any).managerAllowed) return isSpecialRole
        return true
    })

    // Sidebar is hidden on certain pages
    const excludedPaths = ['/login', '/role-select', '/pin-login', '/receipt', '/customer-view', '/kitchen']
    if (excludedPaths.some(path => pathname.startsWith(path))) {
        return null
    }

    return (
        <>
            <aside
                className={cn(
                    "h-screen bg-white border-r flex flex-col fixed left-0 top-0 z-50 shadow-sm border-amber-100 transition-all duration-300",
                    isCollapsed ? "w-[80px]" : "w-[260px]"
                )}
            >
                {/* Logo Section */}
                <div
                    className={cn(
                        "h-[72px] flex items-center border-b border-amber-50 cursor-pointer hover:bg-amber-50/50 transition-colors px-4",
                        isCollapsed ? "justify-center" : "justify-between"
                    )}
                    onClick={() => !isCollapsed && router.push('/dashboard')}
                >
                    <div className="flex items-center gap-2 overflow-hidden">
                        <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center border border-amber-100 shadow-sm shrink-0 overflow-hidden">
                            <img src="/solution_logo.png" alt="Canisoftware" className="w-full h-full object-contain" />
                        </div>
                        {!isCollapsed && (
                            <div className="flex flex-col leading-none">
                                <div className="text-lg font-black tracking-tight whitespace-nowrap">
                                    <span className="text-amber-600">CANI</span>
                                    <span className="text-slate-900">SOFTWARE</span>
                                </div>
                                <span className="text-[10px] font-bold text-amber-600/60 uppercase tracking-widest mt-0.5">POS SOLUTION</span>
                            </div>
                        )}
                    </div>

                    {!isCollapsed && (
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => { e.stopPropagation(); toggleSidebar(); }}
                            className="h-11 w-11 text-amber-800 hover:bg-amber-100"
                        >
                            <ChevronLeft className="w-5 h-5" />
                        </Button>
                    )}
                </div>

                {/* Mini Toggle for collapsed mode */}
                {isCollapsed && (
                    <div className="flex justify-center py-2 border-b border-amber-50">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={toggleSidebar}
                            className="h-10 w-10 text-amber-800 hover:bg-amber-100"
                        >
                            <Menu className="w-6 h-6" />
                        </Button>
                    </div>
                )}

                {/* Cash in Drawer Section */}
                {!isCollapsed && (
                    <div className="p-3 bg-amber-50/30 border-b border-amber-100">
                        <div className="flex flex-col">
                            <span className="text-[10px] font-bold text-amber-700/70 uppercase tracking-widest leading-none mb-1">{t.cash_in_drawer || "Cash in Drawer"}</span>
                            <div className="flex items-center gap-1.5">
                                <Wallet className="w-3.5 h-3.5 text-amber-600" />
                                <span className="text-[18px] font-black text-amber-950 leading-none">
                                    {formatLAK(currentCash)}
                                </span>
                            </div>
                            {status === 'CLOSED' && (
                                <button
                                    onClick={() => setIsShiftDialogOpen(true)}
                                    className="text-[10px] hover:underline text-rose-500 font-bold mt-1 leading-none text-left focus:outline-none flex items-center gap-1"
                                >
                                    <div className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                                    {t.shift_closed || "Shift Closed"} ({t.open_status || "Open"})
                                </button>
                            )}
                            {status === 'OPEN' && (
                                <button
                                    onClick={() => setIsEndShiftOpen(true)}
                                    className="text-[11px] hover:underline text-emerald-600 font-bold text-left focus:outline-none flex items-center gap-1.5 min-h-11 -my-1 py-2"
                                >
                                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                    {t.shift_open || "Shift Open"} ({t.end_shift || "End"})
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* Main Navigation */}
                <nav className={cn(
                    "flex-1 py-2 space-y-1.45 overflow-y-auto no-scrollbar px-3",
                    isCollapsed && "px-2"
                )}>
                    {filteredNavItems.map((item) => {
                        const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))
                        const Icon = item.icon

                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                title={isCollapsed ? item.name : ""}
                                className={cn(
                                    "flex items-center gap-4 rounded-xl transition-all duration-200 group relative overflow-hidden",
                                    isCollapsed ? "justify-center h-12" : "px-4 h-15",
                                    isActive
                                        ? "bg-amber-800 text-white shadow-md shadow-amber-900/10"
                                        : "text-slate-600 hover:bg-amber-50 hover:text-amber-900"
                                )}
                            >
                                {/* Active state left bar */}
                                {isActive && (
                                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-8 bg-amber-400 rounded-r-full" />
                                )}

                                <Icon className={cn(
                                    "w-7 h-7 transition-colors shrink-0",
                                    isActive ? "text-amber-200" : "text-slate-400 group-hover:text-amber-700"
                                )} />

                                {!isCollapsed && (
                                    <span className={cn(
                                        "text-[16px] font-medium transition-all whitespace-nowrap",
                                        isActive ? "font-bold tracking-wide" : "font-semibold"
                                    )}>
                                        {item.name}
                                    </span>
                                )}

                                {/* Tap feedback overlay */}
                                <div className="absolute inset-0 bg-black/0 active:bg-black/5 transition-colors" />
                            </Link>
                        )
                    })}
                </nav>

                <Separator className="bg-amber-100" />

                {/* System Actions Section */}
                <div className={cn("p-2 space-y-0.5", isCollapsed && "px-2")}>
                    {/* User Info Snippet */}
                    {user && !isCollapsed && (
                        <div className="px-4 py-2.5 mb-2 bg-slate-50 rounded-xl border border-slate-100 flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-amber-900 border border-amber-100 shadow-sm shrink-0">
                                {user.role === 'ADMIN' || user.role === 'MANAGER' ? <ShieldCheck className="w-5 h-5" /> : <UserCircle className="w-5 h-5" />}
                            </div>
                            <div className="min-w-0">
                                <p className="text-sm font-bold text-slate-900 leading-none truncate">{user.name}</p>
                                <p className="text-[10px] font-bold text-slate-500 uppercase mt-1 tracking-wider leading-none">{user.role}</p>
                            </div>
                        </div>
                    )}

                    {filteredSystemItems.map((item) => {
                        const isActive = pathname === item.href
                        const Icon = item.icon
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                title={isCollapsed ? item.name : ""}
                                className={cn(
                                    "flex items-center gap-4 rounded-xl transition-all",
                                    isCollapsed ? "justify-center h-12" : "px-4 h-14",
                                    isActive
                                        ? "bg-slate-100 text-slate-900"
                                        : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                                )}
                            >
                                <Icon className="w-6 h-6 shrink-0" />
                                {!isCollapsed && <span className="text-[15px] font-semibold whitespace-nowrap">{item.name}</span>}
                            </Link>
                        )
                    })}

                    <button
                        onClick={handleLogout}
                        title={isCollapsed ? t.logout : ""}
                        className={cn(
                            "w-full flex items-center gap-4 rounded-xl text-rose-600 hover:bg-rose-50 transition-all font-semibold",
                            isCollapsed ? "justify-center h-12" : "px-4 h-14"
                        )}
                    >
                        <LogOut className="w-6 h-6 shrink-0" />
                        {!isCollapsed && <span className="text-[15px] whitespace-nowrap">{t.logout}</span>}
                    </button>
                </div>

                {/* Wood texture accent at the very bottom */}
                <div className="h-2 w-full bg-[#5D3A1A] shrink-0" />
            </aside>

            {/* Shift Management Dialogs */}
            <ShiftDialog open={isShiftDialogOpen} onOpenChange={setIsShiftDialogOpen} />

            <Dialog open={isEndShiftOpen} onOpenChange={setIsEndShiftOpen}>
                <DialogContent className="!top-[15%] !translate-y-0">
                    <DialogHeader>
                        <DialogTitle>{t.end_current_shift || "End Current Shift"}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="p-4 bg-slate-50 rounded-lg space-y-2 border border-slate-100 font-mono text-sm leading-relaxed">
                            <div className="flex justify-between text-sm">
                                <span>{t.starting_cash_with_colon || "Starting Cash:"}</span>
                                <span>{formatLAK(startCash || 0)}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span>{t.cash_sales_with_colon || "Cash Sales:"}</span>
                                <span>{formatLAK(cashPayments || 0)}</span>
                            </div>
                            <div className="flex justify-between font-bold border-t border-slate-200 pt-2 pb-1">
                                <span>{t.expected_cash_with_colon || "Expected Cash:"}</span>
                                <span className="text-amber-600">
                                    {formatLAK((startCash || 0) + (cashPayments || 0))}
                                </span>
                            </div>
                            <div className="flex justify-between text-sm border-t border-slate-100 pt-2 opacity-70">
                                <span>{t.onepay_total || "OnePay Total"}: ({onePayCount || 0})</span>
                                <span>{formatLAK(onePayPayments || 0)}</span>
                            </div>
                            <div className="flex justify-between text-sm opacity-70">
                                <span>{t.transfer_total || "Transfer Total"}: ({transferCount || 0})</span>
                                <span>{formatLAK(transferPayments || 0)}</span>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="actualCash">{t.actual_cash_counted || "Actual Cash Counted"}</Label>
                            <Input
                                id="actualCash"
                                type="text"
                                placeholder={t.enter_cash_drawer || "Enter cash amount"}
                                value={actualCash ? Number(actualCash).toLocaleString() : ""}
                                onChange={e => {
                                    const val = e.target.value.replace(/\D/g, "")
                                    setActualCash(val)
                                }}
                                className="text-lg font-bold"
                            />
                        </div>

                        {actualCash && (
                            <div className={cn(
                                "p-3 rounded-md text-sm font-medium",
                                Number(actualCash) - ((startCash || 0) + (cashPayments || 0)) >= 0
                                    ? 'bg-green-50 text-green-700'
                                    : 'bg-red-50 text-red-700'
                            )}>
                                {t.difference_label || "Difference"}: {formatLAK(Number(actualCash) - ((startCash || 0) + (cashPayments || 0)))}
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsEndShiftOpen(false)}>{t.cancel}</Button>
                        <Button
                            variant="destructive"
                            className="font-bold"
                            disabled={!actualCash || isProcessingShift}
                            onClick={handleEndShift}
                        >
                            {isProcessingShift ? t.ending_shift_status || "Ending..." : t.confirm_close_shift || "Confirm & Close Shift"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
