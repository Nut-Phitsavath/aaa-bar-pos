"use client"

import { useState, useEffect, use } from "react"
import { QRCodeSVG } from "qrcode.react"
import { formatTHB, formatLAK, formatUSD, thbToLak, thbToUsd } from "@/lib/currency"

type PrintOrder = {
    id: string
    tableOrderNumber: number | null
    status: string
    total: number
    createdAt: string
    waiter: { name: string } | null
    user: { name: string } | null
    items: { id: string; name: string; localName: string | null; quantity: number; total: number }[]
}

type PrintBill = {
    id: string
    openedAt: string
    closedAt: string | null
    table: { name: string; area: string }
    orders: PrintOrder[]
    payments: { method: string; amount: number; paymentStatus: string | null; qrCodeData: string | null }[]
    gross: number
    discount: number
    total: number
    balance: number
    fxRateLAK: number
    fxRateUSD: number
    showUsd: boolean
}

const clock = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
const stamp = (iso: string) =>
    `${new Date(iso).toLocaleDateString("en-GB")} ${clock(iso)}`

/**
 * The printed table bill (requirements #3 and #20).
 *
 * Sized for an 80mm thermal roll and printed through the browser, the same way
 * the walk-in receipt already prints. Everything on it is what a customer or an
 * auditor needs to check the bill: the table, when it opened and closed, each
 * round under its own number, who keyed it and who served it, the total in baht
 * with the kip conversion at the rate it was struck, and a QR for the balance.
 */
