"use client"

import { useEffect, useState } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Calendar, ChevronRight, LogOut, Printer } from "lucide-react"
import Link from "next/link"
import { format24Hour, formatDateTime24 } from "@/lib/utils"
import { formatTHB } from "@/lib/currency"
import { Header } from "@/components/header"
import { useTranslation } from "@/hooks/use-translation"
import { ShiftDialog } from "@/components/shift-dialog"
import { ReceiptDialog } from "@/components/receipt-dialog"

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
    // The Z slip in the receipt dialog: X for the open shift, a reprint for a closed one.
    const [zSrc, setZSrc] = useState<string | null>(null)
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
                        <Link href="/dashboard" className="text-amber-900 hover:text-amber-800">
                            <h1 className="text-2xl font-bold">{t.dashboard}</h1>
                        </Link>
                        <ChevronRight className="w-5 h-4 text-muted-foreground" />
                        <h1 className="text-2xl font-bold text-amber-900">{t.shift_reports}</h1>
                    </div>
                    <div className="flex items-center gap-4">
                        <Button
                            className="bg-amber-600 hover:bg-amber-700 text-amber-950 font-bold"
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
                                        <th className="p-3"><span className="sr-only">{t.z_report}</span></th>
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
                                                {/* The Z again for a closed shift, the way SambaPOS reports a
                                                    past work period; for the open one, the X - live, not final. */}
                                                <td className="p-3 text-right">
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-9 whitespace-nowrap"
                                                        onClick={() => setZSrc(`/receipt/z?shift=${encodeURIComponent(shift.id)}${shift.status === 'OPEN' ? '' : '&reprint=1'}`)}
                                                    >
                                                        <Printer className="w-4 h-4 me-1.5" />
                                                        {shift.status === 'OPEN' ? t.z_view_x : t.z_print}
                                                    </Button>
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


            <ShiftDialog open={isShiftDialogOpen} onOpenChange={setIsShiftDialogOpen} />

            <ReceiptDialog src={zSrc} onClose={() => setZSrc(null)} />
        </div>
    )
}
