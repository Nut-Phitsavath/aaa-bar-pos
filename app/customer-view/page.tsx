"use client"

import { useEffect, useState } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ShoppingBag, CheckCircle, Clock, Coffee, Star, CandyOff, Droplet, Candy, Minus, Loader2 } from "lucide-react"
import { formatTHB } from "@/lib/currency"
import Image from "next/image"
import { useShift } from "@/components/shift-provider"
import { useTranslation } from "@/hooks/use-translation"
import { QRCodeSVG } from "qrcode.react"

// Document title is set via useEffect because this is a client component

type CartItem = {
    id: string
    name: string
    price: number
    quantity: number
    modifiers: string[]
    category: string
    image?: string
    sugar?: string
    shot?: string
    variation?: string
    size?: string
    localName?: string
    isTakeaway?: boolean
}

// A menu photo whose file is missing makes next/image render its alt text - the
// full product name - which blows the card apart and looks like a broken screen
// to the customer. Fall back to the same placeholder an item with no photo gets,
// so a missing file reads as deliberate. 89 of 132 menu images were absent on the
// dev machine when this was written, and the till can drift the same way whenever
// a photo is uploaded there but never committed.
function ItemPhoto({ src, alt }: { src?: string; alt: string }) {
    const [failed, setFailed] = useState(false)

    if (!src || failed) {
        return (
            <div className="w-20 h-20 shrink-0 bg-slate-50 rounded-lg flex items-center justify-center border border-slate-100 shadow-sm">
                <Coffee className="w-8 h-8 text-slate-300" />
            </div>
        )
    }

    return (
        <Image
            src={src}
            alt={alt}
            width={96}
            height={96}
            onError={() => setFailed(true)}
            className="w-20 h-20 shrink-0 object-cover rounded-lg border border-slate-100 shadow-sm"
        />
    )
}