export default function PrintBillPage({ params }: { params: Promise<{ sessionId: string }> }) {
    const { sessionId } = use(params)
    const [bill, setBill] = useState<PrintBill | null>(null)
    const [shop, setShop] = useState<any>(null)

    useEffect(() => {
        document.title = "Bill"
        Promise.all([
            fetch(`/api/table-sessions/${sessionId}`).then((r) => (r.ok ? r.json() : null)),
            fetch("/api/settings").then((r) => (r.ok ? r.json() : {})),
        ]).then(([b, s]) => {
            setBill(b)
            setShop(s)
            // Let the layout settle before the print dialog freezes it.
            if (b) setTimeout(() => window.print(), 400)
        })
    }, [sessionId])

    if (!bill) return <div className="p-6 text-sm">…</div>

    const rounds = bill.orders
        .filter((o) => o.status !== "HOLD")
        .sort((a, b) => (a.tableOrderNumber ?? 0) - (b.tableOrderNumber ?? 0))

    // POS staff first, then servers - both comma separated when a bill passed
    // through more than one pair of hands.
    const posStaff = Array.from(new Set(rounds.map((o) => o.user?.name).filter(Boolean)))
    const servers = Array.from(new Set(rounds.map((o) => o.waiter?.name).filter(Boolean)))

    const liveQr = bill.payments.find(
        (p) => p.method === "ONEPAY" && p.paymentStatus === "PENDING" && p.qrCodeData
    )
    const paid = bill.total - bill.balance

    return (
        <div className="bg-white text-black mx-auto p-3 text-[12px] leading-tight" style={{ width: "80mm" }}>
            <style>{`
        @page { size: 80mm auto; margin: 3mm; }
        @media print { .no-print { display: none !important } }
      `}</style>

            <div className="text-center mb-2">
                <h1 className="text-[15px] font-bold">{shop?.shopName || "Bill"}</h1>
                {shop?.shopAddress && <p className="text-[10px]">{shop.shopAddress}</p>}
                {shop?.shopPhone && <p className="text-[10px]">{shop.shopPhone}</p>}
            </div>

            <div className="border-t border-b border-dashed border-black py-1.5 mb-2">
                <div className="flex justify-between font-bold text-[14px]">
                    <span>ໂຕະ / Table</span>
                    <span>{bill.table.name}</span>
                </div>
                <div className="flex justify-between text-[11px]">
                    <span>ເປີດ / Opened</span>
                    <span>{stamp(bill.openedAt)}</span>
                </div>
                <div className="flex justify-between text-[11px]">
                    <span>ປິດ / Closed</span>
                    <span>{bill.closedAt ? stamp(bill.closedAt) : "—"}</span>
                </div>
            </div>

            {rounds.map((order) => {
                const voided = order.status === "CANCELLED"
                return (
                    <div key={order.id} className={`mb-2 ${voided ? "opacity-60" : ""}`}>
                        <div className="flex justify-between font-bold border-b border-dotted border-black">
                            <span>
                                ອໍເດີ #{order.tableOrderNumber ?? "-"}
                                {voided && " (VOID)"}
                            </span>
                            <span>{clock(order.createdAt)}</span>
                        </div>
                        {order.items.map((item) => (
                            <div key={item.id} className="flex justify-between">
                                <span className="pr-2">
                                    {item.quantity}× {item.localName || item.name}
                                </span>
                                <span className={voided ? "line-through" : ""}>{formatTHB(item.total)}</span>
                            </div>
                        ))}
                    </div>
                )
            })}

            <div className="border-t border-dashed border-black pt-1.5 mt-2">
                {bill.discount > 0 && (
                    <>
                        <div className="flex justify-between">
                            <span>ລວມ / Subtotal</span>
                            <span>{formatTHB(bill.gross)}</span>
                        </div>
                        <div className="flex justify-between">
                            <span>ສ່ວນຫຼຸດ / Discount</span>
                            <span>− {formatTHB(bill.discount)}</span>
                        </div>
                    </>
                )}
                <div className="flex justify-between font-bold text-[15px] mt-1">
                    <span>ລວມທັງໝົດ</span>
                    <span>{formatTHB(bill.total)}</span>
                </div>
                <div className="flex justify-between text-[11px]">
                    <span>1 ฿ = {bill.fxRateLAK.toLocaleString("en-US")} ₭</span>
                    <span>{formatLAK(thbToLak(bill.total, bill.fxRateLAK))}</span>
                </div>
                {bill.showUsd && (
                    <div className="flex justify-end text-[11px]">
                        {formatUSD(thbToUsd(bill.total, bill.fxRateUSD))}
                    </div>
                )}
                {paid > 0 && (
                    <>
                        <div className="flex justify-between text-[11px] mt-1">
                            <span>ຈ່າຍແລ້ວ / Paid</span>
                            <span>− {formatTHB(paid)}</span>
                        </div>
                        <div className="flex justify-between font-bold">
                            <span>ຍອດຄ້າງ / Balance</span>
                            <span>{formatTHB(bill.balance)}</span>
                        </div>
                    </>
                )}
            </div>

            <div className="border-t border-dashed border-black mt-2 pt-1.5 text-[11px]">
                <div className="flex justify-between gap-2">
                    <span className="shrink-0">ພະນັກງານ POS</span>
                    <span className="text-right">{posStaff.join(", ") || "—"}</span>
                </div>
                <div className="flex justify-between gap-2">
                    <span className="shrink-0">ພະນັກງານເສີບ</span>
                    <span className="text-right">{servers.join(", ") || "—"}</span>
                </div>
            </div>

            {liveQr?.qrCodeData && bill.balance > 0 && (
                <div className="text-center mt-3 pt-2 border-t border-dashed border-black">
                    <p className="text-[11px] mb-1">ສະແກນເພື່ອຈ່າຍ / Scan to pay</p>
                    <div className="inline-block">
                        <QRCodeSVG value={liveQr.qrCodeData} size={150} level="H" />
                    </div>
                    <p className="font-bold mt-1">{formatTHB(bill.balance)}</p>
                </div>
            )}

            {shop?.receiptFooter && (
                <p className="text-center text-[10px] mt-3">{shop.receiptFooter}</p>
            )}

            <button
                onClick={() => window.print()}
                className="no-print mt-4 w-full h-10 border border-black text-[12px]"
            >
                Print
            </button>
        </div>
    )
}
