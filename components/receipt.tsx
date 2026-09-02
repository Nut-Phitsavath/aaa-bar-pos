"use client"

import { useTranslation } from "@/hooks/use-translation"
import { formatLAK } from "@/lib/currency"
import { ShoppingBag } from "lucide-react"

interface ReceiptProps {
    order: {
        orderNumber: string
        date: string
        items: any[]
        subtotal: number
        tax: number
        discount: number
        total: number
        cashReceived?: number
        paymentMethod: string
        customer?: any
        staffName?: string
    }
}

export function Receipt({ order }: ReceiptProps) {
    const { t } = useTranslation()

    return (
        <div id="receipt-content" className="w-[80mm] p-4 bg-white text-slate-900 font-mono text-sm font-black">
            <div className="text-center mb-1 text-black">
                <h1 className="text-lg font-bold text-black">MEMORIES LANE CAFE</h1>
                <p className="text-[10px]">{t.vientiane_laos}</p>
                <p className="text-[10px]">Tel: +856 20 XXXX XXXX</p>
                {order.staffName && <p className="text-[10px] font-bold">{t.staff}: {order.staffName}</p>}
            </div>

            <div className="border-b border-dashed mb-2 pb-2">
                <div className="flex justify-between">
                    <span>{t.order_label}:</span>
                    <span>{order.orderNumber}</span>
                </div>
                <div className="flex justify-between">
                    <span>{t.date_label}:</span>
                    <span>{order.date}</span>
                </div>
                <div className="flex justify-between">
                    <span>{t.method_label}:</span>
                    <span>{order.paymentMethod}</span>
                </div>
            </div>

            <div className="mb-2">
                <table className="w-full">
                    <thead>
                        <tr className="border-b-2 border-dashed border-black">
                            <th className="text-left font-bold py-1 text-black">{t.item}</th>
                            <th className="text-right font-bold py-1 text-black">{t.qty}</th>
                            <th className="text-right font-bold py-1 text-black">{t.price}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {order.items.map((item, idx) => {
                            const parseNames = (name: string) => {
                                const baseName = name.replace(/-.*$/, '').trim();
                                const match = baseName.match(/^(.*?)\s*\((.*?)\)$/);
                                if (match) return { lao: match[1].trim(), english: match[2].trim() };
                                return { lao: baseName, english: null };
                            };
                            const { lao, english } = parseNames(item.name);

                            // Check for standard values
                            const checkStd = (v: string | null | undefined) => !v || v.toLowerCase().includes('normal') || v.toLowerCase().includes('standard') || v === '100%';

                            const variation = item.variation || item.variationSize?.variation?.type;
                            const size = item.cupSize || item.size || item.variationSize?.size;

                            const displayVar = !checkStd(variation) ? variation : null;
                            const displaySize = !checkStd(size) ? size : null;

                            const variationLaoMap: Record<string, string> = {
                                "HOT": "ຮ້ອນ (HOT)",
                                "ICE": "ເຢັນ (ICE)",
                                "ICED": "ເຢັນ (ICE)",
                                "BLEND": "ປັ່ນ (BLEND)",
                                "BLENDED": "ປັ່ນ (BLEND)",
                            };

                            const sugarLaoMap: Record<string, string> = {
                                "No Sweet": "ບໍ່ຫວານ / No Sweet",
                                "Less Sweet": "ຫຼຸດຫວານ / Less Sweet",
                                "Extra Sweet": "ຫວານຫຼາຍ / Extra Sweet",
                            };
                            const shotLaoMap: Record<string, string> = {
                                "Reduced Shot": "ຫຼຸດຊັອດ / Reduced Shot",
                                "Double Shot": "ເພີ່ມ / Double Shot",
                            };

                            const translatedExtras: string[] = [];
                            if (displayVar) translatedExtras.push(variationLaoMap[displayVar.toUpperCase()] || displayVar);
                            if (displaySize) translatedExtras.push(displaySize);
                            if (item.sugarLevel && !checkStd(item.sugarLevel)) translatedExtras.push(sugarLaoMap[item.sugarLevel] || item.sugarLevel);
                            if (item.shotType && !checkStd(item.shotType)) translatedExtras.push(shotLaoMap[item.shotType] || item.shotType);

                            return (
                                <tr key={idx} className="align-top text-black">
                                    <td className="py-2">
                                        <div className="font-extrabold text-black leading-tight line-clamp-2">{idx + 1}. {lao}</div>
                                        {english && (
                                            <div className="text-[11px] font-bold text-black opacity-90 truncate max-w-[45mm] mt-0.5">{english}</div>
                                        )}
                                        {translatedExtras.length > 0 && (
                                            <div className="text-[10px] font-bold text-black mt-0.5 italic">
                                                + {translatedExtras.join(', ')}
                                            </div>
                                        )}
                                        {item.isTakeaway && <div className="text-[10px] font-black uppercase italic text-black">+ {t.takeaway || "TAKE AWAY"}</div>}
                                    </td>
                                    <td className="text-right py-2 font-black text-black">{item.quantity}</td>
                                    <td className="text-right py-2 font-black text-black">{formatLAK(item.price * item.quantity)}</td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>

            <div className="border-t border-dashed pt-2 space-y-1">
                <div className="flex justify-between text-xs">
                    <span>{t.subtotal}:</span>
                    <span>{formatLAK(order.subtotal)}</span>
                </div>
                {order.discount > 0 && (
                    <div className="flex justify-between font-bold text-rose-600">
                        <span>{t.discount}:</span>
                        <span>-{formatLAK(order.discount)}</span>
                    </div>
                )}
                <div className="flex justify-between font-bold text-[14px] pt-1 border-t border-dashed border-black">
                    <span>{t.total_caps}:</span>
                    <span>{formatLAK(order.total)}</span>
                </div>
            </div>

            {order.paymentMethod === 'CASH' && order.cashReceived !== undefined && (
                <div className="mt-2 text-xs space-y-0.5 opacity-90 font-black border-t border-dashed pt-1">
                    <div className="flex justify-between">
                        <span>{t.received_label}:</span>
                        <span>{formatLAK(order.cashReceived)}</span>
                    </div>
                    <div className="flex justify-between text-[13px]">
                        <span>{t.change}:</span>
                        <span>{formatLAK(Math.max(0, order.cashReceived - order.total))}</span>
                    </div>
                </div>
            )}

            {order.customer && (
                <div className="mt-2 pt-1 border-t border-dashed text-center text-[10px] italic">
                    <p>{t.customer}: {order.customer.name}</p>
                    <p>{t.points_earned}: {Math.floor(order.total / 1000)} {t.pts}</p>
                </div>
            )}

            <div className="text-center mt-4 pt-2 border-t border-dashed text-[10px] font-black">
                <p>WiFi: Pacano / PWD: PCN12022026</p>
                <p>{t.payment}: {['CASH', 'BANK_NOTE'].includes(order.paymentMethod) ? t.cash : order.paymentMethod === 'ONEPAY' ? 'OnePay' : t.bank_transfer}</p>
                <p className="font-black text-[12px] mt-1 uppercase leading-tight">{t.thank_you_caps}</p>
                <p>{t.please_come_again}</p>
            </div>
        </div>
    )
}
