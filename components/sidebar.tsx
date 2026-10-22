"use client"

import { usePathname, useRouter } from "next/navigation"
import Link from "next/link"
import { useEffect, useState } from "react"
import {
    LayoutDashboard,
    ShoppingCart,
    Receipt,
    List,
    Package,
    Users,
    Tag,
    ChartLine,
    Clock3,
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
import { useShift } from "@/components/shift-provider"
import { ShiftDialog } from "@/components/shift-dialog"
import { CloseShiftDialog } from "@/components/close-shift-dialog"
import { useBrand, BrandMark, BrandName, PoweredBy } from "@/components/brand"
import { formatTHB } from "@/lib/currency"
import { cn } from "@/lib/utils"
import { useSidebar } from "@/components/sidebar-provider"

/**
 * A table, for the floor plan.
 *
 * lucide-react has no furniture table - its "Table" is a spreadsheet grid - and
 * the grid Tables used before was the same shape as Dashboard's, so the two
 * links sat one above the other looking alike. Four legs and a stretcher: a
 * pedestal read as the letter T at 24px, and a table seen from above read as a
 * cog. Drawn on lucide's own grid (24px, 2px round strokes) to sit with the
 * icons around it.
 */
function TableIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
            aria-hidden="true" {...props}
        >
            <rect x="2" y="6" width="20" height="3" rx="1" />
            <path d="M5 9v11" />
            <path d="M19 9v11" />
            <path d="M5 14h14" />
        </svg>
    )
}

