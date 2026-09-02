"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { LayoutDashboard, ShoppingCart, List, Package, Tag, Settings, Wallet, Store, Users, Receipt, DollarSign } from "lucide-react"
import Link from "next/link"
import { useTranslation } from "@/hooks/use-translation"
import { formatLAK } from "@/lib/currency"

import { ShiftDialog } from "@/components/shift-dialog"
import { useShift } from "@/components/shift-provider"

export function Header({ title, children }: { title?: string, children?: React.ReactNode }) {
    const { t } = useTranslation()
    const [user, setUser] = useState<any>(null)
    const { status, activeShiftId, startCash, cashPayments } = useShift()
    const [isShiftDialogOpen, setIsShiftDialogOpen] = useState(false)

    useEffect(() => {
        fetch('/api/auth/me')
            .then(res => res.json())
            .then(data => setUser(data.user))
            .catch(() => { })
    }, [])

    const handleLogout = async () => {
        await fetch('/api/auth/logout', { method: 'POST' })
        window.location.href = '/role-select'
    }

    const currentCash = (startCash || 0) + (cashPayments || 0)

    return (
        <header className="border-b bg-white sticky top-0 z-10">
            <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4">
                    <h1 className="text-2xl font-bold text-amber-900 hover:text-amber-700">
                        {title || t.dashboard}
                    </h1>
                    <div className="flex items-center gap-2">
                        {children}
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    {/* Page specific action buttons or badges can go here */}
                </div>
            </div>
        </header>
    )
}
