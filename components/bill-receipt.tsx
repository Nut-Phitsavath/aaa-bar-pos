"use client"

import { useEffect, useState } from "react"
import { useTranslation } from "@/hooks/use-translation"
import { formatTHB, formatLAK, formatUSD, thbToLak, thbToUsd, slipMoney } from "@/lib/currency"
import { useTillCurrency } from "@/lib/till"
import { billQrFor, billQrMode, decodeQrImage } from "@/lib/bank-qr"
import { APP_NAME } from "@/lib/shop"
import { QRCodeSVG } from "qrcode.react"
import { parseNames } from "@/lib/receipt-names"
import { tenderLabelKey, type Tender } from "@/lib/bills"

export type ReceiptLine = {
    name: string
    quantity: number
    total: number
    variation?: string | null
    size?: string | null
    sugar?: string | null
    shot?: string | null
    isTakeaway?: boolean
    note?: string | null
    /** What this package actually delivered after an exchange (req #9). */
    swapOut?: { name: string; quantity: number }[]
    swapIn?: { name: string; quantity: number }[]
}

export type ReceiptData = {
    /** What identifies this slip: an order number, or a table and reference. */
    heading: string
    headingLabel: string
    subheading?: string | null
    date: string
    staffName?: string | null
    /** Table bills only: who served, and when the table opened and closed. */
    serverNames?: string | null
    openedAt?: string | null
    closedAt?: string | null
    beeperNumber?: string | null

    lines: ReceiptLine[]

    /** Gross before any discount; omit when there is none. */
    gross?: number
    discount?: number
    tax: number
    /** The rate `tax` was worked out at. A reprint quotes the night's rate, not
     *  today's, so the percentage on the slip matches the baht beside it. */
    taxRate?: number | null
    total: number

    paymentMethod?: string | null
    cashReceived?: number | null
    /** Table bills only: settled so far, and what is still owed. */
    paid?: number
    balance?: number
    /** How it was paid, one line per method. Confirmed money only. */
    tenders?: Tender[]

    fxRateLAK?: number | null
    fxRateUSD?: number | null
    showUsd?: boolean
    /** BCEL QR for an unpaid balance, when one has been minted. */
    qrCodeData?: string | null
}

const isStandard = (v?: string | null) =>
    !v || v.toLowerCase().includes("normal") || v.toLowerCase().includes("standard") || v === "100%"

/**
 * The receipt. One design, every way it can be printed.
 *
 * This was three separate layouts: the one the POS showed after a sale, a
 * hidden component, and the /receipt page. The same sale printed differently
 * depending on when you printed it, which is the sort of thing a customer
 * notices and nobody can explain. This is the design staff already saw most -
 * the success dialog - lifted out so the reprint and the table bill match it.
 *
 * A table bill differs only in its head and its foot: table and reference
 * instead of an order number, servers, and a balance if anything is still owed.
 */