export function Sidebar() {
    const pathname = usePathname()
    const router = useRouter()
    const { t } = useTranslation()
    const { status, startCash, cashPayments } = useShift()
    const { isCollapsed, toggleSidebar } = useSidebar()
    const brand = useBrand()
    const [user, setUser] = useState<any>(null)
    const [isShiftDialogOpen, setIsShiftDialogOpen] = useState(false)
    const [isEndShiftOpen, setIsEndShiftOpen] = useState(false)

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

    // Navigation Items
    const mainNavItems = [
        { name: t.dashboard, href: "/dashboard", icon: LayoutDashboard },
        { name: t.tables, href: "/tables", icon: TableIcon },
        { name: t.pos, href: "/pos", icon: ShoppingCart },
        { name: t.bill_history, href: "/orders", icon: Receipt },
        { name: t.menu, href: "/menu", icon: List },
        { name: t.inventory, href: "/inventory", icon: Package },
        { name: t.user_management, href: "/users", icon: Users },
        { name: t.promotions, href: "/promotions", icon: Tag },
        { name: t.tabs, href: "/tabs", icon: Clock3 },
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
    const excludedPaths = ['/role-select', '/pin-login', '/receipt', '/customer-view', '/kitchen']
    if (excludedPaths.some(path => pathname.startsWith(path))) {
        return null
    }

    return (
        <>
            <aside
                className={cn(
                    "h-screen bg-stone-950 text-stone-200 border-r border-stone-800 flex flex-col fixed left-0 top-0 z-50 shadow-sm transition-all duration-300",
                    isCollapsed ? "w-[80px]" : "w-[260px]"
                )}
            >
                {/* Logo Section */}
                <div
                    className={cn(
                        "h-[72px] flex items-center border-b border-stone-800 cursor-pointer hover:bg-stone-900 transition-colors px-4",
                        isCollapsed ? "justify-center" : "justify-between"
                    )}
                    onClick={() => !isCollapsed && router.push('/dashboard')}
                >
                    <div className="flex items-center gap-2 overflow-hidden">
                        {/* The shop's own name and logo once set in Settings;
                            CaniSoftware's until then (lib/brand.ts). */}
                        <BrandMark brand={brand} className="w-10 h-10 text-[12px]" />
                        {!isCollapsed && <BrandName brand={brand} />}
                    </div>

                    {!isCollapsed && (
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => { e.stopPropagation(); toggleSidebar(); }}
                            className="h-11 w-11 text-stone-400 hover:bg-stone-800 hover:text-amber-400"
                        >
                            <ChevronLeft className="w-5 h-5" />
                        </Button>
                    )}
                </div>

                {/* Mini Toggle for collapsed mode */}
                {isCollapsed && (
                    <div className="flex justify-center py-2 border-b border-stone-800">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={toggleSidebar}
                            className="h-10 w-10 text-stone-400 hover:bg-stone-800 hover:text-amber-400"
                        >
                            <Menu className="w-6 h-6" />
                        </Button>
                    </div>
                )}

                {/* Cash in Drawer Section */}
                {!isCollapsed && (
                    <div className="p-3 border-b border-stone-800">
                        <div className="flex flex-col">
                            <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest leading-none mb-1">{t.cash_in_drawer || "Cash in Drawer"}</span>
                            <div className="flex items-center gap-1.5">
                                <Wallet className="w-3.5 h-3.5 text-amber-400" />
                                <span className="text-[18px] font-black text-amber-300 leading-none">
                                    {formatTHB(currentCash)}
                                </span>
                            </div>
                            {status === 'CLOSED' && (
                                <button
                                    onClick={() => setIsShiftDialogOpen(true)}
                                    className="text-[10px] hover:underline text-rose-400 font-bold mt-1 leading-none text-left focus:outline-none flex items-center gap-1"
                                >
                                    <div className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
                                    {t.shift_closed || "Shift Closed"} ({t.open_status || "Open"})
                                </button>
                            )}
                            {status === 'OPEN' && (
                                <button
                                    onClick={() => setIsEndShiftOpen(true)}
                                    className="text-[11px] hover:underline text-emerald-400 font-bold text-left focus:outline-none flex items-center gap-1.5 min-h-11 -my-1 py-2"
                                >
                                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                    {t.shift_open || "Shift Open"} ({t.end_shift || "End"})
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* Main Navigation */}
                <nav className={cn(
                    "flex-1 py-2 space-y-1.45 overflow-y-auto no-scrollbar scroll-fade-y px-3",
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
                                        ? "bg-amber-500 text-stone-950 shadow-md shadow-black/30"
                                        : "text-stone-300 hover:bg-stone-900 hover:text-amber-300"
                                )}
                            >
                                {/* Active state left bar */}
                                {isActive && (
                                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-8 bg-amber-200 rounded-r-full" />
                                )}

                                <Icon className={cn(
                                    "w-7 h-7 transition-colors shrink-0",
                                    isActive ? "text-stone-950" : "text-stone-500 group-hover:text-amber-400"
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

                <Separator className="bg-stone-800" />

                {/* System Actions Section */}
                <div className={cn("p-2 space-y-0.5", isCollapsed && "px-2")}>
                    {/* User Info Snippet */}
                    {user && !isCollapsed && (
                        <div className="px-4 py-2.5 mb-2 bg-stone-900 rounded-xl border border-stone-800 flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-stone-800 flex items-center justify-center text-amber-400 border border-stone-700 shrink-0">
                                {user.role === 'ADMIN' || user.role === 'MANAGER' ? <ShieldCheck className="w-5 h-5" /> : <UserCircle className="w-5 h-5" />}
                            </div>
                            <div className="min-w-0">
                                <p className="text-sm font-bold text-stone-100 leading-none truncate">{user.name}</p>
                                <p className="text-[10px] font-bold text-stone-400 uppercase mt-1 tracking-wider leading-none">{user.role}</p>
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
                                        ? "bg-stone-800 text-stone-50"
                                        : "text-stone-400 hover:bg-stone-900 hover:text-stone-100"
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
                            "w-full flex items-center gap-4 rounded-xl text-rose-400 hover:bg-rose-500/10 transition-all font-semibold",
                            isCollapsed ? "justify-center h-12" : "px-4 h-14"
                        )}
                    >
                        <LogOut className="w-6 h-6 shrink-0" />
                        {!isCollapsed && <span className="text-[15px] whitespace-nowrap">{t.logout}</span>}
                    </button>
                </div>

                {/* Our signature, once the bar's own name is up top. */}
                {!isCollapsed && <PoweredBy brand={brand} className="pb-3 pt-1" />}
            </aside>

            {/* Shift Management Dialogs */}
            <ShiftDialog open={isShiftDialogOpen} onOpenChange={setIsShiftDialogOpen} />

            {/* Count the drawer, a manager signs, the Z prints. */}
            <CloseShiftDialog open={isEndShiftOpen} onOpenChange={setIsEndShiftOpen} />
        </>
    )
}
