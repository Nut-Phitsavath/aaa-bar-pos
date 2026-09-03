"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useTranslation } from "@/hooks/use-translation"
import { Header } from "@/components/header"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Clock3, Phone, CreditCard } from "lucide-react"
import { formatTHB } from "@/lib/currency"

type Tab = {
    customer: { id: string; name: string; phone: string | null }
    outstanding: number
    bills: { id: string; table: string; closedAt: string | null; total: number; balance: number }[]
}

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB") : "—")

/**
 * Who owes what (requirement #19).
 *
 * A tab is a closed bill that still has a balance. Collecting on one goes to
 * the same settle screen as anything else, because a tab being paid is just a
 * payment against its original bill - which is why part-payment works without
 * anything extra.
 */
export default function TabsPage() {
    const { t } = useTranslation()
    const router = useRouter()
    const [tabs, setTabs] = useState<Tab[]>([])
    const [total, setTotal] = useState(0)
    const [loading, setLoading] = useState(true)

    const load = useCallback(async () => {
        try {
            const res = await fetch("/api/tabs")
            if (res.ok) {
                const data = await res.json()
                setTabs(data.tabs ?? [])
                setTotal(data.totalOutstanding ?? 0)
            }
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => { load() }, [load])

    return (
        <div className="min-h-screen bg-slate-50">
            <Header title={t.tabs}>
                {!loading && tabs.length > 0 && (
                    <div className="text-right leading-none">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                            {t.outstanding}
                        </p>
                        <p className="text-xl font-black text-amber-700 tabular-nums mt-1">
                            {formatTHB(total)}
                        </p>
                    </div>
                )}
            </Header>

            <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-3">
                {loading ? (
                    <>
                        <div className="h-28 rounded-xl bg-white border border-slate-200 animate-pulse" />
                        <div className="h-28 rounded-xl bg-white border border-slate-200 animate-pulse" />
                    </>
                ) : tabs.length === 0 ? (
                    <div className="text-center py-20">
                        <div className="w-12 h-12 rounded-full bg-slate-100 grid place-items-center mx-auto mb-3">
                            <Clock3 className="w-6 h-6 text-slate-400" />
                        </div>
                        <p className="text-slate-900 font-semibold">{t.no_tabs}</p>
                    </div>
                ) : (
                    tabs.map((tab) => (
                        <Card key={tab.customer.id} className="p-4">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="font-bold text-slate-900 truncate">{tab.customer.name}</p>
                                    {tab.customer.phone && (
                                        <p className="text-sm text-slate-500 flex items-center gap-1.5 mt-0.5">
                                            <Phone className="w-3.5 h-3.5" />
                                            {tab.customer.phone}
                                        </p>
                                    )}
                                </div>
                                <div className="text-right shrink-0">
                                    <p className="text-2xl font-black text-amber-700 tabular-nums leading-none">
                                        {formatTHB(tab.outstanding)}
                                    </p>
                                    <p className="text-xs text-slate-400 mt-1">
                                        {tab.bills.length} {t.bill}
                                    </p>
                                </div>
                            </div>

                            {/* Each bill settles on its own: a customer paying off
                                one night but not another is normal. */}
                            <div className="mt-3 pt-3 border-t space-y-2">
                                {tab.bills.map((b) => (
                                    <div key={b.id} className="flex items-center gap-3 text-sm">
                                        <span className="font-semibold text-slate-700 shrink-0">{b.table}</span>
                                        <span className="text-slate-400 tabular-nums">{day(b.closedAt)}</span>
                                        <span className="ms-auto tabular-nums text-slate-900">
                                            {formatTHB(b.balance)}
                                        </span>
                                        <Button
                                            size="sm"
                                            className="h-9 bg-amber-600 hover:bg-amber-700 text-white shrink-0"
                                            onClick={() => router.push(`/pos/settle?session=${b.id}`)}
                                        >
                                            <CreditCard className="w-3.5 h-3.5 sm:mr-1.5" />
                                            <span className="hidden sm:inline">{t.settle_tab}</span>
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        </Card>
                    ))
                )}
            </div>
        </div>
    )
}
