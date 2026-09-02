"use client"

import * as React from "react"
import { useState, useEffect } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Clock, CheckCircle, XCircle, Play, Printer, DollarSign } from "lucide-react"
import Link from "next/link"
import { formatTHB } from "@/lib/currency"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Header } from "@/components/header"
import { useTranslation } from "@/hooks/use-translation"
import { formatLongDate } from "@/lib/date"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { format, startOfDay, endOfDay, isSameDay } from "date-fns"
import { Calendar as CalendarIcon, Filter, ChevronDown, ChevronRight, User as UserIcon, ListChecks } from "lucide-react"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"

type Order = {
    id: string
    orderNumber: string
    status: string
    total: number
    subtotal: number
    tax: number
    discount: number
    pointsRedeemed?: number
    customerId?: string
    customerName?: string
    customer?: { name: string; phone?: string }
    promotion?: { name: string; code: string }
    paymentMethod: string
    cashReceived?: number
    changeAmount?: number
    beeperNumber?: string
    createdAt: string
    items?: any[]
    cancellationReason?: string
    isReportable?: boolean
}

export default function ActiveOrdersPage() {
    const { t, lang } = useTranslation()
    const [orders, setOrders] = useState<Order[]>([])
    const [filter, setFilter] = useState<string>("ALL")
    const [paymentFilter, setPaymentFilter] = useState<string>("ALL")
    const [printingOrder, setPrintingOrder] = useState<Order | null>(null)
    const [cancellingOrder, setCancellingOrder] = useState<Order | null>(null)
    const [cancelReason, setCancelReason] = useState("")
    const [isProcessing, setIsProcessing] = useState(false)
    const [selectedDate, setSelectedDate] = useState<Date>(new Date())
    const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null)

    useEffect(() => {
        document.title = "Orders | Memories Lane"
        fetchOrders()
        const interval = setInterval(fetchOrders, 5000)
        return () => clearInterval(interval)
    }, [selectedDate, paymentFilter])

    const fetchOrders = async () => {
        try {
            const start = startOfDay(selectedDate).toISOString()
            const end = endOfDay(selectedDate).toISOString()
            let url = `/api/orders?startDate=${start}&endDate=${end}`
            if (paymentFilter !== "ALL") url += `&paymentMethod=${paymentFilter}`
            const res = await fetch(url)
            if (res.ok) {
                const data = await res.json()
                setOrders(data)
            }
        } catch (e) {
            console.error(e)
        }
    }

    const handleResumeOrder = async (orderId: string) => {
        try {
            const res = await fetch(`/api/orders/${orderId}/resume`, {
                method: 'PUT'
            })
            if (res.ok) {
                // Redirect to POS with order data
                window.location.href = `/pos?resumeOrder=${orderId}`
            }
        } catch (e) {
            console.error(e)
        }
    }

    const handleCancelOrder = async () => {
        if (!cancellingOrder || !cancelReason) return
        setIsProcessing(true)
        try {
            const res = await fetch('/api/orders', {
                method: 'POST',
                body: JSON.stringify({
                    id: cancellingOrder.id,
                    items: cancellingOrder.items || [],
                    total: cancellingOrder.total,
                    subtotal: cancellingOrder.subtotal || cancellingOrder.total,
                    tax: cancellingOrder.tax || 0,
                    paymentMethod: cancellingOrder.paymentMethod,
                    status: 'CANCELLED',
                    cancellationReason: cancelReason
                }),
                headers: { 'Content-Type': 'application/json' }
            })
            if (res.ok) {
                setCancellingOrder(null)
                setCancelReason("")
                fetchOrders()

                // Broadcast to update cash drawer
                const channel = new BroadcastChannel("pos_channel")
                channel.postMessage({ type: "PAYMENT_COMPLETE" }) // Triggers shift status refresh
                channel.close()
            }
        } catch (e) {
            console.error(e)
        } finally {
            setIsProcessing(false)
        }
    }

    const filteredOrders = filter === "ALL"
        ? orders
        : orders.filter(o => o.status === filter)

    const getStatusBadge = (status: string) => {
        const variants: Record<string, { color: string; icon: any; label: string }> = {
            // PENDING: { color: "bg-yellow-100 text-yellow-800", icon: Clock, label: t.pending_status },
            COMPLETED: { color: "bg-green-100 text-green-800", icon: CheckCircle, label: t.completed_status },
            HOLD: { color: "bg-orange-100 text-orange-800", icon: Clock, label: t.hold_status },
            CANCELLED: { color: "bg-red-100 text-red-800", icon: XCircle, label: t.cancelled_status }
        }

        const config = variants[status] || variants.PENDING
        const Icon = config.icon

        return (
            <Badge className={`${config.color} flex items-center gap-1`}>
                <Icon className="w-3 h-3" />
                {config.label}
            </Badge>
        )
    }

    return (
        <div className="min-h-screen bg-background text-foreground">
            <Header title={t.all_orders} />

            <div className="p-6 space-y-6">
                {/* Filter Tabs */}
                <div className="flex flex-col gap-4">
                    <div className="flex gap-2 overflow-x-auto pb-2">
                        {["ALL", "HOLD", "COMPLETED", "CANCELLED"].map((status) => (
                            <Button
                                key={status}
                                variant={filter === status ? "default" : "outline"}
                                onClick={() => setFilter(status)}
                                className={filter === status ? "bg-amber-600 hover:bg-amber-700 font-bold" : ""}
                            >
                                {t[status.toLowerCase() + "_status"] || status}
                            </Button>
                        ))}
                    </div>

                    <div className="flex gap-2 overflow-x-auto">
                        <span className="text-sm font-bold text-slate-400 self-center mr-2 uppercase tracking-widest">{t.pay_label}</span>
                        {["ALL", "CASH", "ONEPAY", "TRANSFER"].map((method) => (
                            <Button
                                key={method}
                                variant={paymentFilter === method ? "secondary" : "ghost"}
                                onClick={() => setPaymentFilter(method)}
                                className={`h-8 px-3 text-xs font-bold border ${paymentFilter === method ? "bg-slate-800 text-white border-slate-800" : "border-slate-200"}`}
                            >
                                {method === "ALL" ? t.all :
                                 method === "CASH" ? t.cash :
                                 method === "ONEPAY" ? "OnePay" : t.bank_transfer}
                            </Button>
                        ))}
                    </div>
                </div>

                {/* Date and Filter Controls */}
                <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center bg-white p-4 rounded-xl border shadow-sm">
                    <div className="flex items-center gap-3">
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="outline"
                                    className="flex items-center gap-2 font-bold border-amber-200 text-amber-900 bg-amber-50 hover:bg-amber-100"
                                >
                                    <CalendarIcon className="w-4 h-4" />
                                    {formatLongDate(selectedDate, lang)}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                                <Calendar
                                    mode="single"
                                    selected={selectedDate}
                                    onSelect={(date) => date && setSelectedDate(date)}
                                    initialFocus
                                />
                            </PopoverContent>
                        </Popover>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedDate(new Date())}
                            className="text-xs text-amber-700 hover:text-amber-800"
                        >
                            {t.today}
                        </Button>
                    </div>

                    <div className="text-sm font-medium text-slate-500">
                        {filteredOrders.length} {t.orders_found}
                    </div>
                </div>

                {/* Orders Table */}
                <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
                    <Table>
                        <TableHeader className="bg-slate-50">
                            <TableRow>
                                <TableHead className="w-[50px]"></TableHead>
                                <TableHead className="font-bold">{t.order_number || "Order #"}</TableHead>
                                <TableHead className="font-bold">{t.time || "Time"}</TableHead>
                                <TableHead className="font-bold">{t.status || "Status"}</TableHead>
                                <TableHead className="font-bold">{t.customer || "Customer"}</TableHead>
                                <TableHead className="font-bold text-center">{t.items || "Items"}</TableHead>
                                <TableHead className="font-bold text-right">{t.total || "Total"}</TableHead>
                                <TableHead className="font-bold">{t.payment || "Payment"}</TableHead>
                                <TableHead className="text-right font-bold">{t.actions || "Actions"}</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredOrders.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={9} className="h-64 text-center">
                                        <div className="flex flex-col items-center justify-center text-muted-foreground">
                                            <Clock className="w-12 h-12 mb-4 opacity-50" />
                                            <p>{t.no_orders_found} ({filter})</p>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                filteredOrders.map((order) => (
                                    <React.Fragment key={order.id}>
                                        <TableRow 
                                            className={`cursor-pointer hover:bg-amber-50/50 transition-colors ${expandedOrderId === order.id ? "bg-amber-50/30" : ""}`}
                                            onClick={() => setExpandedOrderId(expandedOrderId === order.id ? null : order.id)}
                                        >
                                            <TableCell>
                                                {expandedOrderId === order.id ? <ChevronDown className="w-5 h-5 text-amber-600" /> : <ChevronRight className="w-5 h-5 text-slate-400" />}
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-2">
                                                    <span className="font-black text-lg">{order.orderNumber}</span>
                                                    {order.isReportable === false && (
                                                        <Badge variant="outline" className="border-rose-300 text-rose-600 bg-rose-50 font-black text-[9px] px-1 py-0">
                                                            FREE
                                                        </Badge>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-sm font-medium text-slate-500">
                                                {format(new Date(order.createdAt), "HH:mm")}
                                            </TableCell>
                                            <TableCell>
                                                {getStatusBadge(order.status)}
                                                {order.beeperNumber && (
                                                    <Badge variant="outline" className="ml-2 border-orange-200 text-orange-700 bg-orange-50 font-bold text-[9px] px-1">
                                                        BP: {order.beeperNumber}
                                                    </Badge>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                {(order.customerName || order.customer?.name) ? (
                                                    <div className="flex items-center gap-1.5 text-sm font-bold text-slate-700">
                                                        <UserIcon className="w-3.5 h-3.5 text-slate-400" />
                                                        {order.customerName || order.customer?.name}
                                                    </div>
                                                ) : <span className="text-slate-300">--</span>}
                                            </TableCell>
                                            <TableCell className="text-center font-bold">
                                                {order.items?.reduce((sum, item) => sum + item.quantity, 0) || 0}
                                            </TableCell>
                                            <TableCell className="text-right font-black text-amber-600">
                                                {formatTHB(order.total)}
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-600">
                                                    {order.paymentMethod === 'CASH' || order.paymentMethod === 'BANK_NOTE' ? '💵 Cash' : 
                                                     order.paymentMethod === 'ONEPAY' ? '📱 OnePay' : 
                                                     order.paymentMethod === 'TRANSFER' ? '🏦 Transfer' : order.paymentMethod}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-2">
                                                    {["HOLD", "PENDING", "PREPARING"].includes(order.status) && (
                                                        <Button
                                                            size="sm"
                                                            className="bg-green-600 hover:bg-green-700 h-8 px-3 font-bold text-xs"
                                                            onClick={(e) => { e.stopPropagation(); window.location.href = `/pos?resumeOrder=${order.id}`; }}
                                                        >
                                                            <Play className="w-3.5 h-3.5 mr-1 fill-current" />
                                                            {t.resume}
                                                        </Button>
                                                    )}
                                                    {order.status === "COMPLETED" && (
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="h-8 px-3 font-bold text-xs border-blue-200 text-blue-600 hover:bg-blue-50"
                                                            onClick={(e) => { e.stopPropagation(); window.open(`/receipt?id=${order.id}`, '_blank', 'width=450,height=600'); }}
                                                        >
                                                            <Printer className="w-3.5 h-3.5 mr-1" />
                                                            {t.print}
                                                        </Button>
                                                    )}
                                                    {isSameDay(new Date(order.createdAt), new Date()) && order.status !== "CANCELLED" && (
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="h-8 px-3 font-bold text-xs border-red-200 text-red-600 hover:bg-red-50"
                                                            onClick={(e) => { e.stopPropagation(); setCancellingOrder(order); }}
                                                        >
                                                            <XCircle className="w-3.5 h-3.5 mr-1" />
                                                            {t.cancel}
                                                        </Button>
                                                    )}
                                                </div>
                                            </TableCell>
                                        </TableRow>

                                        {expandedOrderId === order.id && (
                                            <TableRow className="bg-slate-50/50 hover:bg-slate-50/50 border-b-2 border-slate-100">
                                                <TableCell colSpan={9} className="p-4">
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 animate-in fade-in slide-in-from-top-2 duration-300">
                                                        <div className="space-y-4">
                                                            <div className="flex items-center gap-2 mb-2">
                                                                <ListChecks className="w-5 h-5 text-amber-600" />
                                                                <h4 className="font-black text-slate-800 uppercase tracking-wider text-sm">{t.order_items || "Order Items"}</h4>
                                                            </div>
                                                            <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-sm">
                                                                <Table>
                                                                    <TableHeader className="bg-slate-50">
                                                                        <TableRow className="hover:bg-transparent">
                                                                            <TableHead className="text-[10px] font-black uppercase text-slate-400">{t.item}</TableHead>
                                                                            <TableHead className="text-[10px] font-black uppercase text-slate-400 text-center">{t.qty}</TableHead>
                                                                            <TableHead className="text-[10px] font-black uppercase text-slate-400 text-right">{t.price}</TableHead>
                                                                        </TableRow>
                                                                    </TableHeader>
                                                                    <TableBody>
                                                                        {order.items?.map((item, idx) => (
                                                                            <TableRow key={idx} className="hover:bg-transparent">
                                                                                <TableCell>
                                                                                    <div className="font-bold text-slate-700">{item.name}</div>
                                                                                    {(item.sugarLevel || item.shotType || item.cupSize || item.isTakeaway) && (
                                                                                        <div className="text-[10px] text-slate-400 font-medium italic">
                                                                                            {[
                                                                                                item.cupSize,
                                                                                                item.sugarLevel,
                                                                                                item.shotType,
                                                                                                item.isTakeaway ? "Take Away" : null
                                                                                            ].filter(Boolean).join(" · ")}
                                                                                        </div>
                                                                                    )}
                                                                                </TableCell>
                                                                                <TableCell className="text-center font-black">x{item.quantity}</TableCell>
                                                                                <TableCell className="text-right font-bold text-slate-600">{formatTHB(item.total)}</TableCell>
                                                                            </TableRow>
                                                                        ))}
                                                                    </TableBody>
                                                                </Table>
                                                            </div>
                                                        </div>

                                                        <div className="space-y-4">
                                                            <div className="flex items-center gap-2 mb-2">
                                                                <DollarSign className="w-5 h-5 text-emerald-600" />
                                                                <h4 className="font-black text-slate-800 uppercase tracking-wider text-sm">{t.payment_details || "Payment Details"}</h4>
                                                            </div>
                                                            <div className="bg-slate-100/50 p-4 rounded-xl border border-slate-200 space-y-3">
                                                                <div className="flex justify-between text-sm py-1 border-b border-slate-200/50">
                                                                    <span className="text-slate-500 font-bold uppercase text-[10px] tracking-tight">{t.subtotal}</span>
                                                                    <span className="font-bold text-slate-700">{formatTHB(order.subtotal || order.total + (order.discount || 0))}</span>
                                                                </div>
                                                                {order.discount > 0 && (
                                                                    <div className="flex justify-between text-sm py-1 border-b border-slate-200/50 text-rose-600">
                                                                        <span className="font-bold uppercase text-[10px] tracking-tight">{t.discount}</span>
                                                                        <span className="font-black">-{formatTHB(order.discount)}</span>
                                                                    </div>
                                                                )}
                                                                <div className="flex justify-between text-lg py-2">
                                                                    <span className="text-slate-800 font-black uppercase text-xs tracking-widest">{t.total}</span>
                                                                    <span className="font-black text-amber-600">{formatTHB(order.total)}</span>
                                                                </div>
                                                                { (order.paymentMethod === 'CASH' || order.paymentMethod === 'BANK_NOTE') && order.cashReceived !== undefined && order.cashReceived > 0 && (
                                                                    <div className="pt-2 mt-2 border-t border-slate-300 border-dashed space-y-2">
                                                                        <div className="flex justify-between text-xs">
                                                                            <span className="text-slate-500 font-bold uppercase tracking-tight">{t.received_label}</span>
                                                                            <span className="font-bold text-slate-800">{formatTHB(order.cashReceived || 0)}</span>
                                                                        </div>
                                                                        <div className="flex justify-between text-xs text-emerald-600 bg-emerald-50 p-2 rounded-lg border border-emerald-100">
                                                                            <span className="font-black uppercase tracking-tight">{t.change_due}</span>
                                                                            <span className="font-black">{formatTHB(order.changeAmount || ((order.cashReceived || 0) - order.total))}</span>
                                                                        </div>
                                                                    </div>
                                                                )}
                                                                {order.status === "CANCELLED" && order.cancellationReason && (
                                                                    <div className="mt-4 p-3 bg-red-50 rounded-lg border border-red-100">
                                                                        <p className="text-[10px] font-black text-red-800 uppercase mb-1">{t.cancellation_reason}</p>
                                                                        <p className="text-sm text-red-700 italic font-medium">{order.cancellationReason}</p>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </React.Fragment>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>

                {/* Cancellation Modal */}
                <Dialog open={!!cancellingOrder} onOpenChange={() => setCancellingOrder(null)}>
                    <DialogContent>
                        <div className="space-y-4">
                            <DialogHeader>
                                <DialogTitle>{t.cancel_order} {cancellingOrder?.orderNumber}</DialogTitle>
                            </DialogHeader>
                            <p className="text-sm text-muted-foreground">{t.cancel_order_confirm_msg}</p>
                            <div className="space-y-2">
                                <Label>{t.cancellation_reason || "Reason for Cancellation"}</Label>
                                <Input
                                    placeholder={t.order_reason_placeholder}
                                    value={cancelReason}
                                    onChange={e => setCancelReason(e.target.value)}
                                />
                            </div>
                            <div className="flex justify-end gap-2">
                                <Button variant="outline" onClick={() => setCancellingOrder(null)}>{t.keep_order}</Button>
                                <Button
                                    variant="destructive"
                                    onClick={handleCancelOrder}
                                    disabled={!cancelReason || isProcessing}
                                >
                                    {isProcessing ? `${t.processing}...` : t.yes_cancel_order}
                                </Button>
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>

                {/* Printing Modal (placeholder for future implementation) */}
                <Dialog open={!!printingOrder} onOpenChange={() => setPrintingOrder(null)}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>{t.print_receipt}</DialogTitle>
                        </DialogHeader>
                        <p>{t.print_not_implemented}</p>
                        <Button onClick={() => setPrintingOrder(null)}>{t.close}</Button>
                    </DialogContent>
                </Dialog>

                {filteredOrders.length === 0 && (
                    <div className="text-center py-12 text-muted-foreground">
                        <Clock className="w-12 h-12 mx-auto mb-4 opacity-50" />
                        <p>{t.no_orders_found} ({filter})</p>
                    </div>
                )}
            </div>

        </div>
    )
}
