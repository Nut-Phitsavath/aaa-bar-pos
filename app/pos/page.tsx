"use client"

import { useState, useEffect, useMemo, useCallback, useRef, memo, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { SessionBanner, type BannerSession, type Waiter } from "@/components/session-banner"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  Search, Plus, Minus, CreditCard, Clock, Printer, HandCoins, CheckCircle,
  AlertCircle, Smartphone, Info, MapPin, MonitorPlay, WifiOff, RefreshCw, Smartphone as TabletIcon, PhoneIcon,
  ShoppingBag, Package, ShoppingCart, CandyOff, Droplet, Candy, Coffee,
  X, Tag, Star, User, Trash2, Pause, Check, Loader2,
  ArrowRight
} from "lucide-react"
import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { formatLAK, calculateChange, LAK_DENOMINATIONS, calculateTax, calculateInclusiveTax } from "@/lib/currency"
import { promoBlocker, promoDiscountFor, type PromoBlocker } from "@/lib/promotions"
import { PaymentQR } from "@/components/payment-qr"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import Image from "next/image"
import { useTranslation } from "@/hooks/use-translation"
import { notify } from "@/components/ui/sonner"
import { Header } from "@/components/header"
import { CustomizationDialog } from "@/app/pos/components/CustomizationDialog"
import { Receipt } from "@/components/receipt"
import { useShift } from "@/components/shift-provider"
import { Switch } from "@/components/ui/switch"

type MenuItem = {
  id: string
  name: string
  localName?: string
  category: string
  isAvailable: boolean
  image?: string
  hasSugarLevel?: boolean
  hasShotType?: boolean
  variations: Array<{
    id: string
    type: string
    sizes: Array<{
      id: string
      size: string
      price: number
    }>
  }>
}

type CartItem = {
  id: string
  variationSizeId: string
  name: string
  localName?: string
  price: number
  quantity: number
  sugar?: string
  shot?: string
  variation?: string
  size?: string
  category?: string
  image?: string
  isTakeaway?: boolean
}

type Customer = {
  id: string
  name: string
  phone?: string
}

// Memoised so a keystroke in an unrelated input -- search, cash, beeper -- does
// not re-render all ~50 menu cards and their next/image children. POSPage holds
// 28 pieces of state; without this, any one of them repaints the whole grid.
// Relies on a stable onClick (useCallback below) and a memoised filteredItems.
const MenuCard = memo(function MenuCard({ item, index, onClick }: {
  item: MenuItem
  index: number
  onClick: (item: MenuItem, e: React.MouseEvent<HTMLDivElement>) => void
}) {
  return (
    <Card
      className={`p-4 cursor-pointer hover:shadow-lg transition-shadow bg-amber-50 hover:bg-amber-100 border-amber-200 shadow-sm ${!item.isAvailable ? 'opacity-50 pointer-events-none' : ''}`}
      onClick={(e) => onClick(item, e)}
    >
      <div className="flex flex-col h-full justify-between">
        <div className="relative w-full aspect-square mb-3 rounded-md overflow-hidden bg-white shadow-inner">
          {item.image && item.image !== "/placeholder.svg" ? (
            <Image
              src={item.image}
              alt={item.name}
              fill
              className="object-cover"
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              priority={index < 8}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-slate-300">
              <Package className="w-12 h-12" />
            </div>
          )}
        </div>
        <div>
          <h3 className="font-bold text-lg leading-tight text-slate-800">{item.localName || item.name}</h3>
          <p className="text-sm text-slate-500 font-medium">{item.name}</p>
        </div>
      </div>
    </Card>
  )
})

