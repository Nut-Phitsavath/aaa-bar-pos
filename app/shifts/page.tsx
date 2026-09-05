"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Calendar, ChevronRight, LogOut } from "lucide-react"
import Link from "next/link"
import { format24Hour, formatDateTime24 } from "@/lib/utils"
import { formatTHB } from "@/lib/currency"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Header } from "@/components/header"
import { useTranslation } from "@/hooks/use-translation"
import { ShiftDialog } from "@/components/shift-dialog"

interface Shift {
    id: string
    userId: string | null
    startTime: string
    endTime: string | null
    startCash: number
    endCash: number | null
    actualCash: number | null
    difference: number | null
    cashPayments: number
    status: string
    createdAt: string
    updatedAt: string
}

export default function ShiftsPage() {
    const { t } = useTranslation()
    const [shifts, setShifts] = useState<Shift[]>([])
    const [loading, setLoading] = useState(true)
    const [isEndShiftOpen, setIsEndShiftOpen] = useState(false)
    const router = useRouter()
    const [actualCash, setActualCash] = useState("")
    // Which tables are holding the close open. Empty until the server says so.
    const [blocking, setBlocking] = useState<{ id: string; table: string; balance: number }[]>([])
    const [isProcessing, setIsProcessing] = useState(false)
    const [isShiftDialogOpen, setIsShiftDialogOpen] = useState(false)

    const activeShift = shifts.find(s => s.status === 'OPEN')

    useEffect(() => {
        fetchShifts()
    }, [])

    const fetchShifts = async () => {
        try {
            const res = await fetch('/api/shifts')
            if (res.ok) {
                const data = await res.json()
                setShifts(data)
            }
        } catch (error) {
            console.error('Failed to fetch shifts:', error)
        } finally {
            setLoading(false)
        }
    }

    const handleEndShift = async () => {
        if (!activeShift || !actualCash) return
        setIsProcessing(true)
        try {
            const res = await fetch('/api/shifts', {
                method: 'PUT',
                body: JSON.stringify({
                    id: activeShift.id,
                    actualCash: parseFloat(actualCash)
                }),
                headers: { 'Content-Type': 'application/json' }
            })
            if (res.status === 409) {
                // Not "something went wrong": the shift is fine, there are just
                // live tables. Name them so the manager can go and deal with
                // each one instead of guessing what is holding the close.
                const data = await res.json().catch(() => ({}))
                setBlocking(Array.isArray(data.tables) ? data.tables : [])
                return
            }
            if (res.ok) {
                setBlocking([])
                setIsEndShiftOpen(false)
                setActualCash("")
                const channel = new BroadcastChannel("payment_channel")
                channel.postMessage({ type: "PAYMENT_COMPLETE" }) // Reuse this as it triggers checkShiftStatus
                channel.close()
                fetchShifts()
            }
        } catch (error) {
            console.error('Failed to end shift:', error)
        } finally {
            setIsProcessing(false)
        }
    }

    // Baht is the till currency now; the shared formatter owns the symbol.
    const formatCurrency = (amount: number) => formatTHB(amount)

    const getShiftDuration = (start: string, end: string | null) => {
        if (!end) return t.ongoing
        const duration = new Date(end).getTime() - new Date(start).getTime()
        const hours = Math.floor(duration / (1000 * 60 * 60))
        const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60))
        return `${hours}h ${minutes}m`
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-6">
            <header className="border-b bg-white sticky top-0 z-10">
                <div className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-4">
                        <Link href="/dashboard" className="text-amber-900 hover:text-amber-700">
                            <h1 className="text-2xl font-bold">{t.dashboard}</h1>
                        </Link>
                        <ChevronRight className="w-5 h-4 text-muted-foreground" />
                        <h1 className="text-2xl font-bold text-amber-900">{t.shift_reports}</h1>
                    </div>
                    <div className="flex items-center gap-4">
                        <Button
                            className="bg-amber-600 hover:bg-amber-700 text-white font-bold"
                            onClick={() => setIsShiftDialogOpen(true)}
                            disabled={!!activeShift}
                        >
                            {t.open_status || "Open Shift"}
                        </Button>
                    </div>
                </div>
            </header>


            <div className="max-w-7xl mt-6 mx-auto space-y-12 h-[calc(100vh-120px)] overflow-y-auto no-scrollbar pb-10">
                {/* Shifts Summary Card or Stats could go here if needed */}
                <div className="flex items-center justify-between px-2">
                    <h3 className="text-xl font-bold text-slate-800">{t.shift_history || "Shift History"}</h3>
                </div>


                {/* Shifts Table */}
                <Card className="p-6">
                    {loading ? (
                        <div className="text-center py-8">{t.loading_shifts}</div>
                    ) : shifts.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
                            <p>{t.no_shifts_found}</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b">
                                        <th className="text-left p-3 font-semibold">{t.date_label}</th>
                                        <th className="text-left p-3 font-semibold">{t.start_time_label}</th>
                                        <th className="text-left p-3 font-semibold">{t.end_time_label}</th>
                                        <th className="text-right p-3 font-semibold">{t.duration_label}</th>
                                        <th className="text-right p-3 font-semibold">{t.start_cash_label}</th>
                                        <th className="text-right p-3 font-semibold">{t.cash_sales_label}</th>
                                        <th className="text-right p-3 font-semibold">{t.expected_label}</th>
                                        <th className="text-right p-3 font-semibold">{t.actual_label}</th>
                                        <th className="text-right p-3 font-semibold">{t.difference_label}</th>
                                        <th className="text-center p-3 font-semibold">{t.status}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {shifts.map((shift) => {
                                        const expected = shift.startCash + shift.cashPayments
                                        const difference = shift.actualCash ? shift.actualCash - expected : null

                                        return (
                                            <tr key={shift.id} className="border-b hover:bg-muted/50">
                                                <td className="p-3">{new Date(shift.startTime).toLocaleDateString('en-GB')}</td>
                                                <td className="p-3">{format24Hour(shift.startTime)}</td>
                                                <td className="p-3">{shift.endTime ? format24Hour(shift.endTime) : '-'}</td>
                                                <td className="p-3 text-right">{getShiftDuration(shift.startTime, shift.endTime)}</td>
                                                <td className="p-3 text-right font-mono">{formatCurrency(shift.startCash)}</td>
                                                <td className="p-3 text-right font-mono">{formatCurrency(shift.cashPayments)}</td>
                                                <td className="p-3 text-right font-mono">{formatCurrency(expected)}</td>
                                                <td className="p-3 text-right font-mono">
                                                    {shift.actualCash !== null ? formatCurrency(shift.actualCash) : '-'}
                                                </td>
                                                <td className={`p-3 text-right font-mono font-bold ${difference === null ? '' :
                                                    difference > 0 ? 'text-green-600' :
                                                        difference < 0 ? 'text-red-600' : ''
                                                    }`}>
                                                    {difference !== null ? (
                                                        difference > 0 ? `+${formatCurrency(difference)}` : formatCurrency(difference)
                                                    ) : '-'}
                                                </td>
                                                <td className="p-3 text-center">
                                                    <span className={`px-2 py-1 rounded-full text-xs font-bold ${shift.status === 'OPEN' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                                                        }`}>
                                                        {shift.status === 'OPEN' ? t.open_status : t.closed_status}
                                                    </span>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </Card>
            </div>

            <Dialog open={isEndShiftOpen} onOpenChange={setIsEndShiftOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t.end_current_shift}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="p-4 bg-muted rounded-lg space-y-2">
                            <div className="flex justify-between text-sm">
                                <span>{t.starting_cash_with_colon}</span>
                                <span>{activeShift ? formatCurrency(activeShift.startCash) : 0}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span>{t.cash_sales_with_colon}</span>
                                <span>{activeShift ? formatCurrency(activeShift.cashPayments) : 0}</span>
                            </div>
                            <div className="flex justify-between font-bold border-t pt-2">
                                <span>{t.expected_cash_with_colon}</span>
                                <span className="text-amber-600">
                                    {activeShift ? formatCurrency(activeShift.startCash + activeShift.cashPayments) : 0}
                                </span>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="actualCash">{t.actual_cash_counted}</Label>
                            <Input
                                type="text"
                                placeholder="0"
                                value={actualCash ? Number(actualCash).toLocaleString() : ""}
                                onChange={e => {
                                    const val = e.target.value.replace(/\D/g, "")
                                    setActualCash(val)
                                }}
                                className="text-lg font-bold"
                            />
                        </div>

                        {actualCash && activeShift && (
                            <div className={`p-3 rounded-md text-sm font-medium ${parseFloat(actualCash) - (activeShift.startCash + activeShift.cashPayments) >= 0
                                ? 'bg-green-50 text-green-700'
                                : 'bg-red-50 text-red-700'
                                }`}>
                                {t.difference_label}: {formatCurrency(parseFloat(actualCash) - (activeShift.startCash + activeShift.cashPayments))}
                            </div>
                        )}

                        {/* What is actually holding the close, each one a way in
                            to go and deal with it. A refusal that does not say
                            which table is the reason staff hunt the floor at 3am
                            for something the till can already see. */}
                        {blocking.length > 0 && (
                            <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3 space-y-2">
                                <p className="text-sm font-bold text-amber-900">{t.tables_still_open}</p>
                                {blocking.map((b) => (
                                    <div key={b.id} className="flex items-center gap-3 text-sm">
                                        <span className="font-bold text-slate-900">{b.table}</span>
                                        <span className="tabular-nums text-slate-700">{formatCurrency(b.balance)}</span>
                                        <Button
                                            size="sm"
                                            className="ms-auto h-9 bg-amber-600 hover:bg-amber-700 text-white"
                                            onClick={() => router.push(`/pos/settle?session=${b.id}`)}
                                        >
                                            {t.settle_bill}
                                        </Button>
                                    </div>
                                ))}
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
                            {isProcessing ? t.ending_shift_status : t.confirm_close_shift}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <ShiftDialog open={isShiftDialogOpen} onOpenChange={setIsShiftDialogOpen} />
        </div>
    )
}
