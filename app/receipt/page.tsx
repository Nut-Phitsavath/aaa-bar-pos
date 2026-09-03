"use client"

import { useEffect, useState, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Printer, ArrowLeft } from "lucide-react"
import Link from "next/link"
import { formatTHB, formatLAK, formatUSD, thbToLak, thbToUsd, calculateInclusiveTax } from "@/lib/currency"
import { QRCodeSVG } from "qrcode.react"
import { useTranslation } from "@/hooks/use-translation"


/**
 * A table bill, in the counter receipt's clothes.
 *
 * Same card, same mono type, same dashed dividers and the same print
 * stylesheet - a customer should not be able to tell which till printed their
 * slip, and a second design would be a second thing to keep right.
 *
 * What differs is the head and the body, not the look: a table bill is
 * identified by table and reference rather than an order number, and its rounds
 * are flattened into one list with repeats merged, because at the point of
 * paying nobody checks which round a drink came from. Voided lines are dropped:
 * the customer was never charged for them.
 */
function TableBillReceipt({ bill, settings, t }: { bill: any; settings: any; t: any }) {
  const stamp = (iso: string) => {
    const d = new Date(iso)
    return `${d.toLocaleDateString("en-GB")} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
  }

  const opened = new Date(bill.openedAt)
  const reference = `${bill.table.name.replace(/\s+/g, "")}-${String(opened.getDate()).padStart(2, "0")}${String(opened.getMonth() + 1).padStart(2, "0")}-${bill.id.slice(0, 4).toUpperCase()}`

  const live = (bill.orders || []).filter((o: any) => o.status !== "CANCELLED" && o.status !== "HOLD")

  const lines = new Map<string, { name: string; english: string | null; quantity: number; total: number }>()
  for (const o of live) {
    for (const i of o.items) {
      const unit = i.quantity > 0 ? i.total / i.quantity : 0
      const key = `${i.name}::${unit}`
      const at = lines.get(key)
      if (at) { at.quantity += i.quantity; at.total += i.total }
      else lines.set(key, {
        name: i.localName || i.name,
        english: i.localName ? i.name : null,
        quantity: i.quantity,
        total: i.total,
      })
    }
  }

  const posStaff = Array.from(new Set(live.map((o: any) => o.user?.name).filter(Boolean)))
  const servers = Array.from(new Set(live.map((o: any) => o.waiter?.name).filter(Boolean)))
  const taxRate = Number(settings?.taxRate) || 0
  const tax = calculateInclusiveTax(bill.total, taxRate)
  const paid = bill.total - bill.balance
  const liveQr = (bill.payments || []).find(
    (p: any) => p.method === "ONEPAY" && p.paymentStatus === "PENDING" && p.qrCodeData
  )

  return (
    <div className="flex flex-col items-center min-h-screen bg-gray-200 py-12 px-4 print:bg-white print:p-0">
      <Card id="printable-receipt" className="w-[480px] p-2 bg-white shadow-2xl border-none font-mono text-base leading-tight font-black text-black print:w-full print:shadow-none print:p-1">
        <div className="text-center space-y-0 mb-1 pt-0">
          <h1 className="text-lg font-black tracking-tight text-black mt-4">{settings?.shopName || 'Cafe POS'}</h1>
        </div>

        <div className="p-2 pb-0 bg-slate-50 relative overflow-hidden">
          <div className="text-center border-b border-dashed border-slate-300 pb-1 mb-1">
            <p className="text-[10px] uppercase tracking-wider font-black text-black">ໂຕະ / TABLE</p>
            <p className="text-xl font-black text-black">{bill.table.name}</p>
            <p className="text-[10px] mt-0 font-black text-black">{reference}</p>

            <div className="text-[11px] font-black text-black mt-2 text-left border-t border-dashed border-slate-200 pt-1 space-y-0.5">
              <div className="flex justify-between gap-2">
                <span>{t.pos_staff}</span>
                <span className="text-right">{posStaff.join(", ") || "—"}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span>{t.server_staff}</span>
                <span className="text-right">{servers.join(", ") || "—"}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span>ເປີດ / Opened</span>
                <span>{stamp(bill.openedAt)}</span>
              </div>
              {/* Only once it has happened - a dash against "Closed" is a
                  placeholder for a fact that does not exist yet. */}
              {bill.closedAt && (
                <div className="flex justify-between gap-2">
                  <span>ປິດ / Closed</span>
                  <span>{stamp(bill.closedAt)}</span>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-0.5 mb-2">
            {Array.from(lines.values()).map((l, i) => (
              <div key={i} className="flex flex-col mb-1.5 text-md leading-tight">
                <div className="flex justify-between font-black items-start gap-1 text-black">
                  <div className="flex-1 min-w-0">
                    <span className="line-clamp-2 break-words">{i + 1}. {l.name}</span>
                  </div>
                  <div className="flex items-start gap-1 whitespace-nowrap flex-shrink-0">
                    <span>x{l.quantity} •</span>
                    <span>{formatTHB(l.total)}</span>
                  </div>
                </div>
                {l.english && (
                  <div className="text-[12px] text-black opacity-90 font-bold truncate overflow-hidden whitespace-nowrap mb-0.5">
                    {l.english}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="border-t border-dashed border-slate-300 pt-2 space-y-0.5">
            {bill.discount > 0 && (
              <>
                <div className="flex justify-between text-xs font-black">
                  <span>{t.gross_total}</span>
                  <span className="line-through">{formatTHB(bill.gross)}</span>
                </div>
                <div className="flex justify-between text-xs text-rose-700 font-black">
                  <span>{t.discount}</span>
                  <span>-{formatTHB(bill.discount)}</span>
                </div>
              </>
            )}

            <div className="flex justify-between font-bold text-sm mt-1 pt-1 border-t border-dashed border-slate-300 text-black">
              <span>{t.grand_total}</span>
              <span>{formatTHB(bill.total)}</span>
            </div>

            {/* Inclusive: this states how much of the total above is VAT, it is
                not added on top. */}
            {taxRate > 0 && (
              <div className="flex justify-between text-[11px] font-black text-black">
                <span>ລວມ VAT {taxRate}%</span>
                <span>{formatTHB(tax)}</span>
              </div>
            )}

            <div className="flex justify-between text-[11px] font-black text-black">
              <span>1 ฿ = {bill.fxRateLAK.toLocaleString("en-US")} ₭</span>
              <span>{formatLAK(thbToLak(bill.total, bill.fxRateLAK))}</span>
            </div>
            {bill.showUsd && (
              <div className="flex justify-end text-[11px] font-black text-black">
                {formatUSD(thbToUsd(bill.total, bill.fxRateUSD))}
              </div>
            )}
          </div>

          {paid > 0 && (
            <div className="mt-1 pt-1 border-t border-dashed border-slate-300 text-sm font-black text-black">
              <div className="flex justify-between">
                <span>ຈ່າຍແລ້ວ / Paid:</span>
                <span>{formatTHB(paid)}</span>
              </div>
              <div className="flex justify-between">
                <span>ຍອດຄ້າງ / Balance:</span>
                <span>{formatTHB(bill.balance)}</span>
              </div>
            </div>
          )}
        </div>

        {liveQr?.qrCodeData && bill.balance > 0 && (
          <div className="text-center mt-2 pt-1 border-t border-dashed border-slate-300">
            <p className="text-[11px] font-black">ສະແກນເພື່ອຈ່າຍ / Scan to pay</p>
            <div className="inline-block mt-1">
              <QRCodeSVG value={liveQr.qrCodeData} size={150} level="H" />
            </div>
            <p className="font-black mt-1">{formatTHB(bill.balance)}</p>
          </div>
        )}

        <div className="text-center mt-2 pt-1 border-t border-dashed border-slate-300 text-xs font-black">
          <p className="font-black mt-1 whitespace-pre-wrap">{settings?.receiptFooter || 'THANK YOU FOR VISITING!'}</p>
        </div>
      </Card>

      <div className="mt-8 flex gap-3 print:hidden">
        <Button variant="outline" onClick={() => window.print()}>
          <Printer className="w-4 h-4 mr-2" />
          {t.re_print}
        </Button>
        <Button className="bg-amber-600 hover:bg-amber-700" onClick={() => window.close()}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          {t.close_and_back}
        </Button>
      </div>

      <style dangerouslySetInnerHTML={{
        __html: `
        @media print {
          @page { margin: 0; size: 58mm auto; }
          body { background: white !important; margin: 0 !important; padding: 0 !important; min-height: auto !important; }
          #printable-receipt {
            box-shadow: none !important; border: none !important;
            width: 100% !important; max-width: 80mm !important;
            padding: 1mm !important; margin: 0 auto !important;
          }
          .print-hidden, button, a { display: none !important; }
        }
      ` }} />
    </div>
  )
}

function ReceiptContent() {
  const { t } = useTranslation()
  const searchParams = useSearchParams()
  const orderId = searchParams.get("id")
  // A table bill prints through this same page rather than a second receipt of
  // its own: one design, one print stylesheet, one thing to keep right.
  const sessionId = searchParams.get("session")
  const [order, setOrder] = useState<any>(null)
  const [bill, setBill] = useState<any>(null)
  const [settings, setSettings] = useState<any>(null) // Added settings state
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!sessionId) return
    document.title = "Bill | Memories Lane"
    fetch(`/api/table-sessions/${sessionId}`)
      .then(res => {
        if (res.ok) return res.json()
        throw new Error("Bill not found")
      })
      .then(data => {
        setBill(data)
        setTimeout(() => window.print(), 500)
      })
      .catch(e => { console.error(e); setError(e.message) })
  }, [sessionId])

  useEffect(() => {
    document.title = "Receipt | Memories Lane"
    if (orderId) {
      fetch(`/api/orders/${orderId}`)
        .then(res => {
          if (res.ok) return res.json()
          throw new Error("Order not found")
        })
        .then(data => {
          setOrder(data)
          // Auto-trigger print once loaded
          const mode = searchParams.get("mode")
          if (mode === 'double') {
            setTimeout(() => {
              window.print()
              // Second print after a small delay to ensure they are seen as two jobs 
              // and the cut happens (if printer configured that way).
              // Some browsers might need the first print to finish.
              // We'll trigger it twice.
              setTimeout(() => {
                window.print()
              }, 1000)
            }, 500)
          } else {
            setTimeout(() => {
              window.print()
            }, 500)
          }
        })
        .catch(e => {
          console.error(e)
          setError(e.message)
        })
    }

    // Fetch settings
    fetch('/api/settings')
      .then((res) => {
        if (res.ok) return res.json()
        throw new Error("Failed to fetch settings")
      })
      .then((data) => setSettings(data))
      .catch((e) => {
        console.error(e)
        // Optionally set an error for settings as well, or just log
      })

  }, [orderId])

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4">
        <p className="text-rose-600 mb-4">{t.error_label}: {error}</p>
        <Button variant="outline" onClick={() => window.close()}>{t.close_window}</Button>
      </div>
    )
  }

  if (sessionId) {
    if (!bill) {
      return (
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-900"></div>
          <p className="ml-3">{t.generating_receipt}</p>
        </div>
      )
    }
    return <TableBillReceipt bill={bill} settings={settings} t={t} />
  }

  if (!order) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-900"></div>
        <p className="ml-3">{t.generating_receipt}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center min-h-screen bg-gray-200 py-12 px-4 print:bg-white print:p-0">
      <Card id="printable-receipt" className={`w-[480px] p-2 bg-white shadow-2xl border-none font-mono text-base leading-tight font-black text-black print:w-full print:shadow-none print:p-1`}>
        <div className="text-center space-y-0 mb-1 pt-0">
          {/* <div className="flex justify-center mb-1 text-black">
            <img src={settings?.shopLogo || "/placeholder-logo.png"} alt="Logo" className="h-14 w-auto object-contain" />
          </div> */}
          <h1 className="text-lg font-black tracking-tight text-black mt-4">{settings?.shopName || 'Cafe POS'}</h1>
        </div>

        <div className="p-2 pb-0 bg-slate-50 relative overflow-hidden">
          <div className="text-center border-b border-dashed border-slate-300 pb-1 mb-1">
            <p className="text-[10px] uppercase tracking-wider font-black text-black">{t.order_number}</p>
            <p className="text-xl font-black text-black">{order.orderNumber}</p>
            <p className="text-[10px] mt-0 font-black text-black">{new Date(order.createdAt).toLocaleString()}</p>
            {order?.user?.name && <p className="text-[11px] font-black text-black mt-2 text-left border-t border-dashed border-slate-200 pt-1">{t.staff}: {order.user.name}</p>}
          </div>

          {order.beeperNumber && (
            <div className="mb-2 p-1 border-4 border-dashed border-slate-700 text-center font-bold text-md">
              ຄິວເລກທີ (BEEPERS): {order.beeperNumber}
            </div>
          )}

          <div className="space-y-0.5 mb-2">
            {order.items?.map((item: any, i: number) => {

              const parseNames = (name: string) => {
                const baseName = name.replace(/-.*$/, '').trim();
                const match = baseName.match(/^(.*?)\s*\((.*?)\)$/);
                if (match) return { lao: match[1].trim(), english: match[2].trim() };
                return { lao: baseName, english: null };
              };

              const variation = item.variation || item.variationSize?.variation?.type;
              const size = item.cupSize || item.size || item.variationSize?.size;
              const { lao: laoName, english: engName } = parseNames(item.name);

              const checkStd = (v: string | null | undefined) => !v || v.toLowerCase().includes('normal') || v.toLowerCase().includes('standard') || v === '100%';

              const displayVar = !checkStd(variation) ? variation : null;
              const displaySize = !checkStd(size) ? size : null;

              const isSugarStandard = checkStd(item.sugarLevel);
              const isShotStandard = checkStd(item.shotType);

              const extraOptions = [];
              if (!isSugarStandard) extraOptions.push(item.sugarLevel);
              if (!isShotStandard) extraOptions.push(item.shotType);

              const sugarLaoMap: Record<string, string> = {
                "No Sweet": "ບໍ່ຫວານ / No Sweet",
                "Less Sweet": "ຫຼຸດຫວານ / Less Sweet",
                "Extra Sweet": "ຫວານຫຼາຍ / Extra Sweet",
              };
              const shotLaoMap: Record<string, string> = {
                "Reduced Shot": "ຫຼຸດຊັອດ / Reduced Shot",
                "Double Shot": "ເພີ່ມຊັອດ / Double Shot",
              };

              const variationLaoMap: Record<string, string> = {
                "HOT": "ຮ້ອນ (HOT)",
                "ICE": "ເຢັນ (ICE)",
                "ICED": "ເຢັນ (ICE)",
                "BLEND": "ປັ່ນ (BLEND)",
                "BLENDED": "ປັ່ນ (BLEND)",
              };


              const translatedExtras: string[] = [];
              if (displayVar) translatedExtras.push(variationLaoMap[displayVar.toUpperCase()] || displayVar);
              if (displaySize) translatedExtras.push(displaySize);
              if (!isSugarStandard && item.sugarLevel) translatedExtras.push(sugarLaoMap[item.sugarLevel] || item.sugarLevel);
              if (!isShotStandard && item.shotType) translatedExtras.push(shotLaoMap[item.shotType] || item.shotType);

              return (
                <div key={i} className="flex flex-col mb-1.5 text-md leading-tight">
                  {/* Lao name (max 2 lines) + qty pinned right + price */}
                  <div className="flex justify-between font-black items-start gap-1 text-black">
                    <div className="flex-1 min-w-0">
                      <span className="line-clamp-2 break-words">{i + 1}. {laoName}</span>
                    </div>
                    <div className="flex items-start gap-1 whitespace-nowrap flex-shrink-0">
                      <span>x{item.quantity} •</span>
                      <span>{formatTHB(item.price * item.quantity)}</span>
                    </div>
                  </div>

                  {/* English name: 1 line max, truncate with ellipsis */}
                  {engName && (
                    <div className="text-[12px] text-black opacity-90 font-bold truncate overflow-hidden whitespace-nowrap mb-0.5">
                      {engName}
                    </div>
                  )}

                  {translatedExtras.length > 0 && (<div className="text-[12px] pl-0 text-black font-bold italic"> + {translatedExtras.join(", ")} </div>)}
                  {item.isTakeaway && (<div className="text-[12px] text-black pl-0 font-bold italic tracking-wider"> ກັບບ້ານ / Take-away </div>)}
                </div>
              );
            })}
          </div>

          <div className="border-t border-dashed border-slate-300 pt-2 space-y-0.5">
            {order.discount > 0 && (
              <>
                <div className="flex justify-between text-xs font-black">
                  <span>{t.gross_total}</span>
                  <span className="line-through">{formatTHB(order.subtotal || (order.total + order.discount))}</span>
                </div>
                <div className="flex justify-between text-xs text-rose-700 font-black">
                  <span>{t.discount}</span>
                  <span>-{formatTHB(order.discount)}</span>
                </div>
              </>
            )}
            {/* Removed VAT and Net Subtotal as per user request */}
            <div className="flex justify-between font-bold text-sm mt-1 pt-1 border-t border-dashed border-slate-300 text-black">
              <span>{t.grand_total}</span>
              <span>{formatTHB(order.total)}</span>
            </div>


          </div>

          {order.paymentMethod === 'CASH' && (
            <div className="mt-1 pt-1 border-t border-dashed border-slate-300 text-sm font-black text-black">
              <div className="flex justify-between">
                <span>ຮັບເງິນ / Received:</span>
                <span>{formatTHB(order.cashReceived || 0)}</span>
              </div>
              <div className="flex justify-between">
                <span>ເງິນທອນ / Change:</span>
                <span>{formatTHB(order.changeAmount || 0)}</span>
              </div>
            </div>
          )}
        </div>

        {order.customer && (
          <div className="mt-1 pt-1 border-t border-dashed border-slate-300 text-xs font-black">
            <p>Customer: {order.customer.name}</p>
            <p>Points Earned: +{Math.floor(order.total / 1000)}</p>
          </div>
        )}
        <div className="text-center mt-2 pt-1 border-t border-dashed border-slate-300 text-xs font-black">
          <p>WiFi: Pacano / PWD: PCN12022026</p>
          <p>Payment: {['CASH', 'BANK_NOTE'].includes(order.paymentMethod) ? 'Cash' : order.paymentMethod === 'ONEPAY' ? 'OnePay' : 'Transfer'}</p>
          <p className="font-black mt-1 whitespace-pre-wrap">{settings?.receiptFooter || 'THANK YOU FOR VISITING!'}</p>
        </div>

      </Card>

      {/* Action Buttons - Hidden in Print */}
      <div className="mt-8 flex gap-3 print:hidden">
        <Button variant="outline" onClick={() => window.print()}>
          <Printer className="w-4 h-4 mr-2" />
          {t.re_print}
        </Button>
        <Button className="bg-amber-600 hover:bg-amber-700" onClick={() => window.close()}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          {t.close_and_back}
        </Button>
      </div>

      <style dangerouslySetInnerHTML={{
        __html: `
        @media print {
          @page {
            margin: 0;
            size: 58mm auto; /* Fixed for 58mm thermal */
          }
          body {
            background: white !important;
            margin: 0 !important;
            padding: 0 !important;
            min-height: auto !important;
          }
          #printable-receipt {
            box-shadow: none !important;
            border: none !important;
            width: 100% !important; 
            max-width: 80mm !important; /* Increased for better fitting */
            padding: 1mm !important; 
            margin: 0 auto !important;
            position: relative !important;
            left: auto !important;
            top: auto !important;
          }
          .print-hidden, button, a {
            display: none !important;
          }
        }
      ` }} />
    </div>
  )
}

export default function ReceiptPage() {
  return (
    <Suspense fallback={<div />}>
      <ReceiptContent />
    </Suspense>
  )
}