function POSPageInner() {
  const [activeCategory, setActiveCategory] = useState("All")

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.href = '/role-select'
  }

  const [cart, setCart] = useState<CartItem[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [tableNumber, setTableNumber] = useState("")
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [categories, setCategories] = useState<string[]>(["All"])
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [isComplimentary, setIsComplimentary] = useState(false)
  const [user, setUser] = useState<any>(null)
  // Payment Dialog state
  const [isPaymentOpen, setIsPaymentOpen] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState("CASH")
  const [cashReceived, setCashReceived] = useState("")
  const [orderNumber, setOrderNumber] = useState("")
  const [appliedPromo, setAppliedPromo] = useState<any>(null)
  const [promoCodeInput, setPromoCodeInput] = useState("")
  const [isPromoOpen, setIsPromoOpen] = useState(false)
  const [promoList, setPromoList] = useState<any[] | null>(null)
  const [promoListError, setPromoListError] = useState(false)
  const [isHoldConfirmOpen, setIsHoldConfirmOpen] = useState(false)
  const [beeperNumber, setBeeperNumber] = useState("")
  const [showBeeperError, setShowBeeperError] = useState(false)
  const [focusedInput, setFocusedInput] = useState<'beeper' | 'cash'>('beeper')

  const [sysSettings, setSysSettings] = useState<any>({ taxRate: '10', loyaltyRate: '1000' })
  const [pointsRedeemed, setPointsRedeemed] = useState(0)
  const [loyaltyDiscount, setLoyaltyDiscount] = useState(0)

  // UI state for custom confirmations
  const [isNewOrderConfirmOpen, setIsNewOrderConfirmOpen] = useState(false)
  const [isSuccessOpen, setIsSuccessOpen] = useState(false)
  const [lastOrderInfo, setLastOrderInfo] = useState<any>(null)
  const [resumedOrderId, setResumedOrderId] = useState<string | null>(null)
  const [lastGeneratedSignature, setLastGeneratedSignature] = useState<string | null>(null)
  const [lastGeneratedQR, setLastGeneratedQR] = useState<string | null>(null)
  const [onepayQrSent, setOnepayQrSent] = useState(false)
  const [isInitialLoad, setIsInitialLoad] = useState(true)
  const [isHoldSuccessOpen, setIsHoldSuccessOpen] = useState(false)

  // Cancel Reason
  const [cancelReason, setCancelReason] = useState("")
  const [isCancelConfirmOpen, setIsCancelConfirmOpen] = useState(false)

  // Customization Logic
  const [customizationOpen, setCustomizationOpen] = useState(false)
  const [productToCustomize, setProductToCustomize] = useState<MenuItem | null>(null)
  const [manualPoints, setManualPoints] = useState("")

  // Declared up here rather than just above the JSX: handlers below reference
  // `t` in their dependency arrays, which are evaluated during render.
  const { t } = useTranslation()

  // --- Table session binding -------------------------------------------------
  // With no ?session= param this whole block stays inert and the screen is the
  // walk-in counter POS exactly as before.
  const router = useRouter()
  const searchParams = useSearchParams()
  const sessionIdParam = searchParams.get("session")
  const [session, setSession] = useState<BannerSession | null>(null)
  const [waiters, setWaiters] = useState<Waiter[]>([])
  const [waiterId, setWaiterId] = useState("")

  const loadSession = useCallback(async () => {
    if (!sessionIdParam) { setSession(null); return }
    try {
      const res = await fetch(`/api/table-sessions/${sessionIdParam}`)
      if (!res.ok) { router.push("/tables"); return }
      const data = await res.json()
      // Someone settled this bill on another device while we were standing here.
      if (data.status === "CLOSED") { router.push("/tables"); return }
      setSession({ id: data.id, openedAt: data.openedAt, total: data.total, table: data.table })
    } catch {
      // Keep the last known banner rather than bouncing off the table on a blip.
    }
  }, [sessionIdParam, router])

  useEffect(() => { loadSession() }, [loadSession])

  useEffect(() => {
    if (!sessionIdParam) return
    fetch("/api/waiters")
      .then((r) => r.ok ? r.json() : [])
      .then((list) => {
        const active: Waiter[] = Array.isArray(list) ? list : []
        setWaiters(active)
        // A waiter works one section all night, so remembering the pick saves a
        // tap per round. The order still records it per row, which is what the
        // shift report reads.
        const remembered = localStorage.getItem("pos_waiter")
        if (remembered && active.some((w) => w.id === remembered)) setWaiterId(remembered)
      })
      .catch(() => setWaiters([]))
  }, [sessionIdParam])

  const changeWaiter = useCallback((id: string) => {
    setWaiterId(id)
    localStorage.setItem("pos_waiter", id)
  }, [])

  // Units in the cart, not cart lines: two of the same drink counts as two.
  // Counts everything, bakery included - see the note on Promotion.minItems.
  const cartItemCount = useMemo(() => cart.reduce((n, item) => n + item.quantity, 0), [cart])

  const calculateTotal = useMemo(() => {
    // Gross subtotal: sum of all items before any reductions
    const subtotal = Math.round(cart.reduce((sum, item) => sum + item.price * item.quantity, 0))

    // Same function the server prices the order with. If a promo expires while
    // the cart is open, or the cart drops below its minimum, the discount comes
    // off the screen too instead of promising a reduction the server refuses.
    const promoDiscount = promoDiscountFor(appliedPromo, subtotal, cartItemCount)

    // Final total customer pays (after discounts, tax is inclusive). Floored at
    // zero: a fixed promo bigger than the cart makes the order free, not negative.
    const finalTotal = Math.max(0, subtotal - promoDiscount - loyaltyDiscount)
    const tax = calculateInclusiveTax(finalTotal, Number(sysSettings.taxRate) || 0)

    return { subtotal, tax, total: finalTotal, promoDiscount, loyaltyDiscount, discount: promoDiscount + loyaltyDiscount }
  }, [cart, cartItemCount, appliedPromo, loyaltyDiscount, sysSettings.taxRate])

  const { subtotal, tax, total, promoDiscount, discount } = calculateTotal

  // Kept so a customer view that reloads can ask for the order it missed.
  const lastCartBroadcast = useRef<any>(null)

  // Broadcast cart update to customer view
  useEffect(() => {
    document.title = "POS | Memories Lane"
    const payload = {
      type: "CART_UPDATE",
      cart,
      subtotal,
      tax,
      total,
      discount,
      promoDiscount,
      loyaltyPoints: loyaltyDiscount,
      promoName: appliedPromo?.name,
      customer: selectedCustomer,
      isComplimentary
    }
    lastCartBroadcast.current = payload

    const channel = new BroadcastChannel("pos_channel")
    channel.postMessage(payload)

    return () => channel.close()
  }, [cart, appliedPromo, loyaltyDiscount, total, selectedCustomer, subtotal, tax, discount, promoDiscount, isComplimentary])

  // The customer view keeps no state of its own - it only ever learns the cart
  // from a broadcast. So after it reloads it shows an empty order until the
  // cashier happens to touch something, and on a kiosk that auto-reloads on a
  // chunk error the customer watches their order vanish mid-transaction.
  // It now asks on mount, and this answers with the current order.
  useEffect(() => {
    const channel = new BroadcastChannel("pos_channel")
    channel.onmessage = (event) => {
      if (event.data?.type === "REQUEST_STATE" && lastCartBroadcast.current) {
        channel.postMessage(lastCartBroadcast.current)
      }
    }
    return () => channel.close()
  }, [])

  // Sync payment state with customer view
  useEffect(() => {
    const channel = new BroadcastChannel("pos_channel")
    channel.postMessage({ type: "PAYMENT_METHOD_CHANGE", method: paymentMethod })

    if (isPaymentOpen) {
      if (paymentMethod === 'TRANSFER') {
        channel.postMessage({ type: "TRANSFER_SELECTED" })
      } else if (paymentMethod === 'ONEPAY') {
        const currentSig = getCartSignature()
        if (lastGeneratedQR && resumedOrderId && currentSig === lastGeneratedSignature) {
          // Re-broadcast existing QR ONLY if it matches the current cart signature
          channel.postMessage({
            type: "ONEPAY_GENERATED",
            payload: {
              qrData: lastGeneratedQR,
              amount: total,
              orderNumber: orderNumber,
              items: cart
            }
          })
        } else {
          // If total changed or no QR yet, show pending on customer monitor
          channel.postMessage({ type: "ONEPAY_PENDING" })
        }
      }
    } else {
      channel.postMessage({ type: "PAYMENT_COMPLETE" })
    }
    return () => channel.close()
  }, [isPaymentOpen, paymentMethod])

  // Load persisted state
  useEffect(() => {
    const savedCart = localStorage.getItem("pos_cart")
    if (savedCart) setCart(JSON.parse(savedCart))

    const savedTable = localStorage.getItem("pos_table")
    if (savedTable) setTableNumber(savedTable)

    const savedCustomer = localStorage.getItem("pos_customer")
    if (savedCustomer) setSelectedCustomer(JSON.parse(savedCustomer))

    const savedResumedId = localStorage.getItem("pos_resumedOrderId")
    if (savedResumedId) setResumedOrderId(savedResumedId)

    fetchSettings()
    setIsInitialLoad(false)
  }, [])

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const res = await fetch('/api/auth/me')
        if (res.ok) {
          const d = await res.json()
          setUser(d.user)
        }
      } catch (e) { }
    }
    fetchUser()
  }, [])

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings')
      if (res.ok) {
        const data = await res.json()
        setSysSettings({
          ...data,
          taxRate: data.taxRate || data.tax_rate || '10',
          loyaltyRate: data.loyaltyRate || data.loyalty_rate || '1000'
        })
      }
    } catch (e) { }
  }


  // Shift Management context
  const { status: shiftStatus, checkShiftStatus } = useShift()

  useEffect(() => {
    if (isInitialLoad) return

    localStorage.setItem("pos_cart", JSON.stringify(cart))
    localStorage.setItem("pos_customer", JSON.stringify(selectedCustomer))
    localStorage.setItem("pos_table", tableNumber)
    localStorage.setItem("pos_orderNumber", orderNumber)
    localStorage.setItem("pos_orderDate", new Date().toDateString())
    localStorage.setItem("pos_beeperNumber", beeperNumber)
    if (resumedOrderId) {
      localStorage.setItem("pos_resumedOrderId", resumedOrderId)
    } else {
      localStorage.removeItem("pos_resumedOrderId")
    }
  }, [cart, selectedCustomer, tableNumber, orderNumber, resumedOrderId, isInitialLoad])

  // Sync Complimentary mode with payment
  useEffect(() => {
    if (isComplimentary) {
      setPaymentMethod('CASH')
      setCashReceived(total.toString())
      setFocusedInput('beeper')
    }
  }, [isComplimentary, total])

  // A promo that dips below its minimum stays attached and goes inert, showing
  // why, and reactivates by itself when the items come back. Deliberately NOT
  // cleared when the cart empties: the original behaviour only ever cleared a
  // promo on New Order or the Remove button, and there is no complaint to fix.
  // The clamp in promoDiscountFor already stops an empty cart going negative.

  const handleNewOrder = () => {
    setCart([])
    setSelectedCustomer(null)
    setAppliedPromo(null)
    setResumedOrderId(null)
    setTableNumber("")
    fetchNextOrderNumber()
    localStorage.removeItem("pos_cart")
    localStorage.removeItem("pos_customer")
    localStorage.removeItem("pos_table")
    localStorage.removeItem("pos_orderNumber")
    localStorage.removeItem("pos_beeperNumber")
    setBeeperNumber("")
    setShowBeeperError(false)
    setCashReceived("")
    setIsNewOrderConfirmOpen(false)
    setIsComplimentary(false)
    setLastGeneratedSignature(null)
    setLastGeneratedQR(null)
    setOnepayQrSent(false)

    // Also broadcast to customer view to reset success screen
    const channel = new BroadcastChannel("pos_channel")
    channel.postMessage({ type: "ORDER_RESET" })
    channel.close()
  }

  /**
   * Send the cart to the open table as one round.
   *
   * Not a checkout: no payment, no shift, no loyalty. The order lands as SENT,
   * its stock is deducted server-side because the drink has left the shelf, and
   * the money is only booked when the bill is settled.
   */
  const sendToTable = useCallback(async () => {
    if (!session || cart.length === 0) return
    if (!waiterId) { toast.error(t.waiter_required); return }

    setIsProcessing(true)
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.id,
          waiterId,
          status: "SENT",
          items: cart.map((i) => ({
            variationSizeId: i.variationSizeId,
            name: i.localName ? `${i.localName} (${i.name})` : i.name,
            price: i.price,
            quantity: i.quantity,
            sugarLevel: i.sugar,
            shotType: i.shot,
            variation: i.variation,
            size: i.size,
            isTakeaway: i.isTakeaway
          })),
          total,
          subtotal,
          tax,
          discount: 0
        })
      })

      if (res.ok) {
        setCart([])
        await loadSession()
        toast.success(t.order_sent)
      } else {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error || "Failed to send order")
      }
    } catch {
      toast.error("Failed to send order")
    } finally {
      setIsProcessing(false)
    }
  }, [session, cart, waiterId, total, subtotal, tax, loadSession, t])

  const handleCheckout = useCallback(async () => {
    if (!beeperNumber) {
      setShowBeeperError(true)
      return
    }
    setIsProcessing(true)
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          id: resumedOrderId,
          beeperNumber: beeperNumber || null,
          pointsRedeemed,
          taxAmount: tax,
          items: cart.map(i => ({
            variationSizeId: i.variationSizeId,
            name: i.localName ? `${i.localName} (${i.name})` : i.name, // Snapshot both names
            price: i.price,
            quantity: i.quantity,
            sugarLevel: i.sugar,
            shotType: i.shot,
            variation: i.variation,
            size: i.size,
            isTakeaway: i.isTakeaway
          })),
          total,
          subtotal,
          tax,
          discount,
          promoId: appliedPromo?.id,
          customerId: selectedCustomer?.id,
          paymentMethod,
          status: 'COMPLETED',
          isReportable: !isComplimentary,
          cashReceived: Number(cashReceived) || 0,
          changeAmount: Math.max(0, (Number(cashReceived) || 0) - total)
        }),
        headers: { 'Content-Type': 'application/json' }
      })

      if (res.ok) {
        const data = await res.json()
        const channel = new BroadcastChannel("pos_channel")
        channel.postMessage({ type: "PAYMENT_COMPLETE" })
        channel.close()

        setLastOrderInfo({
          id: data.id,
          orderNumber,
          beeperNumber,
          total,
          subtotal,
          tax,
          discount,
          cashReceived: Number(cashReceived) || 0,
          items: [...cart], // Clone cart
          customer: selectedCustomer,
          promo: appliedPromo,
          date: new Date().toLocaleString(),
          paymentMethod,
          staffName: user?.name // Add staff name here
        })
        // handleNewOrder() // Removed: Don't clear cart immediately
        setIsPaymentOpen(false)
        setIsSuccessOpen(true)

        // Broadcast SUCCESS to customer view
        const posChannel = new BroadcastChannel("pos_channel")
        // For non-cash payments, we treat billed total as received amount for the display
        // except for complimentary where it should be 0.
        const effectiveCashReceived = isComplimentary ? 0 : (paymentMethod === 'CASH' ? Number(cashReceived) : total)

        posChannel.postMessage({
          type: "PAYMENT_SUCCESS",
          total,
          cashReceived: effectiveCashReceived,
          change: isComplimentary ? 0 : Math.max(0, effectiveCashReceived - total),
          isComplimentary
        })
        posChannel.close()
      } else {
        const errorData = await res.json()
        if (errorData.code === 'STALE_ID_VIOLATION') {
          notify.error(t.order_create_failed, { description: t.order_stale_items })
          // IDs likely changed because of seeding. Clear cart to be safe or prune if we have missingIds.
          if (errorData.missingIds) {
            setCart(prev => prev.filter(i => !errorData.missingIds.includes(i.variationSizeId)))
          }
        } else if (errorData.code === 'STALE_CUSTOMER_VIOLATION') {
          notify.error(t.order_create_failed, { description: t.order_stale_customer })
          setSelectedCustomer(null)
        } else {
          notify.error(errorData.error || t.order_create_failed)
        }
      }
    } catch (e) {
      console.error(e)
      notify.error(t.order_process_error)
    } finally {
      setIsProcessing(false)
    }
  }, [beeperNumber, cart, resumedOrderId, pointsRedeemed, tax, total, subtotal, discount, appliedPromo, selectedCustomer, paymentMethod, isComplimentary, cashReceived, user, orderNumber])

  // OnePay Status Polling
  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (isPaymentOpen && paymentMethod === 'ONEPAY' && resumedOrderId && !isProcessing) {
      console.log("Starting OnePay status polling...");
      interval = setInterval(async () => {
        try {
          const res = await fetch(`/api/payments/onepay/status/${resumedOrderId}`);
          if (res.ok) {
            const data = await res.json();
            if (data.status === 'PAID') {
              console.log("Payment detected via polling!");
              clearInterval(interval);
              // Trigger checkout process automatically
              handleCheckout();
            }
          }
        } catch (error) {
          console.error("Polling error:", error);
        }
      }, 3000); // 3 seconds
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isPaymentOpen, paymentMethod, resumedOrderId, isProcessing, handleCheckout, beeperNumber]);

  // Customer Search Dialog
  const [isCustomerSearchOpen, setIsCustomerSearchOpen] = useState(false)
  const [customerQuery, setCustomerQuery] = useState("")
  const [customerResults, setCustomerResults] = useState<Customer[]>([])

  useEffect(() => {
    fetchMenuItems()
  }, [])

  const fetchMenuItems = async () => {
    try {
      const res = await fetch('/api/menu?availableOnly=true')
      if (res.ok) {
        const data = await res.json()
        // Data already in correct hierarchical format from API
        setMenuItems(data)

        // Extract unique categories
        const uniqueCategories = Array.from(new Set(data.map((i: any) => i.category))) as string[]
        setCategories(["All", ...uniqueCategories])

        // Silent Validation: Remove cart items that no longer exist in the menu
        const allVariationSizeIds = new Set(
          data.flatMap((m: any) => m.variations.flatMap((v: any) => v.sizes.map((s: any) => s.id)))
        )
        setCart((prev) => {
          const valid = prev.filter(item => allVariationSizeIds.has(item.variationSizeId))
          if (valid.length !== prev.length) {
            console.warn("Pruned invalid/stale items from cart after seeding/update.")
          }
          return valid
        })

        // Validate Selected Customer
        const savedCustomer = localStorage.getItem("pos_customer")
        if (savedCustomer) {
          const cust = JSON.parse(savedCustomer)
          try {
            const checkRes = await fetch(`/api/customers?q=${cust.id}`)
            if (checkRes.ok) {
              const results = await checkRes.json()
              const found = results.find((c: any) => c.id === cust.id)
              if (!found) {
                console.warn("Selected customer no longer exists. Clearing.")
                setSelectedCustomer(null)
              }
            }
          } catch (e) { }
        }
      }
    } catch (e) { console.error(e) }
  }

  // Search Customers
  useEffect(() => {
    if (!isCustomerSearchOpen) return
    const fetchCustomers = async () => {
      try {
        const url = customerQuery.length >= 2
          ? `/api/customers?q=${customerQuery}`
          : '/api/customers'
        const res = await fetch(url)
        if (res.ok) setCustomerResults(await res.json())
      } catch (e) { }
    }

    const handler = setTimeout(fetchCustomers, 300)
    return () => clearTimeout(handler)
  }, [customerQuery, isCustomerSearchOpen])

  // Handle Resume Order and Fetch Next Number
  const [isResumeWarningOpen, setIsResumeWarningOpen] = useState(false)
  const [pendingResumeId, setPendingResumeId] = useState<string | null>(null)

  const handleResumeOrder = async (resumeId: string) => {
    if (cart.length > 0) {
      setPendingResumeId(resumeId)
      setIsResumeWarningOpen(true)
      return
    }
    await performResume(resumeId)
  }

  const performResume = async (resumeId: string) => {
    try {
      const res = await fetch('/api/orders')
      if (res.ok) {
        const all = await res.json()
        const found = all.find((o: any) => o.id === resumeId)
        if (found) {
          setCart(found.items.map((i: any) => {
            const compositeId = `${i.variationSizeId}-${i.sugarLevel || ''}-${i.shotType || ''}-${i.variation || ''}-${i.isTakeaway || false}`
            return {
              id: compositeId,
              variationSizeId: i.variationSizeId,
              name: i.name,
              price: i.price,
              quantity: i.quantity,
              sugar: i.sugarLevel,
              shot: i.shotType,
              variation: i.variation,
              size: i.size,
              isTakeaway: i.isTakeaway
            }
          }))
          setOrderNumber(found.orderNumber)
          setResumedOrderId(found.id)
          setBeeperNumber(found.beeperNumber || "")
          if (found.paymentMethod) setPaymentMethod(found.paymentMethod)

          if (found.customerId) {
            const cRes = await fetch(`/api/customers?q=${found.customerId}`)
            if (cRes.ok) {
              const customers = await cRes.json()
              const c = customers.find((cust: any) => cust.id === found.customerId)
              if (c) setSelectedCustomer(c)
            }
          }
          window.history.replaceState({}, document.title, "/pos")
        }
      }
    } catch (e) { console.error(e) }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const resumeId = params.get('resumeOrder')

    // Auto-Hold existing session if switching (this logic remains in the useEffect for initial load)
    const existingCartStr = localStorage.getItem("pos_cart")
    const existingCart = existingCartStr ? JSON.parse(existingCartStr) : []
    const existingResumedId = localStorage.getItem("pos_resumedOrderId")

    if (resumeId && existingCart.length > 0 && existingResumedId !== resumeId) {
      // Auto-save the current session as HOLD before loading the next one
      const autoHold = async () => {
        try {
          const existingCust = JSON.parse(localStorage.getItem("pos_customer") || "null")
          const existingTable = localStorage.getItem("pos_table") || ""
          const existingOrderNum = localStorage.getItem("pos_orderNumber")

          const subtotal = Math.round(existingCart.reduce((sum: number, item: any) => sum + item.price * item.quantity, 0))
          const total = subtotal
          const tax = calculateInclusiveTax(total, Number(sysSettings.taxRate) || 0)

          await fetch('/api/orders', {
            method: 'POST',
            body: JSON.stringify({
              id: existingResumedId,
              items: existingCart.map((i: any) => ({
                variationSizeId: i.variationSizeId,
                name: i.name,
                price: i.price,
                quantity: i.quantity,
                sugarLevel: i.sugar,
                shotType: i.shot,
                variation: i.variation,
                size: i.size,
                isTakeaway: i.isTakeaway
              })),
              total, subtotal, tax,
              paymentMethod,
              customerId: existingCust?.id,
              status: 'HOLD'
            }),
            headers: { 'Content-Type': 'application/json' }
          })
        } catch (e) { console.error("Auto-hold failed", e) }
      }
      autoHold()
    }

    if (resumeId) {
      performResume(resumeId)
    } else {
      fetchNextOrderNumber()
    }

    setIsInitialLoad(false)
  }, [])

  const fetchNextOrderNumber = async () => {
    try {
      const res = await fetch('/api/orders?next-number=true')
      if (res.ok) {
        const { orderNumber: nextNum } = await res.json()
        setOrderNumber(nextNum)
      }
    } catch (e) { console.error(e) }
  }

  // Why a promo can't be used, short enough to sit on a list row.
  const promoBlockerLabel = (blocker: PromoBlocker, promo: any) => {
    if (blocker === 'min_items') {
      return (t.promo_needs_items || "Needs {n} items · cart has {c}")
        .replace('{n}', String(promo.minItems))
        .replace('{c}', String(cartItemCount))
    }
    if (blocker === 'inactive') return t.inactive
    return t.promo_expired_label || "Expired"
  }

  // Fetched every time the dialog opens, never cached between opens. The till
  // runs all day without a reload, so a list loaded at 7am would still be
  // showing 7am's promos at closing time.
  const openPromoDialog = async () => {
    setIsPromoOpen(true)
    setPromoList(null)
    setPromoListError(false)
    try {
      const res = await fetch('/api/promotions')
      if (!res.ok) throw new Error(String(res.status))
      setPromoList(await res.json())
    } catch (e) {
      setPromoListError(true)
      setPromoList([])
    }
  }

  const applyPromo = (promo: any) => {
    setAppliedPromo(promo)
    setIsPromoOpen(false)
    setPromoCodeInput("")
  }

  const applyPromoCode = async () => {
    const code = promoCodeInput.trim().toUpperCase()
    if (!code) return
    try {
      // Coupon codes are deliberately absent from the list, so fall back to a
      // fresh fetch if the dialog's own load failed.
      let all = promoList
      if (!all || all.length === 0) {
        const res = await fetch('/api/promotions')
        all = res.ok ? await res.json() : []
      }
      const found = (all || []).find((p: any) => p.code.toUpperCase() === code)
      if (!found) { notify.warn(t.promo_invalid); return }
      const blocker = promoBlocker(found, cartItemCount)
      if (blocker) { notify.warn(promoBlockerLabel(blocker, found)); return }
      applyPromo(found)
    } catch (e) { notify.error(t.promo_apply_error) }
  }

  // Replaced by manual function below
  // const handleRedeemPoints = () => { ... }

  const handleManualRedeem = () => {
    if (!selectedCustomer) return
    const points = parseInt(manualPoints)
    if (isNaN(points) || points <= 0) { notify.warn(t.invalid_points); return }

    // Check max available
    const available = (selectedCustomer as any).loyaltyPoints || 0
    if (points > available) { notify.warn(t.not_enough_points.replace('{n}', String(available))); return }

    const rate = Number(sysSettings.loyaltyRate ?? sysSettings.loyalty_rate) || 1000
    const discountAmount = points * rate

    // Check against total
    const maxDiscount = subtotal - promoDiscount
    if (maxDiscount <= 0) {
      notify.warn(t.total_already_zero)
      return
    }
    if (discountAmount > maxDiscount) {
      notify.warn(t.discount_exceeds_total.replace('{n}', String(Math.floor(maxDiscount / rate))))
      return
    }

    setPointsRedeemed(points)
    setLoyaltyDiscount(discountAmount)
    setManualPoints("")
  }

  const handleNewOrderClick = () => {
    if (cart.length > 0) {
      setIsNewOrderConfirmOpen(true)
    } else {
      handleNewOrder()
    }
  }

  const triggerFlyingAnimation = (event: React.MouseEvent<HTMLDivElement>, imageUrl: string) => {
    const card = event.currentTarget
    const rect = card.getBoundingClientRect()

    // Find cart icon element by ID or fallback to right side panel approximation
    const cartIcon = document.getElementById('cart-icon-header')
    let targetX = window.innerWidth - 100
    let targetY = 100

    if (cartIcon) {
      const cartRect = cartIcon.getBoundingClientRect()
      targetX = cartRect.left
      targetY = cartRect.top
    }

    const flyingImg = document.createElement('img')
    flyingImg.src = imageUrl
    flyingImg.className = 'fixed z-[9999] rounded-md shadow-2xl object-cover pointer-events-none transition-all duration-700 ease-in-out'
    flyingImg.style.width = `${rect.width * 0.5}px`
    flyingImg.style.height = `${rect.height * 0.5}px`
    flyingImg.style.top = `${rect.top + rect.height * 0.25}px`
    flyingImg.style.left = `${rect.left + rect.width * 0.25}px`
    document.body.appendChild(flyingImg)

    // Trigger animation next frame
    requestAnimationFrame(() => {
      flyingImg.style.top = `${targetY}px`
      flyingImg.style.left = `${targetX}px`
      flyingImg.style.width = '20px'
      flyingImg.style.height = '20px'
      flyingImg.style.opacity = '0.2'
      flyingImg.style.transform = 'scale(0.1) rotate(180deg)'
    })

    setTimeout(() => {
      flyingImg.remove()
      if (cartIcon) {
        cartIcon.classList.add('scale-125', 'text-amber-500')
        setTimeout(() => cartIcon.classList.remove('scale-125', 'text-amber-500'), 200)
      }
    }, 700)
  }

  const handleClickProduct = useCallback((item: MenuItem, event: React.MouseEvent<HTMLDivElement>) => {
    setProductToCustomize(item)
    setCustomizationOpen(true)
  }, [])

  const handleAddToCartWithCustomization = (selection: {
    variationSizeId: string
    name: string
    localName?: string
    price: number
    sugar: string
    shot: string
    variation: string
    size: string
    isTakeaway: boolean
  }) => {
    const finalPrice = selection.price

    setCart((prev) => {
      // Unique ID based on variationSizeId + customizations
      const uniqueId = `${selection.variationSizeId}-${selection.sugar}-${selection.shot}-${selection.variation}-${selection.isTakeaway}`

      // Check existing similar item
      const existing = prev.find((item) => item.id === uniqueId)

      if (existing) {
        return prev.map((item) =>
          item.id === uniqueId ? { ...item, quantity: item.quantity + 1 } : item
        )
      }

      return [...prev, {
        id: uniqueId,
        variationSizeId: selection.variationSizeId,
        name: selection.name,
        localName: selection.localName,
        price: finalPrice,
        quantity: 1,
        sugar: selection.sugar,
        shot: selection.shot,
        variation: selection.variation,
        size: selection.size,
        category: productToCustomize?.category || "Other",
        image: productToCustomize?.image,
        isTakeaway: selection.isTakeaway
      }]
    })
    setProductToCustomize(null)
  }

  const getCartSignature = () => {
    return JSON.stringify({
      items: cart.map(i => ({ id: i.variationSizeId, qty: i.quantity, sugar: i.sugar, shot: i.shot, takeaway: i.isTakeaway })),
      total,
      promoId: appliedPromo?.id,
      customerId: selectedCustomer?.id,
      isComplimentary
    })
  }

  const handleInitiateOnepay = async () => {
    const currentSignature = getCartSignature()

    // If QR already generated for this EXACT configuration, just re-confirm 
    if (onepayQrSent && lastGeneratedSignature === currentSignature && lastGeneratedQR) {
      const channel = new BroadcastChannel("pos_channel");
      channel.postMessage({
        type: "ONEPAY_GENERATED",
        payload: {
          qrData: lastGeneratedQR,
          amount: total,
          orderNumber: orderNumber,
          items: cart
        }
      });
      channel.close();
      return
    }

    setIsProcessing(true)
    try {
      // 1. Save/Hold the order first
      const res = await fetch('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          id: resumedOrderId,
          items: cart.map(i => ({
            variationSizeId: i.variationSizeId,
            name: i.name,
            price: i.price,
            quantity: i.quantity,
            sugarLevel: i.sugar,
            shotType: i.shot,
            variation: i.variation,
            size: i.size
          })),
          total, subtotal, tax, discount,
          promoId: appliedPromo?.id,
          customerId: selectedCustomer?.id,
          paymentMethod: 'ONEPAY',
          status: 'HOLD',
          beeperNumber: beeperNumber || null,
          pointsRedeemed, taxAmount: tax
        }),
        headers: { 'Content-Type': 'application/json' }
      })

      if (res.ok) {
        const orderData = await res.json()
        setResumedOrderId(orderData.id)
        setOrderNumber(orderData.orderNumber)
        setPaymentMethod('ONEPAY')

        // 2. Generate/Fetch the real BCEL QR code
        console.log("Requesting OnePay QR for order:", orderData.id);
        const genRes = await fetch('/api/payments/onepay/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId: orderData.id })
        });

        if (genRes.ok) {
          const genData = await genRes.json();
          const qrCode = genData.qrCode;

          // 3. Broadcast to Customer View immediately
          const channel = new BroadcastChannel("pos_channel");
          channel.postMessage({
            type: "ONEPAY_GENERATED",
            payload: {
              qrData: qrCode,
              amount: total,
              orderNumber: orderData.orderNumber,
              items: cart
            }
          });
          channel.close();
          const currentSignature = getCartSignature();
          setLastGeneratedSignature(currentSignature);
          setLastGeneratedQR(qrCode);
          setOnepayQrSent(true);
          console.log("QR Code broadcasted to customer view.");
        } else {
          const err = await genRes.json().catch(() => ({}));
          // NO_INTERNET = this till is offline, staff can go fix the router.
          // BANK_API = we reached the network but OnePay is down; take cash.
          notify.error(err.source === 'NO_INTERNET' ? t.no_internet
            : err.source === 'BANK_API' ? t.bank_service_down
              : (err.error || t.qr_generate_failed));
        }
      } else {
        const err = await res.json().catch(() => ({}))
        notify.error(err.error || t.onepay_initiate_failed)
      }
    } catch (e) {
      console.error(e)
      notify.error(t.connection_error)
    } finally {
      setIsProcessing(false)
    }
  }

  const updateQuantity = (id: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) => (item.id === id ? { ...item, quantity: Math.max(0, item.quantity + delta) } : item))
        .filter((item) => item.quantity > 0),
    )
  }

  const removeItem = (id: string) => {
    setCart((prev) => prev.filter((item) => item.id !== id))
  }

  const handleHoldOrder = async () => {
    setIsProcessing(true)
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          id: resumedOrderId,
          items: cart.map(i => ({
            variationSizeId: i.variationSizeId,
            name: i.localName ? `${i.localName} (${i.name})` : i.name,
            price: i.price,
            quantity: i.quantity,
            sugarLevel: i.sugar,
            shotType: i.shot,
            variation: i.variation,
            size: i.size,
            isTakeaway: i.isTakeaway
          })),
          total,
          subtotal,
          tax,
          discount,
          promoId: appliedPromo?.id,
          customerId: selectedCustomer?.id,
          paymentMethod: 'CASH',
          status: 'HOLD',
          beeperNumber: beeperNumber || null,
          pointsRedeemed,
          taxAmount: tax
        }),
        headers: { 'Content-Type': 'application/json' }
      })

      if (res.ok) {
        // Ensure everything is cleared even if state updates are batched
        handleNewOrder()
        setResumedOrderId(null)
        setCart([])
        setIsHoldSuccessOpen(true)
      } else {
        const err = await res.json()
        notify.error(err.error || t.hold_order_failed)
      }
    } catch (e) {
      console.error(e)
      notify.error(t.hold_order_error)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleCancelOrderClick = () => {
    handleNewOrder()
    setPointsRedeemed(0)
    setLoyaltyDiscount(0)
    // We intentionally do not call an API here to cancel the order in the DB, 
    // we just clear the current UI state so the user can start fresh.
  }

  const handleCancelOrderConfirm = async () => {
    if (!cancelReason) { notify.warn(t.reason_required); return }

    setIsProcessing(true)
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          id: resumedOrderId,
          items: cart.map(i => ({
            id: i.id,
            variationSizeId: i.variationSizeId,
            name: i.name,
            price: i.price,
            quantity: i.quantity
          })),
          total, subtotal, tax, discount,
          promoId: appliedPromo?.id,
          customerId: selectedCustomer?.id,
          paymentMethod: paymentMethod,
          status: 'CANCELLED',
          cancellationReason: cancelReason
        }),
        headers: { 'Content-Type': 'application/json' }
      })
      if (res.ok) {
        handleNewOrder()
        setCancelReason("")
        setIsCancelConfirmOpen(false)
      }
    } catch (e) { console.error(e) }
    finally {
      setIsProcessing(false)
      setPointsRedeemed(0)
      setLoyaltyDiscount(0)
    }
  }

  const filteredItems = useMemo(() => {
    const q = searchQuery.toLowerCase()
    return menuItems.filter(
      (item) => (activeCategory === "All" || item.category === activeCategory) &&
        (item.name.toLowerCase().includes(q) ||
          (item.localName && item.localName.toLowerCase().includes(q)))
    )
  }, [menuItems, activeCategory, searchQuery])

  return (
    <div className="h-screen flex flex-col bg-slate-50 text-slate-900 overflow-hidden">
      {session && (
        <SessionBanner
          session={session}
          waiters={waiters}
          waiterId={waiterId}
          onWaiterChange={changeWaiter}
        />
      )}
      <div className="flex-1 flex min-h-0">
      {/* Left Side - Menu & Header */}
      <div className="flex-1 flex flex-col min-w-0 bg-background border-r">
        <Header title={t.pos}>
          <Badge variant="secondary" className="px-3 py-1 text-lg font-mono bg-amber-50 text-amber-900 border-amber-200">
            {orderNumber ? `Order No. ${orderNumber.replace('No. ', '')}` : "Order No. --"}
          </Badge>
        </Header>

        {/* Search */}
        <div className="p-4 border-b bg-white">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              placeholder={t.search_menu}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {/* Categories */}
        <div className="p-4 border-b bg-white">
          <div className="flex flex-wrap gap-2">
            {categories.map((category) => (
              <Button
                key={category}
                variant={activeCategory === category ? "default" : "outline"}
                onClick={() => setActiveCategory(category)}
                className={activeCategory === category ? "bg-amber-600 hover:bg-amber-700 text-lg h-11" : "text-lg h-11"}
              >
                {category}
              </Button>
            ))}
          </div>
        </div>

        {/* Menu Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredItems.map((item, index) => (
              <MenuCard key={item.id} item={item} index={index} onClick={handleClickProduct} />
            ))}
          </div>
        </div>

      </div>

      {/* Right Side - Cart */}
      <div className="w-[450px] flex flex-col bg-white shadow-2xl z-10 border-l">
        <div className="p-4 border-b bg-slate-50 flex items-center justify-between">
          <h3 className="font-bold text-slate-800 flex items-center gap-2" id="cart-icon-header">
            <ShoppingCart className="w-5 h-5 transition-all duration-200" /> {t.cart}
          </h3>
          <Badge variant="secondary" className="bg-amber-100 text-amber-900 font-black px-2">{cart.reduce((sum, i) => sum + i.quantity, 0)}</Badge>
        </div>
        {/* Table Number */}
        {/* <div className="p-4 border-b">
            <label className="block text-sm font-medium mb-2">Table Number</label>
            <Input
              placeholder="Enter table number"
              value={tableNumber}
              onChange={(e) => setTableNumber(e.target.value)}
            />
          </div> */}

        {/* Cart Items */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
              <Clock className="w-12 h-12 mb-2" />
              <p>{t.no_items_found}{t.in}{t.cart}</p>
            </div>
          ) : (
            <div className="space-y-1">
              {cart.map((item) => (
                <Card key={item.id} className="px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    {/* Name + badges */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-1 flex-wrap">
                        <h4 className="text-sm font-bold text-slate-800 leading-tight truncate">
                          {item.localName || item.name}
                        </h4>
                        {item.localName && <span className="text-[10px] text-slate-400 truncate">({item.name})</span>}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {item.variation && !item.variation.toLowerCase().includes('normal') && !item.variation.toLowerCase().includes('standard') && (
                          <span className="text-[10px] bg-amber-50 px-1.5 py-0.5 rounded-full text-amber-700 border border-amber-100 font-bold uppercase">
                            {item.variation === 'HOT' ? t.hot : item.variation === 'ICE' ? t.ice : item.variation === 'BLEND' ? t.blend : item.variation}
                          </span>
                        )}
                        {item.size && !item.size.toLowerCase().includes('normal') && !item.size.toLowerCase().includes('standard') && (
                          <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded-full text-slate-600 border border-slate-200 font-bold">
                            {item.size === 'S' ? t.s_size : item.size === 'M' ? t.m_size : item.size === 'L' ? t.l_size : item.size}
                          </span>
                        )}
                        {item.sugar && item.sugar !== '100%' && !item.sugar.toLowerCase().includes('normal') && !item.sugar.toLowerCase().includes('standard') && (
                          <span className="flex items-center gap-0.5 text-[10px] bg-slate-50 px-1.5 py-0.5 rounded text-slate-500 border border-slate-100">
                            {item.sugar === "No Sweet" && <CandyOff className="w-3 h-3" />}
                            {item.sugar === "Less Sweet" && <Droplet className="w-3 h-3" />}
                            {item.sugar === "Extra Sweet" && <Candy className="w-3 h-3" />}
                            {item.sugar === "No Sweet" ? t.no_sweet : item.sugar === "Less Sweet" ? t.less_sweet : item.sugar === "Extra Sweet" ? t.extra_sweet : item.sugar}
                          </span>
                        )}
                        {item.shot && !item.shot.toLowerCase().includes('normal') && !item.shot.toLowerCase().includes('standard') && (
                          <span className="flex items-center gap-0.5 text-[10px] bg-slate-50 px-1.5 py-0.5 rounded text-slate-500 border border-slate-100">
                            {item.shot === "Reduced Shot" && <span className="flex"><Minus className="w-3 h-3" /><Coffee className="w-3 h-3" /></span>}
                            {item.shot === "Double Shot" && <span className="flex"><Coffee className="w-3 h-3" /><Coffee className="w-3 h-3" /></span>}
                            {item.shot === "Reduced Shot" ? t.reduced_shot : item.shot === "Double Shot" ? t.double_shot : item.shot}
                          </span>
                        )}
                        {item.isTakeaway && (
                          <span className="flex items-center gap-1 text-[10px] bg-blue-50 px-1.5 py-0.5 rounded text-blue-700 border border-blue-100 font-bold">
                            <ShoppingBag className="w-3 h-3" /> {t.takeaway}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Qty controls + price */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <Button variant="outline" size="icon" className="h-6 w-6" onClick={() => updateQuantity(item.id, -1)}>
                        <Minus className="w-3 h-3" />
                      </Button>
                      <span className="w-5 text-center text-sm font-bold">{item.quantity}</span>
                      <Button variant="outline" size="icon" className="h-6 w-6" onClick={() => updateQuantity(item.id, 1)}>
                        <Plus className="w-3 h-3" />
                      </Button>
                      <span className="text-sm font-bold text-amber-700 w-20 text-right">{formatLAK(item.price * item.quantity)}</span>
                      <Button variant="ghost" size="icon" className="h-11 w-11 text-red-400 hover:text-red-600 hover:bg-red-50 ml-1" onClick={() => removeItem(item.id)}>
                        <X className="w-6 h-6" />
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Totals */}
        <div className="px-6 py-2 border-t bg-slate-50/50 space-y-2 shadow-[0_-4px_10px_rgba(0,0,0,0.03)]">
          {selectedCustomer && (
            <div className="flex justify-between text-sm text-amber-600 font-medium">
              <span>{t.loyalty_points_earning}</span>
              <span>+{Math.floor(total / 1000)} {t.pts}</span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{t.subtotal}</span>
            <span className="font-semibold">{formatLAK(subtotal)}</span>
          </div>
          {appliedPromo && (() => {
            // Inert promo: show why, not "-0" beside a name that looks applied.
            const blocker = promoBlocker(appliedPromo, cartItemCount)
            return (
              <div className={`flex justify-between text-sm font-medium ${blocker ? 'text-amber-700' : 'text-rose-600'}`}>
                <span className="flex items-center gap-1 min-w-0">
                  <Tag className="w-3 h-3 shrink-0" /> <span className="truncate">{appliedPromo.name}</span>
                </span>
                <span className="shrink-0">{blocker ? promoBlockerLabel(blocker, appliedPromo) : `-${formatLAK(promoDiscount)}`}</span>
              </div>
            )
          })()}
          {loyaltyDiscount > 0 && (
            <div className="flex justify-between text-sm text-amber-600 font-medium">
              <span className="flex items-center gap-1">
                <Star className="w-3 h-3" /> {t.loyalty_points_redeemed || "Points Redeemed"}
              </span>
              <span>-{formatLAK(loyaltyDiscount)}</span>
            </div>
          )}

          <div className="flex justify-between text-sm font-bold pt-2 border-t">
            <span>{t.total}</span>
            <span className="text-amber-600">{formatLAK(total)}</span>
          </div>
        </div>

        {/* Resume Warning Dialog */}
        <AlertDialog open={isResumeWarningOpen} onOpenChange={setIsResumeWarningOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t.active_orders_warning_title}</AlertDialogTitle>
              <AlertDialogDescription>
                {t.active_orders_warning_desc}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => {
                setPendingResumeId(null)
                setIsResumeWarningOpen(false)
              }}>
                {t.cancel}
              </AlertDialogCancel>
              <AlertDialogAction onClick={async () => {
                if (pendingResumeId) {
                  // Auto-hold current first
                  const subtotal = Math.round(cart.reduce((sum, item) => sum + item.price * item.quantity, 0))
                  const total = subtotal
                  const tax = calculateInclusiveTax(total, Number(sysSettings.taxRate) || 0)

                  await fetch('/api/orders', {
                    method: 'POST',
                    body: JSON.stringify({
                      id: resumedOrderId,
                      items: cart,
                      total, subtotal, tax,
                      customerId: selectedCustomer?.id,
                      status: 'HOLD'
                    }),
                    headers: { 'Content-Type': 'application/json' }
                  })

                  await performResume(pendingResumeId)
                  setPendingResumeId(null)
                  setIsResumeWarningOpen(false)
                }
              }}>
                {t.continue_as || "Continue"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Dialog open={isSuccessOpen} onOpenChange={setIsSuccessOpen}>
          <DialogContent
            className="max-w-[450px] h-[90vh] flex flex-col p-0 !transform-none data-[state=open]:animate-none overflow-hidden"
            size="sm"
            showCloseButton={false}
            onInteractOutside={(e) => e.preventDefault()}
            onEscapeKeyDown={(e) => e.preventDefault()}
          >
            {/* Header / Icon */}
            <div className="text-center pt-6 pb-2 px-6">
              <div className="flex justify-center mb-2">
                <CheckCircle className="w-12 h-12 text-green-600" strokeWidth={2.5} />
              </div>
              <DialogTitle className="text-2xl font-bold">{t.payment_successful}</DialogTitle>
              <p className="text-muted-foreground text-sm">{t.order_completed_successfully}</p>
            </div>

            {/* Scrollable Receipt Area */}
            <div className="flex-1 overflow-y-auto px-6 py-2">
              {lastOrderInfo && (
                <div className="bg-white border-2 border-slate-100 rounded-xl p-4 shadow-sm font-mono text-[13px] leading-tight text-slate-900">
                  {/* Shop Info / Logo */}
                  <div className="text-center space-y-1 mb-4 border-b border-dashed border-slate-200 pb-4">
                    <div className="flex justify-center mb-2">
                      <img src={sysSettings?.shopLogo || "/placeholder-logo.png"} alt="Logo" className="h-16 w-auto object-contain" />
                    </div>
                    <h2 className="text-lg font-black tracking-tight uppercase">{sysSettings?.shopName || 'Memories Lane'}</h2>
                    {sysSettings?.shopAddress && <p className="text-[10px] opacity-70 leading-tight whitespace-pre-wrap">{sysSettings.shopAddress}</p>}
                    {sysSettings?.shopPhone && <p className="text-xs">Tel: {sysSettings.shopPhone}</p>}
                    {lastOrderInfo?.staffName && <p className="text-[10px] font-bold mt-1">{t.staff}: {lastOrderInfo.staffName}</p>}
                  </div>

                  {/* Order Context */}
                  <div className="text-center border-b border-dashed border-slate-200 pb-3 mb-3">
                    <p className="text-[10px] uppercase tracking-wider opacity-50">{t.order_no}</p>
                    <p className="text-3xl font-black">{lastOrderInfo.orderNumber}</p>
                    <p className="text-[10px] opacity-50 mt-1">{lastOrderInfo.date}</p>
                  </div>

                  {/* Beeper */}
                  {lastOrderInfo.beeperNumber && (
                    <div className="mb-4 p-2 border-2 border-dashed border-slate-800 text-center font-black text-lg">
                      {t.beeper.toUpperCase()}: {lastOrderInfo.beeperNumber}
                    </div>
                  )}

                  {/* Items */}
                  <div className="space-y-3 mb-4">
                    {lastOrderInfo?.items.map((item: any, i: number) => {
                      const parseNames = (name: string) => {
                        const baseName = name.replace(/-.*$/, '').trim();
                        const match = baseName.match(/^(.*?)\s*\((.*?)\)$/);
                        if (match) return { lao: match[1].trim(), english: match[2].trim() };
                        return { lao: baseName, english: null };
                      };
                      const { lao: laoName, english: engName } = parseNames(item.name);

                      return (
                        <div key={i} className="flex flex-col leading-tight">
                          <div className="flex justify-between font-black items-start">
                            <span className="flex-1 mr-2">{laoName} x{item.quantity}</span>
                            <span className="whitespace-nowrap">{formatLAK(item.price * item.quantity)}</span>
                          </div>

                          {engName && (
                            <div className="text-[10px] text-slate-500 font-bold -mt-0.5 mb-1">
                              {engName}
                            </div>
                          )}

                          {(item.variation || item.size) && (
                            <div className="text-[10px] flex justify-between opacity-70 italic">
                              <span>{[
                                item.variation === 'HOT' ? t.hot : item.variation === 'ICE' ? t.ice : item.variation === 'BLEND' ? t.blend : item.variation,
                                item.size === 'S' ? t.s_size : item.size === 'M' ? t.m_size : item.size === 'L' ? t.l_size : item.size
                              ].filter(v => v && !v.toLowerCase().includes('normal') && !v.toLowerCase().includes('standard')).join(' - ')}</span>
                            </div>
                          )}
                          {item.sugar && item.sugar !== '100%' && !item.sugar.toLowerCase().includes('normal') && (
                            <span className="text-[10px] text-slate-400 italic font-bold">
                              + {t.sugar}: {item.sugar === "No Sweet" ? t.no_sweet : item.sugar === "Less Sweet" ? t.less_sweet : item.sugar === "Extra Sweet" ? t.extra_sweet : item.sugar}
                            </span>
                          )}
                          {item.shot && !item.shot.toLowerCase().includes('normal') && (
                            <span className="text-[10px] text-slate-400 italic font-bold">
                              + {t.shot}: {item.shot === "Reduced Shot" ? t.reduced_shot : item.shot === "Double Shot" ? t.double_shot : item.shot}
                            </span>
                          )}
                          {item.isTakeaway && <span className="text-[10px] font-bold text-slate-400 italic uppercase tracking-wider">{t.takeaway}</span>}
                        </div>
                      )
                    })}
                  </div>

                  {/* Totals & Footer */}
                  <div className="border-t border-dashed border-slate-300 pt-3 space-y-1">
                    <div className="flex justify-between opacity-70 text-[11px]">
                      <span>{t.subtotal_net}</span>
                      <span>{formatLAK(lastOrderInfo.total - lastOrderInfo.tax)}</span>
                    </div>
                    {lastOrderInfo.discount > 0 && (
                      <div className="flex justify-between text-rose-600 font-bold text-[11px]">
                        <span>{t.promotions}</span>
                        <span>-{formatLAK(lastOrderInfo.discount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between opacity-70 text-[11px]">
                      <span>VAT ({sysSettings.taxRate}%)</span>
                      <span>{formatLAK(lastOrderInfo.tax)}</span>
                    </div>
                    <div className="flex justify-between font-black text-xl mt-2 pt-2 border-t border-dashed border-slate-300">
                      <span>{t.total_caps}</span>
                      <span>{formatLAK(lastOrderInfo.total)}</span>
                    </div>

                    {lastOrderInfo.paymentMethod === 'CASH' && (
                      <div className="mt-4 pt-2 border-t border-dashed border-slate-300 space-y-1">
                        <div className="flex justify-between opacity-70 text-[11px]">
                          <span>{t.cash_received}</span>
                          <span>{formatLAK(lastOrderInfo.cashReceived)}</span>
                        </div>
                        <div className="flex justify-between font-black text-lg text-emerald-700">
                          <span>{t.change}</span>
                          <span>{formatLAK(Math.max(0, lastOrderInfo.cashReceived - lastOrderInfo.total))}</span>
                        </div>
                      </div>
                    )}

                    {/* Footer */}
                    <div className="text-center mt-4 pt-2 border-t border-dashed border-slate-200 text-[10px] opacity-70">
                      <p className="font-black">WiFi: Pacano / PWD: PCN12022026</p>
                      <p className="uppercase tracking-widest font-black mb-0.5">{t.thank_you}</p>
                      <p>{t.payment_method}: {lastOrderInfo?.paymentMethod}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Fixed Sticky Buttons */}
            <div className="p-6 bg-slate-50 border-t mt-auto shadow-[0_-4px_10px_rgba(0,0,0,0.03)]">
              <div className="grid grid-cols-2 gap-3">
                <Button
                  variant="outline"
                  className="h-14 rounded-2xl border-2 text-base font-bold"
                  onClick={() => {
                    window.open(`/receipt?id=${lastOrderInfo.id}&mode=double`, '_blank')
                  }}
                >
                  <Printer className="w-5 h-5 mr-3" />
                  {t.receipt}
                </Button>
                <Button
                  className="h-14 rounded-2xl bg-slate-900 text-white font-black text-base"
                  onClick={() => {
                    setIsSuccessOpen(false)
                    handleNewOrder()
                  }}
                >
                  <ArrowRight className="w-5 h-5 mr-3" />
                  {t.confirm_next_order}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Hidden printer component */}
        <div className="hidden">
          {lastOrderInfo && (
            <div id="receipt-to-print">
              <Receipt order={lastOrderInfo} />
            </div>
          )}
          <Button id="print-receipt-btn" onClick={() => {
            const content = document.getElementById('receipt-to-print')?.innerHTML
            if (content) {
              const win = window.open('', '', 'width=300,height=600')
              win?.document.write(`<html><body style="margin:0;padding:0;">${content}</body></html>`)
              win?.document.close()
              win?.focus()
              win?.print()
              win?.close()
            }
          }}>{t.print}</Button>
        </div>

        {/* Actions */}
        <div className="p-2 border-t space-y-2">

          {selectedCustomer ? (
            <div className="space-y-1">
              <div className="flex items-center gap-2 w-full">
                <Badge variant="outline" className="flex-1 py-2 text-sm flex items-center justify-between gap-2 px-4">
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4" />
                    <span className="font-bold">{selectedCustomer.name}</span>
                  </div>
                  <span className="text-amber-600 font-bold bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100">
                    {(selectedCustomer as any).loyaltyPoints || 0} {t.pts}
                  </span>
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 text-red-500 hover:bg-red-50 hover:text-red-600 border border-slate-100"
                  onClick={() => {
                    setSelectedCustomer(null)
                    setPointsRedeemed(0)
                    setLoyaltyDiscount(0)
                  }}
                >
                  <X className="w-5 h-5" />
                </Button>
              </div>
              {pointsRedeemed === 0 && ((selectedCustomer as any).loyaltyPoints || 0) > 0 && (
                <div className="flex gap-2">
                  <Input
                    placeholder={t.pts.toUpperCase()}
                    value={manualPoints}
                    onChange={(e) => setManualPoints(e.target.value.replace(/\D/g, ""))}
                    className="h-9"
                  />
                  <Button
                    variant="outline"
                    className="bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100 h-9"
                    onClick={handleManualRedeem}
                    disabled={!manualPoints}
                  >
                    <Tag className="w-4 h-4 mr-2" /> {t.redeem_points}
                  </Button>
                </div>
              )}
              {pointsRedeemed > 0 && (
                <Button
                  variant="outline"
                  className="w-full text-red-600 border-rose-400 hover:text-rose-700 hover:bg-rose-50"
                  onClick={() => {
                    setPointsRedeemed(0)
                    setLoyaltyDiscount(0)
                  }}
                >
                  {t.cancel_redemption} ({pointsRedeemed} {t.pts})
                </Button>
              )}
            </div>
          ) : (
            <Button variant="outline" className="w-full" onClick={() => setIsCustomerSearchOpen(true)}>
              <User className="w-4 h-4 mr-2" /> {t.add_customer}
            </Button>
          )}

          {!appliedPromo ? (
            <Button variant="outline" className="w-full border-dashed" onClick={openPromoDialog}>
              <Tag className="w-4 h-4 mr-2" />
              {t.apply_promo}
            </Button>
          ) : (
            (() => {
              // Rose reads as "applied", so an inert promo must not look the same.
              // Colour is not the only signal - the reason goes on the button too.
              const blocker = promoBlocker(appliedPromo, cartItemCount)
              return (
                <Button
                  variant="outline"
                  className={`w-full h-auto py-2 flex-col gap-0.5 ${blocker
                    ? "text-amber-700 border-amber-400 bg-amber-50 hover:bg-amber-100 hover:text-amber-800"
                    : "text-rose-600 border-rose-400 hover:text-rose-700 hover:bg-rose-50"}`}
                  onClick={() => setAppliedPromo(null)}
                >
                  <span>{t.remove_promo} ({appliedPromo.code})</span>
                  {blocker && (
                    <span className="text-xs font-normal">{promoBlockerLabel(blocker, appliedPromo)}</span>
                  )}
                </Button>
              )
            })()
          )}



          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              className="w-full border-red-200 text-red-600 hover:bg-red-50 h-10"
              disabled={cart.length === 0 || isProcessing}
              onClick={handleCancelOrderClick}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              {t.clear}
            </Button>
            <Button
              variant="outline"
              className="w-full h-10 bg-gray-500 hover:bg-gray-500 hover:text-white text-white"
              disabled={cart.length === 0 || isProcessing}
              onClick={handleHoldOrder}
            >
              <Pause className="w-4 h-4 mr-2" />
              {t.hold_order}
            </Button>
          </div>

        </div>

        {session ? (
          // Table mode: one action. No payment, no complimentary toggle - the
          // bill is settled from the bill screen once, at the end.
          <Button
            className="w-full h-14 text-lg bg-amber-600 hover:bg-amber-700 text-white"
            size="lg"
            disabled={cart.length === 0 || isProcessing}
            onClick={sendToTable}
          >
            {isProcessing ? `${t.send_order}…` : `${t.send_order} → ${session.table.name}`}
          </Button>
        ) : (
        <div className="grid grid-cols-2 gap-2">
          <Button
            className="w-full h-12 bg-green-600 hover:bg-green-700 text-white"
            size="lg"
            disabled={cart.length === 0 || isProcessing}
            onClick={() => {
              if (shiftStatus !== 'OPEN') {
                notify.warn(t.please_open_shift_first)
                return
              }
              // Complimentary mode requires customer selection
              if (isComplimentary && !selectedCustomer) {
                notify.warn(t.select_customer_complimentary)
                return
              }
              // Auto-set payment for complimentary mode
              if (isComplimentary) {
                setPaymentMethod('CASH')
                setCashReceived(total.toString())
              }
              setIsPaymentOpen(true)
            }}
          >
            {t.proceed_to_payment}
          </Button>

          <div
            onClick={() => setIsComplimentary(!isComplimentary)}
            className="flex items-center justify-between px-3 py-2 bg-amber-50/50 border border-amber-100 rounded-lg cursor-pointer hover:bg-amber-100/50 transition"
          >
            <div className="flex flex-col">
              <span className="text-sm font-bold text-amber-900">
                {t.complimentary_mode}
              </span>
              <span className="text-[8px] text-amber-700/70 uppercase">
                {t.complimentary_mode_desc}


              </span>
            </div>

            <Switch
              checked={isComplimentary}
              onCheckedChange={setIsComplimentary}
              onClick={(e) => e.stopPropagation()}
            />
          </div>


        </div>
        )}




        <Dialog open={isPaymentOpen} onOpenChange={(open) => {
          if (!open && paymentMethod === 'ONEPAY' && resumedOrderId) {
            // Reset OnePay QR logic if closed
            const channel = new BroadcastChannel("pos_channel");
            channel.postMessage({ type: "PAYMENT_METHOD_CHANGE", method: 'ONEPAY_CANCELLED' }); // Assuming we want customer to see it cancelled or just reset
            channel.postMessage({ type: "PAYMENT_COMPLETE" });
            channel.close();
            // To properly reset OnePay, we should fetch to an api, but for UI,
            // setting resumed id to null prevents status polling and auto-checkout
            setOnepayQrSent(false)

            // If the cart changed while the dialog was closed, clear the stale QR data
            if (getCartSignature() !== lastGeneratedSignature) {
              setLastGeneratedQR(null)
              setLastGeneratedSignature(null)
            }
          }
          setIsPaymentOpen(open)
          if (open) setFocusedInput('beeper')
        }}>
          <DialogContent
            showCloseButton={false}
            onInteractOutside={(e) => e.preventDefault()}
            onEscapeKeyDown={(e) => e.preventDefault()}
            className="max-w-4xl w-[95vw] bg-slate-50 border-none shadow-2xl p-0 overflow-hidden"
          >
            <Button
              variant="ghost"
              size="sm"
              className="absolute top-2 right-2 text-slate-400 hover:text-slate-600 md:hidden"
              onClick={() => setIsPaymentOpen(false)}
            >
              <X className="w-5 h-5" />
            </Button>
            <div className="flex flex-col md:flex-row min-h-[500px] max-h-[85vh]">
              {/* Left Side: Order Summary & Info */}


              <div className="w-full md:w-80 p-6 bg-white border-r flex flex-col justify-between relative">

                <div>
                  <h2 className="text-xl font-bold text-slate-800 mb-6">{t.checkout}</h2>
                  <div className="space-y-4">
                    <div className="p-4 bg-amber-50 rounded-xl border border-amber-100">
                      <p className="text-sm text-amber-700 font-medium mb-1">{t.total_to_pay}</p>
                      <p className="text-3xl font-black text-amber-900">{formatLAK(total)}</p>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs font-bold uppercase text-slate-400 px-1">{t.payment_method}</Label>
                      <div className="grid grid-cols-1 gap-2">
                        <Button
                          variant={paymentMethod === 'CASH' ? "default" : "outline"}
                          onClick={() => setPaymentMethod('CASH')}
                          disabled={isComplimentary}
                          className={`h-12 justify-start px-4 text-lg ${paymentMethod === 'CASH' ? 'bg-green-600 hover:bg-green-700 shadow-md transform scale-[1.02]' : 'hover:bg-green-50'}`}
                        >
                          <span className="mr-3 text-xl">💵</span> ຈ່າຍສົດ
                        </Button>
                        <Button
                          variant={paymentMethod === 'ONEPAY' ? "default" : "outline"}
                          onClick={() => setPaymentMethod('ONEPAY')}
                          disabled={isComplimentary || isProcessing}
                          className={`h-12 justify-start px-4 text-lg ${isComplimentary ? 'opacity-50 cursor-not-allowed' : paymentMethod === 'ONEPAY' ? 'bg-white border-red-500 text-red-600 ring-2 ring-red-100 shadow-md transform scale-[1.02] hover:bg-red-50' : 'hover:bg-red-50 text-slate-700 border-slate-200'}`}
                        >
                          <img src="/bcel-one.png" alt="BCEL One" className="w-6 h-6 mr-3 rounded-md object-contain" /> <span className={paymentMethod === 'ONEPAY' ? 'font-bold' : ''}>ໂອນຈ່າຍ</span>
                        </Button>
                        <Button
                          variant={paymentMethod === 'TRANSFER' ? "default" : "outline"}
                          onClick={() => setPaymentMethod('TRANSFER')}
                          disabled={isComplimentary}
                          className={`h-12 justify-start px-4 text-lg ${isComplimentary ? 'opacity-50 cursor-not-allowed' : paymentMethod === 'TRANSFER' ? 'bg-purple-600 hover:bg-purple-700 shadow-md transform scale-[1.02]' : 'hover:bg-purple-50'}`}
                        >
                          <span className="mr-3 text-xl">🏦</span> ໂອນຈ່າຍສຳຮອງ
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>

                {paymentMethod === 'CASH' && (
                  <div className="space-y-3 pt-6 border-t font-medium">
                    <div className="flex justify-between text-slate-500">
                      <span>{t.cash_received}</span>
                      <span>{formatLAK(Number(cashReceived) || 0)}</span>
                    </div>
                    <div className="flex justify-between items-center pt-2">
                      <span className="text-lg font-bold text-slate-800">
                        {calculateChange(total, Number(cashReceived)).totalChange >= 0 ? t.change : t.missing_amount}
                      </span>
                      <span className={`text-2xl font-black ${calculateChange(total, Number(cashReceived)).totalChange >= 0 ? 'text-green-600' : 'text-rose-500'}`}>
                        {formatLAK(Math.abs(calculateChange(total, Number(cashReceived)).totalChange))}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Right Side: Interactive Input */}
              <div className="flex-1 p-6 flex flex-col relative overflow-y-auto">
                <div className="flex flex-col min-h-full space-y-6">
                  {/* Inputs Section - Shared by all */}
                  <div className="grid grid-cols-2 gap-4">
                    <div
                      className={`p-3 rounded-xl border-2 transition-all cursor-pointer ${focusedInput === 'beeper' ? 'border-amber-600 bg-white ring-4 ring-amber-100 shadow-lg' : 'border-slate-200 bg-slate-50'}`}
                      onClick={() => setFocusedInput('beeper')}
                    >
                      <Label className={`text-xs font-bold uppercase mb-1 block ${focusedInput === 'beeper' ? 'text-amber-600' : 'text-slate-400'}`}>
                        {t.beeper} {showBeeperError && !beeperNumber && <span className="text-rose-500">*</span>}
                      </Label>
                      <div className="text-2xl font-black text-slate-800 h-8 flex items-center">
                        {beeperNumber || <span className="text-slate-300 font-normal italic text-lg">{t.enter_no}</span>}
                      </div>
                    </div>

                    <div
                      className={`p-3 rounded-xl border-2 transition-all cursor-pointer ${paymentMethod !== 'CASH' ? 'opacity-50 grayscale' : focusedInput === 'cash' ? 'border-amber-600 bg-white ring-4 ring-amber-100 shadow-lg' : 'border-slate-200 bg-slate-50'}`}
                      onClick={() => paymentMethod === 'CASH' && !isComplimentary && setFocusedInput('cash')}
                    >
                      <Label className={`text-xs font-bold uppercase mb-1 block ${focusedInput === 'cash' && paymentMethod === 'CASH' ? 'text-amber-600' : 'text-slate-400'}`}>
                        {t.cash_received}
                      </Label>
                      <div className="text-2xl font-black text-slate-800 h-8 flex items-center">
                        {cashReceived ? Number(cashReceived).toLocaleString() : <span className="text-slate-300 font-normal italic text-lg">0</span>}
                      </div>
                    </div>
                  </div>

                  <div className="flex-1 flex flex-col space-y-6">
                    {/* Primary Numpad */}
                    <div className="max-w-sm w-full mx-auto">
                      <div className="grid grid-cols-3 gap-2">
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                          <Button
                            key={num}
                            variant="outline"
                            className="h-12 text-2xl font-black border-2 hover:bg-amber-50 hover:border-amber-400 transition-all rounded-xl shadow-sm"
                            onClick={() => {
                              if (focusedInput === 'beeper') setBeeperNumber(prev => (prev + num).slice(0, 4))
                              if (focusedInput === 'cash') setCashReceived(prev => prev + num)
                            }}
                          >
                            {num}
                          </Button>
                        ))}
                        <Button
                          variant="outline"
                          className="h-12 text-base font-bold border-2 text-rose-500 hover:bg-rose-50 hover:border-rose-400 rounded-xl"
                          onClick={() => {
                            if (focusedInput === 'beeper') setBeeperNumber("")
                            if (focusedInput === 'cash') setCashReceived("")
                          }}
                        >
                          CLR
                        </Button>
                        <Button
                          variant="outline"
                          className="h-12 text-2xl font-black border-2 hover:bg-amber-50 hover:border-amber-400 rounded-xl shadow-sm"
                          onClick={() => {
                            if (focusedInput === 'beeper') setBeeperNumber(prev => (prev + '0').slice(0, 4))
                            if (focusedInput === 'cash') setCashReceived(prev => prev + '0')
                          }}
                        >
                          0
                        </Button>
                        <Button
                          variant="outline"
                          className="h-12 text-base font-bold border-2 text-slate-600 hover:bg-slate-100 rounded-xl"
                          onClick={() => {
                            if (focusedInput === 'beeper') setBeeperNumber(prev => prev.slice(0, -1))
                            if (focusedInput === 'cash') setCashReceived(prev => prev.slice(0, -1))
                          }}
                        >
                          DEL
                        </Button>
                      </div>

                      {/* Bank Note Quick Actions - Only for CASH */}
                      {paymentMethod === 'CASH' && !isComplimentary && (
                        <div className="space-y-2 mt-4">
                          <div className="flex items-center justify-between">
                            <Label className="text-[12px] font-black uppercase text-slate-400 tracking-widest">{t.bank_note}</Label>
                            <Button
                              variant="default"
                              size="sm"
                              className="h-10 px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm shadow rounded-lg"
                              onClick={() => setCashReceived(total.toString())}
                            >
                              {t.pay_exact}
                            </Button>
                          </div>
                          <div className="grid grid-cols-4 gap-1.5">
                            {[500, 1000, 2000, 5000, 10000, 20000, 50000, 100000].map(val => (
                              <Button
                                key={val}
                                variant="outline"
                                className="h-10 text-[12px] font-bold border-2 rounded-lg bg-slate-50 hover:bg-slate-100"
                                onClick={() => setCashReceived(prev => String(Number(prev || 0) + val))}
                              >
                                {val.toLocaleString()}
                              </Button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Payment Specific Content (OnePay/Transfer) - Moved BELOW numpad */}
                    {paymentMethod !== 'CASH' && (
                      <div className="w-full max-w-sm mx-auto">
                        {paymentMethod === 'ONEPAY' ? (
                          <div className="p-4 text-center border-2 border-dashed border-red-200 rounded-xl bg-red-50/50 flex flex-col items-center justify-center">
                            <h3 className="text-sm font-bold text-red-900 mb-2">BCEL OnePay</h3>
                            <Button
                              onClick={handleInitiateOnepay}
                              disabled={!beeperNumber || isProcessing || (onepayQrSent && getCartSignature() === lastGeneratedSignature)}
                              variant="outline"
                              className={`w-full h-11 text-sm rounded-xl font-bold transition-all ${onepayQrSent && getCartSignature() === lastGeneratedSignature ? 'bg-emerald-50 text-emerald-600 border-emerald-200 opacity-80 cursor-default' : 'bg-white text-red-600 border-2 border-red-500 hover:bg-red-50'}`}
                            >
                              {isProcessing ? <Loader2 className="animate-spin mr-2 w-5 h-5" /> : onepayQrSent && getCartSignature() === lastGeneratedSignature ? <CheckCircle className="mr-2 w-5 h-5" /> : <Smartphone className="mr-2 w-5 h-5" />}
                              {onepayQrSent && getCartSignature() === lastGeneratedSignature ? t.qr_already_sent : t.generate_qr}
                            </Button>
                            {onepayQrSent && (
                              <div className="mt-3 p-2 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg flex items-center justify-center gap-2 text-xs animate-in fade-in slide-in-from-top-1 duration-300">
                                <CheckCircle className="w-4 h-4" />
                                <span className="font-bold">{t.qr_sent}</span>
                              </div>
                            )}
                          </div>
                        ) : paymentMethod === 'TRANSFER' && (
                          <div className="p-4 text-center border-2 border-dashed border-purple-200 rounded-xl bg-purple-50 flex flex-col items-center justify-center">
                            <h3 className="text-sm font-bold text-purple-900 mb-2">{t.store_transfer_qr}</h3>
                            <div className="mx-auto w-32 h-32 bg-white border border-purple-100 rounded-xl p-2 shadow-sm mb-3">
                              <img src={sysSettings.transfer_qr_url || "/placeholder-qr.png"} alt="Transfer QR" className="w-full h-full object-contain" />
                            </div>
                            <p className="text-[10px] font-medium text-purple-800">{t.verify_slip_before_completion}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Shared Bottom Actions */}
                  <div className="flex gap-3 pt-2">
                    <Button variant="outline" className="flex-1 h-12 text-base font-bold border-2 rounded-xl" onClick={() => setIsPaymentOpen(false)}>
                      {t.cancel}
                    </Button>
                    {paymentMethod !== 'ONEPAY' && (
                      <Button
                        className={`flex-[2] h-12 text-base font-black shadow-lg rounded-xl ${paymentMethod === 'CASH' ? 'bg-green-600 hover:bg-green-700 shadow-green-200' : 'bg-red-600 hover:bg-red-700 shadow-red-200'}`}
                        disabled={isProcessing || !beeperNumber || (paymentMethod === 'CASH' && (!cashReceived || Number(cashReceived) < total))}
                        onClick={handleCheckout}
                      >
                        {isProcessing ? t.processing : (paymentMethod === 'CASH' ? t.complete_order : t.mark_as_paid_manual)}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>


        {/* Promo Dialog */}

        <Dialog open={isPromoOpen} onOpenChange={setIsPromoOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>{t.apply_promo}</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-2">
              {/* Picking beats typing: nobody remembers "18F6" at the counter. */}
              <div className="max-h-[19rem] overflow-y-auto space-y-2 -mx-1 px-1">
                {promoList === null && [0, 1, 2].map(i => (
                  <div key={i} className="h-[4.5rem] rounded-lg bg-muted animate-pulse" />
                ))}

                {promoList?.filter((p: any) => p.staffPickable !== false).map((promo: any) => {
                  const blocker = promoBlocker(promo, cartItemCount)
                  const amount = promo.discountType === 'percentage'
                    ? `${promo.discountValue}%`
                    : formatLAK(promo.discountValue)
                  return (
                    <button
                      key={promo.id}
                      type="button"
                      disabled={!!blocker}
                      onClick={() => applyPromo(promo)}
                      className="w-full min-h-[4.5rem] flex items-center justify-between gap-3 p-4 border rounded-lg text-left transition-colors duration-150 enabled:hover:bg-muted enabled:active:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <span className="min-w-0">
                        <span className="block font-medium truncate">{promo.name}</span>
                        <span className="block text-sm text-muted-foreground">
                          {blocker ? promoBlockerLabel(blocker, promo) : promo.code}
                        </span>
                      </span>
                      <span className={`shrink-0 font-semibold tabular-nums ${blocker ? 'text-muted-foreground' : 'text-amber-700'}`}>
                        −{amount}
                      </span>
                    </button>
                  )
                })}

                {promoList && promoList.filter((p: any) => p.staffPickable !== false).length === 0 && (
                  <p className="text-center text-sm text-muted-foreground py-10">
                    {promoListError ? (t.promo_list_error || "Couldn't load promotions") : (t.no_promotions_available || "No promotions set up")}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">{t.or_enter_code || "or enter a code"}</span>
                <span className="h-px flex-1 bg-border" />
              </div>

              <div className="flex gap-2">
                <Input
                  placeholder={t.promo_code}
                  value={promoCodeInput}
                  onChange={e => setPromoCodeInput(e.target.value.toUpperCase())}
                  onKeyDown={e => { if (e.key === 'Enter') applyPromoCode() }}
                  className="h-11"
                />
                <Button
                  className="h-11 px-6 bg-amber-600 hover:bg-amber-700"
                  onClick={applyPromoCode}
                  disabled={!promoCodeInput.trim()}
                >
                  {t.apply_discount}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Customer Search Dialog */}
        <Dialog open={isCustomerSearchOpen} onOpenChange={setIsCustomerSearchOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>{t.select_customer}</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <Input
                placeholder={t.search_customer}
                value={customerQuery}
                onChange={e => setCustomerQuery(e.target.value)}
                autoFocus
              />
              <div className="max-h-60 overflow-y-auto space-y-2">
                {customerResults.map(c => (
                  <div
                    key={c.id}
                    className="p-3 border rounded hover:bg-muted cursor-pointer flex justify-between"
                    onClick={() => {
                      setSelectedCustomer(c)
                      setIsCustomerSearchOpen(false)
                    }}
                  >
                    <span className="font-medium">{c.name}</span>
                    <span className="text-muted-foreground text-sm">{c.phone}</span>
                  </div>
                ))}
                {customerResults.length === 0 && customerQuery.length > 2 && (
                  <div className="text-center text-muted-foreground p-4">{t.no_results}</div>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* New Order Confirmation */}
        <AlertDialog open={isNewOrderConfirmOpen} onOpenChange={setIsNewOrderConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t.start_new_order_title}</AlertDialogTitle>
              <AlertDialogDescription>
                {t.start_new_order_desc}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
              <AlertDialogAction className="bg-amber-600 hover:bg-amber-700" onClick={handleNewOrder}>
                {t.discard_start_new}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>



        {/* Custom Hold Success Dialog */}
        <Dialog open={isHoldSuccessOpen} onOpenChange={setIsHoldSuccessOpen}>
          <DialogContent className="sm:max-w-md text-center">
            <DialogTitle className="sr-only">{t.order_put_on_hold_title}</DialogTitle>
            <div className="flex flex-col items-center justify-center pt-6">
              <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mb-4">
                <Pause className="w-8 h-8 text-orange-600" />
              </div>
              <h2 className="text-xl font-bold text-amber-900 mb-2">{t.order_put_on_hold_title}</h2>
              <p className="text-muted-foreground mb-6">
                {t.order_put_on_hold_desc}
              </p>
              <Button className="w-full bg-orange-600 hover:bg-orange-700" onClick={() => setIsHoldSuccessOpen(false)}>
                {t.back_to_pos}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Cancel Order Reason Dialog */}
        <Dialog open={isCancelConfirmOpen} onOpenChange={setIsCancelConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t.cancel_redemption.replace(/\(.*\)/, '').trim() || t.cancel}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p>{t.please_provide_cancel_reason}</p>
              <Input
                placeholder={t.cancel_reason_placeholder}
                value={cancelReason}
                onChange={e => setCancelReason(e.target.value)}
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setIsCancelConfirmOpen(false)}>{t.back}</Button>
                <Button variant="destructive" onClick={handleCancelOrderConfirm} disabled={!cancelReason}>
                  {t.confirm_cancel}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>


        {productToCustomize && (
          <CustomizationDialog
            isOpen={customizationOpen}
            onClose={() => { setCustomizationOpen(false); setProductToCustomize(null); }}
            onConfirm={handleAddToCartWithCustomization}
            menuName={productToCustomize.name}
            localName={productToCustomize.localName}
            variations={productToCustomize.variations || []}
            hasSugarLevel={productToCustomize.hasSugarLevel}
            hasShotType={productToCustomize.hasShotType}
            imageUrl={productToCustomize.image}
          />
        )}
      </div>
      </div>
    </div>
  )
}

export default function POSPage() {
  // useSearchParams needs a Suspense boundary or `next build` refuses the page.
  return (
    <Suspense fallback={null}>
      <POSPageInner />
    </Suspense>
  )
}