export default function CustomerViewPage() {
    const { t } = useTranslation()
    const [cart, setCart] = useState<CartItem[]>([])
    const [total, setTotal] = useState(0)
    const [subtotal, setSubtotal] = useState(0)
    const [tax, setTax] = useState(0)
    const [discount, setDiscount] = useState(0)
    const [promoDiscount, setPromoDiscount] = useState(0)
    const [loyaltyDiscount, setLoyaltyDiscount] = useState(0)
    const [promoName, setPromoName] = useState("")
    const [isIdle, setIsIdle] = useState(true)
    const [paymentDisplayState, setPaymentDisplayState] = useState<{ type: 'NONE' | 'ONEPAY_PENDING' | 'ONEPAY_VIEW' | 'TRANSFER_VIEW', data?: any }>({ type: 'NONE' })
    const [settings, setSettings] = useState<any>(null)
    const [customer, setCustomer] = useState<any>(null)
    const [isComplimentary, setIsComplimentary] = useState(false)
    const [successInfo, setSuccessInfo] = useState<{ total: number, cashReceived: number, change: number } | null>(null)

    useEffect(() => {
        document.title = "Customer View | Memories Lane"

        const channel = new BroadcastChannel("pos_channel")

        // This screen starts blank on every load and only fills in when the POS
        // next broadcasts. Reloading mid-order - which the chunk-reload guard can
        // do on its own - would leave the customer staring at an empty order.
        // Ask the POS for the order in progress instead of waiting for a change.
        channel.postMessage({ type: "REQUEST_STATE" })

        channel.onmessage = (event) => {
            if (event.data.type === "CART_UPDATE") {
                setCart(event.data.cart)
                setTotal(event.data.total)
                setSubtotal(event.data.subtotal || 0)
                setTax(event.data.tax || 0)
                setDiscount(event.data.discount || 0)
                setPromoDiscount(event.data.promoDiscount || 0)
                setLoyaltyDiscount(event.data.loyaltyPoints || 0)
                setPromoName(event.data.promoName || "")
                setCustomer(event.data.customer || null)
                setIsComplimentary(event.data.isComplimentary || false)
                setIsIdle(event.data.cart.length === 0)
                setSuccessInfo(null) // Clear success when cart updates
            } else if (event.data.type === "PAYMENT_SUCCESS") {
                setSuccessInfo({
                    total: event.data.total,
                    cashReceived: event.data.cashReceived,
                    change: event.data.change
                })
                setIsComplimentary(event.data.isComplimentary || false)
            } else if (event.data.type === "ORDER_RESET") {
                setSuccessInfo(null)
                setCart([])
                setIsIdle(true)
                setIsComplimentary(false)
            } else if (event.data.type === "ONEPAY_PENDING") {
                setPaymentDisplayState({ type: 'ONEPAY_PENDING' })
                setIsIdle(false)
            } else if (event.data.type === "ONEPAY_GENERATED" || event.data.type === "QR_PAYMENT") {
                setPaymentDisplayState({ type: 'ONEPAY_VIEW', data: event.data.payload || event.data.data })
                setIsIdle(false)
            } else if (event.data.type === "TRANSFER_SELECTED") {
                setPaymentDisplayState({ type: 'TRANSFER_VIEW' })
                setIsIdle(false)
            } else if (event.data.type === "PAYMENT_METHOD_CHANGE") {
                if (event.data.method !== 'QR_CODE' && event.data.method !== 'ONEPAY' && event.data.method !== 'TRANSFER') {
                    setPaymentDisplayState({ type: 'NONE' })
                }
            } else if (event.data.type === "PAYMENT_COMPLETE") {
                setPaymentDisplayState({ type: 'NONE' })
            }
        }

        // Fetch settings
        fetch('/api/settings')
            .then(res => res.json())
            .then(data => setSettings(data))
            .catch(e => console.error(e))

        return () => {
            channel.close()
        }
    }, [])

    const { status: shiftStatus } = useShift()

    if (shiftStatus === 'CLOSED') {
        return (
            <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-8 text-center text-white">
                <div className="max-w-md space-y-6">
                    <div className="w-24 h-24 bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4 border border-slate-700">
                        <span className="text-4xl">🔒</span>
                    </div>
                    <h1 className="text-4xl font-bold">ຮ້ານປິດຢູ່ໃນຂະນະນີ້</h1>
                    <span className="text-lg font-bold text-slate-500 uppercase tracking-widest">Store is Currently Closed</span>
                    <p className="text-xl text-slate-400">
                        ຂະນະນີ້ພວກເຮົາຍັງບໍ່ຮັບອໍເດີ. ກະລຸນາກັບມາໃໝ່ພາຍຫຼັງ.
                    </p>
                    <p className="text-base text-slate-500">
                        We are not taking orders at the moment. Please check back later.
                    </p>
                </div>
            </div>
        )
    }

    if (successInfo) {
        return (
            <div className="h-screen bg-slate-50 flex flex-col items-center justify-center overflow-hidden animate-in fade-in duration-700">
                <div className="max-w-lg w-full px-6 relative">
                    <div className="absolute -top-16 -left-16 w-48 h-48 bg-emerald-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob"></div>
                    <div className="absolute -bottom-16 -right-16 w-48 h-48 bg-amber-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob animation-delay-2000"></div>

                    <Card className="relative overflow-hidden border-none shadow-[0_16px_48px_-12px_rgba(0,0,0,0.1)] rounded-3xl bg-white/90 backdrop-blur-xl">
                        <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-emerald-400 via-teal-500 to-emerald-500"></div>

                        <div className="p-8 flex flex-col items-center gap-5">
                            <div className="w-24 h-24 bg-emerald-50 rounded-full flex items-center justify-center relative">
                                <div className="absolute inset-0 rounded-full border-4 border-emerald-100 animate-ping opacity-20"></div>
                                <div className="absolute inset-3 rounded-full border-2 border-emerald-200 animate-pulse"></div>
                                <CheckCircle className="w-14 h-14 text-emerald-500 relative z-10" />
                            </div>

                            <div className="text-center space-y-1">
                                <h1 className="text-4xl font-black text-slate-800 tracking-tight leading-none flex flex-col items-center">
                                    <span>{isComplimentary ? "ສິນນ້ຳໃຈ!" : "ຊຳລະເງິນສຳເລັດ!"}</span>
                                    <span className="text-slate-400 text-xl font-bold mt-1">{isComplimentary ? "Complimentary!" : "Payment Confirmed!"}</span>
                                </h1>
                                <div className="text-base text-slate-400 font-medium italic flex flex-col items-center leading-tight">
                                    <span>{isComplimentary ? "ອໍເດີ້ໂດຍ Memories Lane" : "ອໍເດີ້ຂອງທ່ານກຳລັງຖືກຈັດກຽມ"}</span>
                                    <span className="text-slate-300 text-sm">{isComplimentary ? "Order by Memories Lane" : "Your order is now being prepared"}</span>
                                </div>
                            </div>

                            {isComplimentary && (
                                <div className="bg-amber-100 text-amber-900 px-4 py-2 rounded-xl font-black uppercase tracking-widest text-xs border border-amber-200">
                                    ໂໝດ ເຈົ້າຂອງ / ໝູ່ເພື່ອນ · Owner / Friends Mode
                                </div>
                            )}

                            <div className="w-full bg-slate-50/80 rounded-2xl px-6 py-4 space-y-3 border border-slate-100">
                                <div className="flex justify-between items-center">
                                    <div className="flex flex-col">
                                        <span className="text-sm font-bold uppercase tracking-widest text-slate-500">ຈຳນວນເງິນທີ່ຈ່າຍ</span>
                                        <span className="text-[10px] font-bold text-slate-300 uppercase leading-none">Amount Paid</span>
                                    </div>
                                    <span className="text-2xl font-black text-slate-700">{formatTHB(successInfo.cashReceived)}</span>
                                </div>
                                <div className="h-px bg-slate-200/50"></div>
                                <div className="flex justify-between items-center">
                                    <div className="flex flex-col">
                                        <span className="text-sm font-bold uppercase tracking-widest text-slate-500">ຍອດລວມທັງໝົດ</span>
                                        <span className="text-[10px] font-bold text-slate-300 uppercase leading-none">Billed Total</span>
                                    </div>
                                    <span className="text-xl font-bold text-slate-400">{formatTHB(successInfo.total)}</span>
                                </div>
                                <div className="bg-emerald-500 rounded-2xl px-5 py-4 text-white flex justify-between items-center shadow-md shadow-emerald-100 relative overflow-hidden">
                                    <div className="absolute top-0 right-0 p-3 opacity-10">
                                        <Coffee className="w-12 h-12 transform rotate-12" />
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-lg font-black uppercase tracking-tight">ເງິນທອນຂອງທ່ານ</span>
                                        <span className="text-xs font-bold text-emerald-200 uppercase leading-none">Your Change</span>
                                    </div>
                                    <span className="text-4xl font-black tabular-nums">{formatTHB(successInfo.change)}</span>
                                </div>
                            </div>

                            <div className="space-y-1 text-center">
                                <div className="flex items-center justify-center gap-3 text-emerald-600 font-black text-base uppercase tracking-widest">
                                    <div className="h-px w-6 bg-emerald-200"></div>
                                    <div className="flex flex-col items-center">
                                        <span className="text-base font-black uppercase tracking-widest">ຂອບໃຈທີ່ມາໃຊ້ບໍລິການ!</span>
                                        <span className="text-xs text-emerald-400/80 font-bold uppercase">Thank you!</span>
                                    </div>
                                    <div className="h-px w-6 bg-emerald-200"></div>
                                </div>
                                <div className="text-sm text-slate-400 font-medium flex flex-col items-center">
                                    <span>ກະລຸນາລໍຖ້າສັນຍານຈາກເຄື່ອງບີບເປີ</span>
                                    <span className="text-slate-300 text-xs">Please wait for your beeper call</span>
                                </div>
                            </div>
                        </div>
                    </Card>
                </div>
            </div>
        )
    }

    if (isIdle) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-50 flex flex-col items-center justify-center p-8 text-center animate-in fade-in duration-700 relative overflow-hidden">
                <div className="absolute top-0 left-0 w-96 h-96 bg-amber-200 rounded-full mix-blend-multiply filter blur-3xl opacity-20 -translate-x-1/2 -translate-y-1/2" />
                <div className="absolute bottom-0 right-0 w-96 h-96 bg-orange-200 rounded-full mix-blend-multiply filter blur-3xl opacity-20 translate-x-1/2 translate-y-1/2" />

                <div className="relative max-w-xl space-y-8 z-10">
                    <div className="w-36 h-36 bg-white/80 backdrop-blur rounded-3xl flex items-center justify-center mx-auto shadow-lg shadow-amber-200/50 border border-amber-100">
                        {settings?.shopLogo
                            ? <Image src={settings.shopLogo} alt="Logo" width={136} height={136} priority className="object-contain rounded-2xl" />
                            : <span className="text-5xl">☕</span>
                        }
                    </div>

                    <div className="space-y-2 flex flex-col items-center">
                        <div className="flex flex-col items-center">
                            <span className="text-4xl font-semibold text-amber-600 uppercase tracking-[0.2em]">ຍິນດີຕ້ອນຮັບສູ່</span>
                            <span className="text-xl font-bold text-amber-400/60 uppercase tracking-widest -mt-1">Welcome to</span>
                        </div>
                        <h1 className="text-7xl font-black text-amber-900 leading-tight">Memories Lane</h1>
                        <div className="text-2xl text-amber-700/70 font-light mt-2 flex flex-col items-center leading-tight">
                            <span>ບອກບາຣິສຕ້າຂອງພວກເຮົາໄດ້ເລີຍວ່າທ່ານຕ້ອງການເມນູໃດ</span>
                            <span className="text-amber-600/50 text-xl">Tell our barista what you'd like today</span>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 opacity-40">
                        <div className="flex-1 h-px bg-amber-400" />
                        <span className="text-amber-600 text-lg">✦</span>
                        <div className="flex-1 h-px bg-amber-400" />
                    </div>

                    <div className="grid grid-cols-3 gap-6">
                        <div className="bg-white/60 backdrop-blur rounded-2xl p-4 space-y-1 shadow-sm border border-amber-100/50 flex flex-col items-center">
                            <div className="text-5xl mb-3">🥐</div>
                            <span className="text-lg font-semibold text-amber-800 leading-none">ເຂົ້າຈີ່ສົດໃໝ່</span>
                            <span className="text-[12px] font-bold text-amber-600/50 uppercase">Pastries</span>
                        </div>
                        <div className="bg-white/60 backdrop-blur rounded-2xl p-4 space-y-1 shadow-sm border border-amber-100/50 flex flex-col items-center">
                            <div className="text-5xl mb-3">🍵</div>
                            <span className="text-lg font-semibold text-amber-800 leading-none">ເຄື່ອງດື່ມພຣີມ້ຽມ</span>
                            <span className="text-[12px] font-bold text-amber-600/50 uppercase">Premium Drinks</span>
                        </div>
                        <div className="bg-white/60 backdrop-blur rounded-2xl p-4 space-y-1 shadow-sm border border-amber-100/50 flex flex-col items-center">
                            <div className="text-5xl mb-3">🍰</div>
                            <span className="text-lg font-semibold text-amber-800 leading-none">ຂອງຫວານ</span>
                            <span className="text-[12px] font-bold text-amber-600/50 uppercase">Sweets</span>
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-slate-50 flex">
            <div className="flex-1 p-4 flex flex-col h-screen">
                <header className="mb-4 flex justify-between items-end border-b-4 border-double pb-4">
                    <div>
                        <h1 className="text-4xl font-bold text-slate-800 leading-tight">ລາຍການອໍເດີ້ຂອງທ່ານ</h1>
                        <span className="text-lg font-semibold italic text-slate-400 tracking-tight">Your Order</span>
                    </div>
                    <div className="flex flex-col items-end text-right">
                        <span className="text-lg text-slate-500 leading-tight">
                            ລວມຈຳນວນ: <span className="font-black text-amber-600 ml-1">{cart.reduce((sum, item) => sum + item.quantity, 0)}</span> ລາຍການ
                        </span>
                        <span className="text-[14px] font-medium text-slate-400 italic">Total Items</span>
                    </div>
                </header>

                <div className="flex-1 overflow-y-auto pr-2">
                    {Object.entries(
                        cart.reduce((acc: any, item) => {
                            const cat = item.category || "Other";
                            if (!acc[cat]) acc[cat] = [];
                            acc[cat].push(item);
                            return acc;
                        }, {})
                    ).map(([category, items]: [string, any]) => (
                        <div key={category} className="mb-3">
                            <h2 className="text-lg font-bold text-slate-400 uppercase tracking-wider mb-2 border-b pb-1">{category}</h2>
                            {/* Column COUNT follows the width, instead of always being 3. A card
                                needs ~300px: 96px photo + gap + room for a name. Below that the
                                text column gets so narrow that Lao - which has no spaces, so the
                                whole name is one unbreakable word - breaks one cluster per line. */}
                            <div className="grid grid-cols-[repeat(auto-fill,minmax(360px,1fr))] gap-2">
                                {items.map((item: any) => (
                                    <div key={item.id} className="p-3 border rounded-xl bg-white/80 hover:bg-white transition-all shadow-sm flex gap-3">
                                        {/* The photo anchors the card. It was a fixed 56px inside a card
                                            that is ~450px wide on this display, which left a hole down the
                                            middle - the name and price now sit beside it instead of under it. */}
                                        <ItemPhoto src={item.image} alt={item.name} />

                                        <div className="flex flex-col min-w-0 flex-1 gap-2">
                                            <div className="flex justify-between items-start gap-2">
                                                <div className="flex flex-col leading-tight min-w-0">
                                                    <h3 className="text-lg font-bold text-slate-800 break-words">{item.localName || item.name}</h3>
                                                    {item.localName && (
                                                        <span className="text-[13px] text-slate-400 font-medium mt-1 break-words">
                                                            {item.name}
                                                        </span>
                                                    )}
                                                </div>

                                                <div className="flex flex-col items-end gap-1 shrink-0">
                                                    <p className="text-[20px] font-bold text-amber-700 leading-none whitespace-nowrap">{formatTHB(item.price * item.quantity)}</p>
                                                    <Badge variant="secondary" className="bg-slate-100/50 text-slate-400 px-1.5 py-0 text-[12px] font-bold border-none shadow-none whitespace-nowrap">
                                                        x{item.quantity} @ {formatTHB(item.price)}
                                                    </Badge>
                                                </div>
                                            </div>

                                        {/* Row 4+: Variations & Customizations */}
                                        <div className="flex flex-wrap gap-1 mt-auto">
                                            {item.variation && !item.variation.toLowerCase().includes('normal') && !item.variation.toLowerCase().includes('standard') && (
                                                <Badge className="bg-amber-100 text-amber-900 border-amber-200 hover:bg-amber-100 text-[11px] font-bold uppercase px-1.5 py-0">
                                                    {item.variation}
                                                </Badge>
                                            )}
                                            {item.size && !item.size.toLowerCase().includes('normal') && !item.size.toLowerCase().includes('standard') && (
                                                <Badge variant="outline" className="bg-slate-50 text-slate-700 border-slate-200 text-[12px] font-bold px-1.5 py-0">
                                                    {item.size}
                                                </Badge>
                                            )}
                                            {item.isTakeaway && (
                                                <Badge variant="secondary" className="bg-blue-100 text-blue-800 border-blue-200 text-[12px] font-bold px-1.5 py-0 flex items-center gap-1">
                                                    <ShoppingBag className="w-3 h-3" />
                                                    {t.takeaway || "Take-away"}
                                                </Badge>
                                            )}
                                            {item.sugar && item.sugar !== '100%' && !item.sugar.toLowerCase().includes('normal') && !item.sugar.toLowerCase().includes('standard') && (
                                                <Badge variant="outline" className="text-[12px] bg-amber-50/50 text-amber-800 border-amber-100 px-1 py-0 flex items-center gap-1">
                                                    {item.sugar === "No Sweet" && <CandyOff className="w-3 h-3" />}
                                                    {item.sugar === "Less Sweet" && <Droplet className="w-3 h-3" />}
                                                    {item.sugar === "Extra Sweet" && <Candy className="w-3 h-3" />}
                                                    {(t as any)[item.sugar.toLowerCase().replace(/ /g, '_')] || item.sugar}
                                                </Badge>
                                            )}
                                            {item.shot && !item.shot.toLowerCase().includes('normal') && !item.shot.toLowerCase().includes('standard') && (
                                                <Badge variant="outline" className="text-[12px] bg-gray-50/50 text-stone-800 border-stone-100 px-1 py-0 flex items-center gap-1">
                                                    {item.shot === "Reduced Shot" && <div className="flex"><Minus className="w-3 h-3" /><Coffee className="w-3 h-3" /></div>}
                                                    {item.shot === "Double Shot" && <div className="flex"><Coffee className="w-3 h-3" /><Coffee className="w-3 h-3" /></div>}
                                                    {(t as any)[item.shot.toLowerCase().replace(/ /g, '_')] || item.shot}
                                                    {item.shot === "Double Shot" && <span className="ml-1 text-amber-600">(+10,000)</span>}
                                                </Badge>
                                            )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Was a flat w-[300px]. The cart is flex-1, so a fixed panel meant every
                pixel lost on a narrower screen came out of the menu - which is the half
                the customer actually reads. It now gives width back when space is tight
                and only takes it when there is plenty. shrink-0 keeps the total legible. */}
            <div className="w-[240px] lg:w-[280px] xl:w-[320px] shrink-0 bg-white border-l p-4 flex flex-col shadow-2xl z-10">
                {customer && (
                    <div className="mb-4 p-3 bg-amber-50 rounded-lg border border-amber-100 animate-in slide-in-from-right duration-500">
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 bg-amber-100 rounded-full flex items-center justify-center">
                                <span className="text-lg">👤</span>
                            </div>
                            <div>
                                <div className="flex flex-col">
                                    <p className="text-xs text-amber-700 font-medium leading-tight">ລູກຄ້າທີ່ເລືອກ</p>
                                    <span className="text-[9px] text-amber-600/60 uppercase font-bold leading-none mb-1">Selected Customer</span>
                                </div>
                                <p className="text-base font-bold text-amber-900 leading-tight">{customer.name}</p>
                            </div>
                        </div>
                    </div>
                )}

                <div className="flex-1 flex flex-col justify-center">
                    {paymentDisplayState.type === 'ONEPAY_PENDING' && (
                        <div className="space-y-4 animate-in fade-in zoom-in duration-500">
                            <div className="text-center">
                                <h2 className="text-xl font-bold text-slate-800 mb-1">BCEL OnePay</h2>
                                <p className="text-base font-semibold text-red-600">{formatTHB(total)}</p>
                            </div>
                            <Card className="p-8 bg-red-50/50 border-red-100 flex items-center justify-center min-h-[200px]">
                                <div className="text-center flex flex-col items-center">
                                    <img src="/bcel-one.png" alt="BCEL One" className="w-16 h-16 rounded-2xl mb-4 animate-pulse shadow-md" />
                                    <div className="flex flex-col items-center">
                                        <p className="text-sm font-bold text-red-800">ກະລຸນາລໍຖ້າພະນັກງານ...</p>
                                        <span className="text-[10px] font-bold text-red-400 uppercase">Waiting for Cashier...</span>
                                    </div>
                                    <div className="flex flex-col items-center mt-2">
                                        <p className="text-xs text-red-600/70">ກຳລັງກຽມຄິວອາໂຄດ...</p>
                                        <span className="text-[9px] font-medium text-red-400/60 italic">Preparing QR</span>
                                    </div>
                                </div>
                            </Card>
                        </div>
                    )}

                    {paymentDisplayState.type === 'ONEPAY_VIEW' && paymentDisplayState.data && (
                        <div className="space-y-4 animate-in slide-in-from-bottom-4 duration-500">
                            <div className="text-center">
                                <h2 className="text-xl font-bold text-slate-800 leading-tight">ສະແກນຈ່າຍຜ່ານ BCEL OnePay</h2>
                                <span className="text-xs font-bold text-slate-400 uppercase tracking-tight mb-1">Scan BCEL OnePay</span>
                                <p className="text-base font-semibold text-red-600">{formatTHB(paymentDisplayState.data.amount || paymentDisplayState.data.total)}</p>
                            </div>
                            <Card className="p-4 bg-slate-50 border-slate-200">
                                <div className="flex justify-center bg-white p-2 rounded-xl">
                                    <QRCodeSVG value={paymentDisplayState.data.qrData || paymentDisplayState.data.transactionId} size={200} level="H" />
                                </div>
                            </Card>
                            <div className="text-center space-y-1">
                                <p className="text-[10px] text-slate-400">Order #{paymentDisplayState.data.orderNumber}</p>
                                <div className="text-xs text-emerald-600 font-bold animate-pulse flex flex-col items-center gap-0.5 mt-1">
                                    <div className="flex items-center gap-1">
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                        <span>ກະລຸນາລໍຖ້າການຢືນຢັນ...</span>
                                    </div>
                                    <span className="text-[9px] text-emerald-500/60 uppercase ml-4">Waiting for confirmation...</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {paymentDisplayState.type === 'TRANSFER_VIEW' && (
                        <div className="space-y-4 animate-in fade-in duration-500">
                            <div className="text-center flex flex-col items-center">
                                <h2 className="text-xl font-bold text-slate-800 leading-tight">ຄິວອາໂຄດໂອນເງິນ</h2>
                                <span className="text-xs font-bold text-slate-400 uppercase tracking-tight -mt-1 mb-1">Store Transfer</span>
                                <p className="text-2xl font-semibold text-purple-600">{formatTHB(total)}</p>
                            </div>
                            <div className="text-center space-y-2 mt-2">
                                <div className="flex flex-col items-center">
                                    <p className="text-md text-purple-700 font-medium">ກະລຸນາສະແກນເພື່ອໂອນເງິນ</p>
                                    <span className="text-[12px] text-purple-400 italic">Please scan to transfer</span>
                                </div>

                            </div>
                            <Card className="p-4 bg-slate-50 border-purple-100 shadow-purple-100/50 shadow-lg">
                                <div className="flex justify-center bg-white rounded-xl p-2 w-[216px] h-[216px] mx-auto overflow-hidden">
                                    <Image src={settings?.transfer_qr_url || "/placeholder-qr.png"} alt="Store Transfer QR" width={216} height={216} className="object-contain" />
                                </div>
                            </Card>
                            <div className="text-center space-y-2 mt-2">
                                <div className="flex flex-col items-center">
                                    <p className="text-[14px] text-slate-500">ກະລຸນາສະແດງຫຼັກຖານໃຫ້ພະນັກງານ</p>
                                    <span className="text-[12px] text-slate-400 uppercase">Show slip to cashier</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {paymentDisplayState.type === 'NONE' && (
                        <div className="space-y-2">
                            {/* Show subtotal row only if there's a discount, so customer can see what was deducted */}
                            {(promoDiscount > 0 || loyaltyDiscount > 0) && (
                                // This panel is only as wide as the 216px QR above it, so a
                                // "Lao · English" label plus an amount cannot share a line.
                                // Stacking the two languages is what the Total row below
                                // already does - these rows were the odd ones out.
                                <div className="flex justify-between items-center gap-3 text-slate-500">
                                    <span className="flex flex-col min-w-0 leading-tight">
                                        <span className="text-base truncate">ລວມ</span>
                                        <span className="text-[11px] uppercase tracking-tight text-slate-400 truncate">Subtotal</span>
                                    </span>
                                    <span className="shrink-0 whitespace-nowrap text-base">{formatTHB(subtotal)}</span>
                                </div>
                            )}
                            {promoDiscount > 0 && (
                                <div className="flex justify-between items-center gap-3 text-rose-500">
                                    <span className="flex flex-col min-w-0 leading-tight">
                                        <span className="text-base truncate">{promoName || 'ໂປຣໂມຊັ່ນ'}</span>
                                        <span className="text-[11px] uppercase tracking-tight text-rose-400 truncate">Promotion</span>
                                    </span>
                                    <span className="shrink-0 whitespace-nowrap text-base">-{formatTHB(promoDiscount)}</span>
                                </div>
                            )}
                            {loyaltyDiscount > 0 && (
                                <div className="flex justify-between items-center gap-3 text-amber-500">
                                    <span className="flex flex-col min-w-0 leading-tight">
                                        <span className="text-base truncate">ໃຊ້ຄະແນນສະສົມ</span>
                                        <span className="text-[11px] uppercase tracking-tight text-amber-400 truncate">Points Redeemed</span>
                                    </span>
                                    <span className="shrink-0 whitespace-nowrap text-base">-{formatTHB(loyaltyDiscount)}</span>
                                </div>
                            )}

                            <div className="border-t pt-4 border-b pb-4">
                                <div className="flex justify-between items-center">
                                    <div className="flex flex-col">
                                        <span className="text-2xl font-bold text-slate-800 leading-none">ລວມທັງໝົດ</span>
                                        <span className="text-md font-bold text-slate-400 uppercase tracking-tighter">Total</span>
                                    </div>
                                    <span className="text-2xl font-extrabold text-amber-600">{isComplimentary ? formatTHB(0) : formatTHB(total)}</span>
                                </div>
                            </div>

                            {isComplimentary ? (
                                <div className="mt-4 p-4 bg-emerald-50 rounded-xl border border-emerald-200 text-center animate-pulse">
                                    <p className="text-sm font-bold text-emerald-800 uppercase tracking-widest mb-1">ອໍເດີສິນນ້ຳໃຈ · Complimentary Order</p>
                                    <p className="text-xl font-black text-emerald-600">ບໍ່ຕ້ອງຊຳລະເງິນ</p>
                                    <span className="text-[11px] font-bold text-emerald-500/70 uppercase">No Payment Required</span>
                                </div>
                            ) : (
                                <div className="text-right mt-2 flex flex-col items-end">
                                    <p className="text-lg text-slate-400 font-bold">ຂອບໃຈທີ່ມາໃຊ້ບໍລິການ!</p>
                                    <span className="text-[14px] text-slate-300 uppercase leading-none">Thank you!</span>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Developer Branding */}
                <div className="mt-auto py-6 flex flex-col items-center opacity-30 hover:opacity-100 transition-opacity select-none">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Powered by</span>
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-white p-1 border shadow-sm overflow-hidden flex items-center justify-center">
                            <Image src="/solution_logo.png" alt="Canisoftware" width={32} height={32} className="object-contain" />
                        </div>
                        <div className="text-sm font-black tracking-tight">
                            <span className="text-amber-600">CANI</span>
                            <span className="text-slate-900">SOFTWARE</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