export function BillReceipt({ data, settings }: { data: ReceiptData; settings: any }) {
    const { t } = useTranslation()

    // Kip or baht, by the till this prints at - see lib/till.ts.
    const money = slipMoney(useTillCurrency(), data.fxRateLAK)
    // Settings -> "QR on bills": OnePay's, the bar's bank QR, or none - see lib/bank-qr.
    const qr = billQrFor(data, {
        mode: billQrMode(settings?.bill_qr_mode, Boolean(settings?.transfer_qr_url)),
        fallback: settings?.bill_qr_fallback !== "false",
        bankQrUrl: settings?.transfer_qr_url,
    })
    const bankQr = qr?.kind === "BANK" ? qr : null
    // What the uploaded QR picture says - see decodeQrImage. Read once per slip.
    const [bankQrPayload, setBankQrPayload] = useState<string | null>(null)
    const bankQrSrc = bankQr?.src
    useEffect(() => {
        if (!bankQrSrc) return
        let live = true
        decodeQrImage(bankQrSrc).then((payload) => { if (live) setBankQrPayload(payload) })
        return () => { live = false }
    }, [bankQrSrc])

    return (
        // Lao sets vowel marks above AND below the baseline, so the tight
        // leading that suits Latin crushes them into the line above and below.
        // Relaxed leading is what stops the slip reading as a solid block.
        <div id="printable-receipt" className="w-[80mm] mx-auto bg-white text-slate-900 px-4 py-5 text-sm leading-relaxed">
            <div className="text-center mb-4">
                {settings?.shopLogo && (
                    // Thermal heads are one-bit: a colour photo dithers into grey
                    // mush and eats paper. Forced to greyscale at high contrast so
                    // it prints as a mark rather than a smudge.
                    <div className="flex justify-center mb-1">
                        <img
                            src={settings.shopLogo}
                            alt=""
                            className="h-16 w-auto object-contain grayscale contrast-[1.6] print:h-12"
                        />
                    </div>
                )}
                <h2 className="text-lg font-black tracking-tight uppercase">
                    {settings?.shopName || APP_NAME}
                </h2>
                {settings?.shopAddress && (
                    <p className="text-[10px] opacity-70 leading-tight whitespace-pre-wrap">
                        {settings.shopAddress}
                    </p>
                )}
                {settings?.shopPhone && <p className="text-xs">Tel: {settings.shopPhone}</p>}
            </div>

            <div className="text-center border-b border-dashed border-slate-200 pb-4 mb-4">
                <p className="text-[10px] uppercase tracking-wider opacity-50">{data.headingLabel}</p>
                <p className="text-3xl font-black">{data.heading}</p>
                {data.subheading && <p className="text-[10px] opacity-70 mt-0.5">{data.subheading}</p>}
                <p className="text-[10px] opacity-50 mt-1">{data.date}</p>

                {(data.openedAt || data.closedAt) && (
                    <div className="text-[10px] opacity-70 mt-1 space-y-0.5">
                        {data.openedAt && <p>{t.opened_at}: {data.openedAt}</p>}
                        {/* Only once it has happened - a dash against "Closed" is
                            a placeholder for a fact that does not exist yet. */}
                        {data.closedAt && <p>{t.closed_at}: {data.closedAt}</p>}
                    </div>
                )}
            </div>

            {data.beeperNumber && (
                <div className="mb-4 p-2 border-2 border-dashed border-slate-800 text-center font-black text-lg">
                    {t.beeper.toUpperCase()}: {data.beeperNumber}
                </div>
            )}

            {/* Left aligned and sitting directly on the items: who handled this
                order belongs with the order, not centred in the shop's header
                where it reads as part of the address. */}
            {(data.staffName || data.serverNames) && (
                <div className="text-[11px] font-bold mb-3 space-y-1">
                    {data.staffName && <p>{t.pos_staff}: {data.staffName}</p>}
                    {data.serverNames && <p>{t.server_staff}: {data.serverNames}</p>}
                </div>
            )}

            <div className="space-y-3.5 mb-5">
                {data.lines.map((item, i) => {
                    const { lao, english } = parseNames(item.name)
                    const extras = [
                        isStandard(item.variation) ? null
                            : item.variation === "HOT" ? t.hot
                                : item.variation === "ICE" ? t.ice
                                    : item.variation === "BLEND" ? t.blend : item.variation,
                        isStandard(item.size) ? null
                            : item.size === "S" ? t.s_size
                                : item.size === "M" ? t.m_size
                                    : item.size === "L" ? t.l_size : item.size,
                    ].filter(Boolean)

                    return (
                        <div key={i} className="flex flex-col">
                            {/* gap-3, not a margin: justify-between alone lets a
                                long Lao name run straight into its own price. */}
                            <div className="flex justify-between items-start gap-3 font-black">
                                <span className="flex-1">{lao} x{item.quantity}</span>
                                <span className="whitespace-nowrap">{money.format(item.total)}</span>
                            </div>
                            {english && (
                                <div className="text-[10px] text-slate-500 font-bold leading-snug">{english}</div>
                            )}
                            {extras.length > 0 && (
                                <div className="text-[10px] opacity-70 italic">{extras.join(" - ")}</div>
                            )}
                            {!isStandard(item.sugar) && (
                                <span className="text-[10px] text-slate-400 italic font-bold">
                                    + {t.sugar}: {item.sugar === "No Sweet" ? t.no_sweet : item.sugar === "Less Sweet" ? t.less_sweet : item.sugar === "Extra Sweet" ? t.extra_sweet : item.sugar}
                                </span>
                            )}
                            {!isStandard(item.shot) && (
                                <span className="text-[10px] text-slate-400 italic font-bold">
                                    + {t.shot}: {item.shot === "Reduced Shot" ? t.reduced_shot : item.shot === "Double Shot" ? t.double_shot : item.shot}
                                </span>
                            )}
                            {item.isTakeaway && (
                                <span className="text-[10px] font-bold text-slate-400 italic uppercase tracking-wider">
                                    {t.takeaway}
                                </span>
                            )}
                            {item.note && (
                                <div className="text-[10px] font-bold text-slate-500 italic">
                                    + {item.note}
                                </div>
                            )}
                            {/* An exchanged package: the customer paid for one
                                thing and drank another, and the slip says so -
                                including when the swap cost nothing, which is
                                exactly the case they query afterwards. */}
                            {(item.swapOut?.length || item.swapIn?.length) ? (
                                <div className="text-[10px] font-bold text-slate-600 leading-snug">
                                    {item.swapOut?.length ? (
                                        <div>− {item.swapOut.map((l) => `${l.quantity} x ${l.name}`).join(", ")}</div>
                                    ) : null}
                                    {item.swapIn?.length ? (
                                        <div>+ {item.swapIn.map((l) => `${l.quantity} x ${l.name}`).join(", ")}</div>
                                    ) : null}
                                </div>
                            ) : null}
                        </div>
                    )
                })}
            </div>

            <div className="border-t border-dashed border-slate-300 pt-4 space-y-2">
                <div className="flex justify-between gap-4 opacity-70 text-[11px]">
                    <span>{t.subtotal_net}</span>
                    <span>{money.format(data.total - data.tax)}</span>
                </div>
                {(data.discount ?? 0) > 0 && (
                    <div className="flex justify-between gap-4 text-rose-600 font-bold text-[11px]">
                        <span>{t.discount}</span>
                        <span>-{money.format(data.discount!)}</span>
                    </div>
                )}
                {data.tax > 0 && (
                    <div className="flex justify-between gap-4 opacity-70 text-[11px]">
                        <span>VAT ({data.taxRate ?? settings?.taxRate ?? 0}%)</span>
                        <span>{money.format(data.tax)}</span>
                    </div>
                )}

                {/* This is the row the printed slip showed as "ລວມທັງໝົດ฿50",
                    label welded to amount, because justify-between guarantees
                    no minimum space between two items that fill the width. */}
                <div className="flex justify-between items-baseline gap-4 font-black text-xl mt-3 pt-3 border-t border-dashed border-slate-300">
                    <span>{t.total_caps}</span>
                    <span className="whitespace-nowrap">{money.format(data.total)}</span>
                </div>

                {/* Requirement #17: the other currency and the rate it was
                    struck at. On a settled bill this is the rate stored on the
                    row. A kip slip shows the baht it stands for; a baht slip
                    shows the kip. */}
                {data.fxRateLAK ? (
                    <div className="flex justify-between gap-4 opacity-70 text-[11px]">
                        <span>1 ฿ = {data.fxRateLAK.toLocaleString("en-US")} ₭</span>
                        <span>
                            {money.currency === "LAK"
                                ? formatTHB(data.total)
                                : formatLAK(thbToLak(data.total, data.fxRateLAK))}
                        </span>
                    </div>
                ) : null}
                {data.showUsd && data.fxRateUSD ? (
                    <div className="flex justify-end opacity-70 text-[11px]">
                        {formatUSD(thbToUsd(data.total, data.fxRateUSD))}
                    </div>
                ) : null}

                {/* How it was paid: one line per method, so a split bill says
                    what came in each way and a comp reads as a comp rather
                    than as a paid bill. */}
                {(data.tenders?.length ?? 0) > 0 && (
                    <div className="mt-5 pt-3 border-t border-dashed border-slate-300 space-y-2">
                        {data.tenders!.map((tender) => {
                            const key = tenderLabelKey(tender.method)
                            return (
                                <div key={tender.method} className="flex justify-between gap-4 text-[11px]">
                                    <span>{t.paid_by} · {key ? t[key] : tender.method}</span>
                                    <span>-{money.format(tender.amount)}</span>
                                </div>
                            )
                        })}
                        {/* Only when cash actually changed hands - not for a
                            comp, which is stored as CASH but was never paid. */}
                        {data.tenders!.some((tender) => tender.method === "CASH") && data.cashReceived != null && (
                            <>
                                <div className="flex justify-between gap-4 opacity-70 text-[11px]">
                                    <span>{t.cash_received}</span>
                                    <span>{money.format(data.cashReceived)}</span>
                                </div>
                                <div className="flex justify-between gap-4 font-black text-lg text-emerald-700">
                                    <span>{t.change}</span>
                                    <span>{money.format(Math.max(0, data.cashReceived - data.total))}</span>
                                </div>
                            </>
                        )}
                        {data.balance != null && (
                            <div className="flex justify-between gap-4 font-black text-lg">
                                <span>{t.balance_due}</span>
                                <span>{money.format(data.balance)}</span>
                            </div>
                        )}
                    </div>
                )}

                {qr?.kind === "ONEPAY" && (
                    <div className="text-center mt-5 pt-4 border-t border-dashed border-slate-300">
                        <p className="text-[10px] font-black">{t.scan_to_pay}</p>
                        <div className="inline-block mt-1">
                            <QRCodeSVG value={qr.payload} size={150} level="H" />
                        </div>
                        <p className="font-black mt-1">{money.format(qr.thb)}</p>
                    </div>
                )}

                {/* The bar's static LAO QR while a bill is owed - see lib/bank-qr.
                    It carries no amount, so the slip says exactly what to type,
                    in kip whichever till prints it. Large and crisp: thermal heads
                    are one-bit and a small or smoothed QR stops scanning. */}
                {bankQr && (
                    <div className="text-center mt-5 pt-4 border-t border-dashed border-slate-300">
                        <p className="text-[10px] font-black">{t.scan_with_lao_bank_app}</p>
                        {bankQrPayload ? (
                            // Redrawn from what the picture says: vector squares
                            // stay crisp through the thermal driver.
                            <QRCodeSVG
                                value={bankQrPayload}
                                size={256}
                                level="M"
                                marginSize={2}
                                className="block mx-auto mt-2"
                                style={{ width: "36mm", height: "36mm" }}
                            />
                        ) : (
                            // The picture itself, when it holds no readable QR.
                            // Full width and unfiltered: the only way a bitmap
                            // still scanned through the 58 mm driver.
                            <img src={bankQr.src} alt="" className="block mx-auto mt-2 w-[44mm] max-w-full h-auto" />
                        )}
                        <p className="text-[10px] mt-2">{t.amount_to_transfer}</p>
                        <p className="font-black text-lg leading-tight">
                            {bankQr.lak != null ? formatLAK(bankQr.lak) : formatTHB(bankQr.thb)}
                        </p>
                        {bankQr.lak != null && <p className="text-[11px] opacity-70">({formatTHB(bankQr.thb)})</p>}
                    </div>
                )}

                <div className="text-center mt-5 pt-4 border-t border-dashed border-slate-200 text-[10px] opacity-70">
                    {/* The owner's footer is the footer. Printing a built-in
                        thank-you above it thanked the customer twice whenever
                        the owner's own text said thank you, which it usually
                        does. The built-in line is only for an empty setting,
                        so the slip never just stops. */}
                    {settings?.receiptFooter?.trim() ? (
                        <p className="whitespace-pre-wrap">{settings.receiptFooter.trim()}</p>
                    ) : (
                        <p className="uppercase tracking-widest font-black">{t.thank_you}</p>
                    )}
                </div>
            </div>

            {/* Blank feed so the cutter does not crop the footer. */}
            <div aria-hidden className="h-8" />
        </div>
    )
}
