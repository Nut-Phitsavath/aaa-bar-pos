"use client"

import { useEffect, useState } from "react"
import { QRCodeSVG } from "qrcode.react"
import { Card } from "@/components/ui/card"
import { CheckCircle, Loader2 } from "lucide-react"
import { formatLAK } from "@/lib/currency"
import { useTranslation } from "@/hooks/use-translation"

interface PaymentQRProps {
    amount: number
    orderNumber: string
    orderId?: string
    onComplete?: () => void
}

export function PaymentQR({ amount, orderNumber, orderId, onComplete }: PaymentQRProps) {
    const { t } = useTranslation()
    const [status, setStatus] = useState<"pending" | "completed">("pending")
    const [qrData, setQrData] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(false)

    // Generate/Fetch Onepay QR
    useEffect(() => {
        if (!orderId) return;

        async function fetchQR() {
            setIsLoading(true);
            try {
                const res = await fetch('/api/payments/onepay/generate', {
                    method: 'POST',
                    body: JSON.stringify({ orderId }),
                    headers: { 'Content-Type': 'application/json' }
                });
                if (res.ok) {
                    const data = await res.json();
                    setQrData(data.qrCode);
                } else {
                    setError("Failed to generate QR code");
                }
            } catch (err) {
                setError("Connection error");
            } finally {
                setIsLoading(false);
            }
        }

        fetchQR();
    }, [orderId]);

    // Poll for payment status
    useEffect(() => {
        if (!orderId || status === "completed") return;

        const interval = setInterval(async () => {
            try {
                const res = await fetch(`/api/payments/onepay/status/${orderId}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.status === "PAID") {
                        setStatus("completed");
                        clearInterval(interval);
                        if (onComplete) {
                            setTimeout(onComplete, 1500);
                        }
                    }
                }
            } catch (err) {
                console.error("Polling error:", err);
            }
        }, 3000); // Poll every 3 seconds

        return () => clearInterval(interval);
    }, [orderId, status, onComplete]);

    // Broadcast to customer-view
    useEffect(() => {
        const channel = new BroadcastChannel("pos_channel")
        channel.postMessage({
            type: "QR_PAYMENT",
            data: {
                qrData: qrData || "LOADING",
                amount,
                orderNumber,
                status,
            },
        })

        return () => channel.close()
    }, [qrData, amount, orderNumber, status])

    return (
        <div className="space-y-4">
            <div className="text-center">
                <p className="text-sm text-muted-foreground mb-2">{t.amount_to_pay}</p>
                <p className="text-3xl font-bold text-blue-600">{formatLAK(amount)}</p>
            </div>

            <Card className="p-6 bg-white min-h-[300px] flex items-center justify-center">
                <div className="flex flex-col items-center gap-4 w-full">
                    {status === "pending" ? (
                        <>
                            {isLoading ? (
                                <div className="flex flex-col items-center gap-2">
                                    <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
                                    <p className="text-sm text-slate-500">{t.generating_qr}</p>
                                </div>
                            ) : qrData ? (
                                <>
                                    <div className="bg-white p-2 border-2 border-slate-100 rounded-xl shadow-inner">
                                        <QRCodeSVG value={qrData} size={220} level="H" />
                                    </div>
                                    <div className="text-center">
                                        <p className="font-black text-slate-800 uppercase tracking-tight">Onepay QR</p>
                                        <p className="text-sm text-muted-foreground">{t.order_label} {orderNumber}</p>
                                    </div>
                                    <div className="flex items-center gap-3 bg-blue-50 px-4 py-2 rounded-full text-blue-700 border border-blue-100">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        <span className="text-sm font-bold uppercase tracking-wider">{t.waiting_for_payment}</span>
                                    </div>
                                </>
                            ) : (
                                <div className="text-center text-rose-500 p-4">
                                    <p className="font-bold underline">{t.error_label}</p>
                                    <p className="text-sm">{error || "Could not load QR code"}</p>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="flex flex-col items-center gap-3 text-green-600 animate-in zoom-in-50 duration-300">
                            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-2">
                                <CheckCircle className="w-12 h-12" />
                            </div>
                            <p className="font-black text-2xl uppercase tracking-tighter italic">{t.payment_verified}</p>
                            <p className="text-sm text-green-600/70">{t.processing_order_now}</p>
                        </div>
                    )}
                </div>
            </Card>

            <div className="bg-slate-800 text-white rounded-xl p-4 shadow-lg overflow-hidden relative">
                <div className="absolute top-0 right-0 p-2 opacity-10">
                    <QRCodeSVG value="https://bcel.com.la" size={40} />
                </div>
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center shrink-0">
                        <Loader2 className="w-4 h-4 animate-spin text-blue-300" />
                    </div>
                    <p className="text-[11px] font-bold leading-tight uppercase tracking-wide">
                        Live Sync: Customer display is showing this QR code for payment.
                    </p>
                </div>
            </div>
        </div>
    )
}
