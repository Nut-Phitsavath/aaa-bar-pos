import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { startOfDay } from 'date-fns'
import { cookies } from 'next/headers'
import { calculateInclusiveTax } from '@/lib/currency'
import { promoBlocker, promoDiscountFor } from '@/lib/promotions'

// Force dynamic to prevent caching issues with Orders
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
    try {
        const body = await request.json()
        const {
            id, items, total, subtotal, tax, discount,
            promoId, customerId, paymentMethod, status,
            beeperNumber, cancellationReason,
            pointsRedeemed, taxAmount, isReportable,
            cashReceived, changeAmount
        } = body

        // --- VALIDATION PHASE (Fail Fast) ---

        // 0. Get current user
        const cookieStore = await cookies()
        const sessionCookie = cookieStore.get('pos_session')
        let userId = null
        if (sessionCookie) {
            try {
                const sessionUser = JSON.parse(sessionCookie.value)
                const dbUser = await prisma.user.findUnique({ where: { id: sessionUser.id } })
                if (dbUser) {
                    userId = sessionUser.id
                }
            } catch (e) { }
        }

        // 1. Validate Items & VariationSizes
        if (!items || !Array.isArray(items) || items.length === 0) {
            console.error("Order Validation Failed: Items list is invalid or empty", items)
            return NextResponse.json({ error: 'Order must have items' }, { status: 400 })
        }

        // Extract variationSizeIds from items
        const variationSizeIds = Array.from(new Set(items.map((i: any) => i.variationSizeId)))
            .filter(id => id !== undefined && id !== null) as string[]

        if (variationSizeIds.length === 0) {
            console.error("Order Validation Failed: No VariationSize IDs found", items)
            return NextResponse.json({ error: 'Items must have variationSizeId' }, { status: 400 })
        }

        // Check if ALL referenced variationSizes exist in DB
        const existingVariationSizes = await prisma.variationSize.findMany({
            where: { id: { in: variationSizeIds } },
            select: { id: true, price: true, size: true, variation: { select: { type: true, menu: { select: { name: true } } } } }
        })

        const existingVariationSizeIds = new Set(existingVariationSizes.map(vs => vs.id))
        const missingIds = variationSizeIds.filter(id => !existingVariationSizeIds.has(id))

        if (missingIds.length > 0) {
            console.error("Order Validation Failed: Stale IDs detected", missingIds)
            return NextResponse.json({
                error: `Foreign Key Violation: VariationSizes with IDs [${missingIds.join(', ')}] do not exist. Please refresh the menu or clear your cart.`,
                code: 'STALE_ID_VIOLATION',
                missingIds
            }, { status: 400 })
        }

        // 2. Validate Customer (if provided)
        let customerRecord: { id: string; loyaltyPoints: number } | null = null
        if (customerId) {
            const customer = await prisma.customer.findUnique({ where: { id: customerId } })
            if (!customer) {
                console.error("Order Validation Failed: Customer missing", customerId)
                return NextResponse.json({
                    error: `Customer ${customerId} not found. They may have been deleted or the database was re-seeded.`,
                    code: 'STALE_CUSTOMER_VIOLATION'
                }, { status: 400 })
            }
            customerRecord = { id: customer.id, loyaltyPoints: customer.loyaltyPoints }
        }

        // 3. Validate Promotion (if provided). A missing id is an error (stale cart);
        //    an expired/inactive promo is simply ignored below (not applied).
        let promoRecord = null
        if (promoId) {
            promoRecord = await prisma.promotion.findUnique({ where: { id: promoId } })
            if (!promoRecord) {
                console.error("Order Validation Failed: Promo missing", promoId)
                return NextResponse.json({ error: `Promotion ${promoId} not found` }, { status: 400 })
            }
        }

        // 3b. Cancel guard: a COMPLETED order may only be cancelled while its own
        //     shift is the current OPEN shift. Orders from a closed/previous shift
        //     (or pre-dating shift tracking, shiftId = null) are uncancelable so a
        //     refund can never short a different drawer.
        if (status === 'CANCELLED' && id) {
            const prev = await prisma.order.findUnique({ where: { id } })
            if (prev && prev.status === 'COMPLETED') {
                const currentOpen = await prisma.shift.findFirst({ where: { status: 'OPEN' } })
                if (!prev.shiftId || prev.shiftId !== currentOpen?.id) {
                    return NextResponse.json({
                        error: 'Cannot cancel an order from a closed or previous shift.',
                        code: 'SHIFT_CLOSED_FOR_ORDER'
                    }, { status: 400 })
                }
            }
        }

        // 4. Server-authoritative money (override + log). Prices, promo, tax and
        //    redeemed points are recomputed from DB values so a stale or tampered
        //    cart can't set its own price. Skipped for cancellations.
        const settingsRows = await prisma.setting.findMany()
        const settingsMap: Record<string, string> = {}
        settingsRows.forEach(s => { settingsMap[s.key] = s.value })
        const taxRate = Number(settingsMap.taxRate ?? settingsMap.tax_rate ?? 10) || 0
        const loyaltyRate = Number(settingsMap.loyaltyRate ?? settingsMap.loyalty_rate ?? 1000) || 1000

        const priceById = new Map(existingVariationSizes.map(vs => [vs.id, vs.price]))

        let serverSubtotal = 0
        let serverItemCount = 0
        let serverPromoDiscount = 0
        let serverLoyaltyDiscount = 0
        let serverPointsRedeemed = 0
        let serverTotal = 0
        let serverTax = 0
        let effectivePromoId: string | null = promoId || null

        if (status !== 'CANCELLED') {
            for (const it of items) {
                const unit = priceById.get(it.variationSizeId) ?? 0
                const qty = parseInt(it.quantity) || 0
                serverSubtotal += unit * qty
                serverItemCount += qty
            }
            serverSubtotal = Math.round(serverSubtotal)

            // Promotion. Same function the till uses to price the cart and to grey
            // out unusable rows in the picker, so the screen and the drawer agree.
            effectivePromoId = null
            if (promoRecord) {
                const blocker = promoBlocker(promoRecord, serverItemCount)
                if (blocker) {
                    console.warn(`[orders] Promo ${promoId} not applicable (${blocker}); ignoring.`)
                } else {
                    effectivePromoId = promoRecord.id
                    serverPromoDiscount = promoDiscountFor(promoRecord, serverSubtotal, serverItemCount)
                }
            }

            // Loyalty redemption: clamp to the customer's real balance and to the
            // discount room left after the promo.
            const requestedPoints = pointsRedeemed ? parseInt(pointsRedeemed) : 0
            if (customerRecord && requestedPoints > 0) {
                const room = Math.max(0, serverSubtotal - serverPromoDiscount)
                const maxPointsByRoom = loyaltyRate > 0 ? Math.floor(room / loyaltyRate) : 0
                serverPointsRedeemed = Math.max(0, Math.min(requestedPoints, customerRecord.loyaltyPoints || 0, maxPointsByRoom))
                serverLoyaltyDiscount = serverPointsRedeemed * loyaltyRate
            }

            serverTotal = Math.max(0, serverSubtotal - serverPromoDiscount - serverLoyaltyDiscount)
            serverTax = calculateInclusiveTax(serverTotal, taxRate)

            if (Math.round(parseFloat(total) || 0) !== serverTotal) {
                console.warn(`[orders] Client total ${total} != server total ${serverTotal} (subtotal ${serverSubtotal}, promo ${serverPromoDiscount}, loyalty ${serverLoyaltyDiscount}); using server value.`)
            }
        }

        // 5. Resolve the open shift for COMPLETED orders (links the order to its
        //    shift and drives the cash drawer).
        let openShiftId: string | null = null
        if (status === 'COMPLETED') {
            const openShift = await prisma.shift.findFirst({ where: { status: 'OPEN' } })
            openShiftId = openShift?.id ?? null
            if (!openShiftId) console.log("No open shift found for completed order")
        }

        // --- EXECUTION PHASE (Transaction) ---

        const result = await prisma.$transaction(async (tx) => {
            // 1. Determine Order Number
            let orderNumber = ""
            let isNew = false
            const orderId = id || crypto.randomUUID()

            // Fetch previous state if exists
            const previousOrder = await tx.order.findUnique({
                where: { id: orderId },
                include: { items: true }
            })

            if (previousOrder) {
                orderNumber = previousOrder.orderNumber
            } else {
                isNew = true
                const today = startOfDay(new Date())
                const count = await tx.order.count({
                    where: { createdAt: { gte: today } }
                })
                orderNumber = `No. ${String(count + 1).padStart(2, '0')}`
            }

            // 2. Prepare Payload. For non-cancellations we store the SERVER-computed
            //    money (override + log); cancellations keep the order's stored values.
            const isCancelling = status === 'CANCELLED'
            const serverDiscount = serverPromoDiscount + serverLoyaltyDiscount
            const tendered = cashReceived ? parseFloat(cashReceived) : 0

            const orderData = {
                orderNumber,
                status: status || 'COMPLETED',
                total: isCancelling ? parseFloat(total) : serverTotal,
                subtotal: isCancelling ? parseFloat(subtotal) : serverSubtotal,
                tax: isCancelling ? parseFloat(taxAmount || tax || 0) : serverTax,
                discount: isCancelling ? parseFloat(discount || 0) : serverDiscount,
                paymentMethod: paymentMethod === 'BANK_NOTE' ? 'CASH' : (paymentMethod || 'CASH'),
                beeperNumber: beeperNumber || null,
                cancellationReason: status === 'CANCELLED' ? cancellationReason : null,
                pointsRedeemed: isCancelling ? (pointsRedeemed ? parseInt(pointsRedeemed) : 0) : serverPointsRedeemed,
                isReportable: isReportable !== undefined ? isReportable : true,
                cashReceived: tendered,
                changeAmount: isCancelling ? (changeAmount ? parseFloat(changeAmount) : 0) : Math.max(0, tendered - serverTotal),
                updatedAt: new Date()
            }

            // The shift link has to be a nested connect, not a bare shiftId. Prisma
            // rejects a scalar foreign key in the same payload as a relation connect
            // (customer/promotion/user), which 500s every order that has a customer
            // or a promo on it.
            const shiftLink = status === 'COMPLETED' && openShiftId
                ? { shift: { connect: { id: openShiftId } } }
                : {}

            // 3. Prepare Items (using variationSizeId)
            const preparedItems = items.map((item: any) => {
                // 1. Find the DB record for this variationSize
                const vsRecord = existingVariationSizes.find(v => v.id === item.variationSizeId);
                const dbVariation = vsRecord?.variation?.type; // e.g. "Hot"
                const dbSize = vsRecord?.size; // e.g. "M"

                // 2. Resolve Variation & Size (trust payload, fallback to DB)
                const finalVariation = item.variation || dbVariation;
                const finalSize = item.size || item.cupSize || dbSize;

                // 3. Construct full descriptive name snapshot
                let fullName = item.name || vsRecord?.variation?.menu?.name || "Item";

                // Line price comes from the DB (authoritative); cancellations keep
                // the order's original snapshot price.
                const dbUnitPrice = isCancelling ? (parseFloat(item.price) || 0) : (vsRecord?.price ?? 0)
                const qty = parseInt(item.quantity) || 0

                return {
                    variationSizeId: item.variationSizeId,
                    name: fullName,
                    price: dbUnitPrice,
                    quantity: qty,
                    total: dbUnitPrice * qty,
                    sugarLevel: item.sugarLevel || null,
                    shotType: item.shotType || null,
                    cupSize: finalSize || null,
                    isTakeaway: item.isTakeaway || false
                }
            })

            // 4. Update/Create Order
            let savedOrder;
            if (isNew) {
                savedOrder = await tx.order.create({
                    data: {
                        id: orderId,
                        ...orderData,
                        ...(customerId && { customer: { connect: { id: customerId } } }),
                        ...(effectivePromoId && { promotion: { connect: { id: effectivePromoId } } }),
                        ...(userId && { user: { connect: { id: userId } } }),
                        ...shiftLink,
                        items: {
                            create: preparedItems
                        }
                    }
                })
            } else {
                // Delete existing items to replace with new set
                await tx.orderItem.deleteMany({ where: { orderId } })

                savedOrder = await tx.order.update({
                    where: { id: orderId },
                    data: {
                        ...orderData,
                        customer: customerId ? { connect: { id: customerId } } : { disconnect: true },
                        promotion: effectivePromoId ? { connect: { id: effectivePromoId } } : { disconnect: true },
                        ...(userId && { user: { connect: { id: userId } } }),
                        ...shiftLink,
                        items: {
                            create: preparedItems
                        }
                    }
                })
            }

            // --- BUSINESS LOGIC (Stock, Loyalty, Cash) ---
            // Only trigger if status is COMPLETED

            const wasCompleted = previousOrder?.status === 'COMPLETED'
            const isNowCompleted = status === 'COMPLETED'
            const isCancelled = status === 'CANCELLED'

            // A. If newly COMPLETED (new order OR updated from HOLD -> COMPLETED)
            if (isNowCompleted && !wasCompleted) {

                // 1. Deduct Stock (based on menu recipes)
                for (const item of preparedItems) {
                    // Get the menu from variationSize
                    const vs = await tx.variationSize.findUnique({
                        where: { id: item.variationSizeId },
                        include: { variation: { include: { menu: true } } }
                    })

                    if (vs?.variation?.menu) {
                        // 1.1 Find all applicable recipes (Base + Specific Choice)
                        const recipes = await tx.recipe.findMany({
                            where: {
                                OR: [
                                    { menuId: vs.variation.menu.id, variationSizeId: null }, // Tier 1: Base
                                    { variationSizeId: item.variationSizeId }              // Tier 2: Specific Choice
                                ]
                            }
                        })

                        for (const recipe of recipes) {
                            await tx.ingredient.update({
                                where: { id: recipe.ingredientId },
                                data: { subStock: { decrement: recipe.quantity * item.quantity } }
                            })
                        }
                    }
                }

                // 2. Add Loyalty (if customer). Earn rate uses the same settings
                //    rate as redemption so the loyalty economy stays symmetric.
                if (customerId) {
                    const earned = Math.floor(savedOrder.total / loyaltyRate)
                    const redeemed = savedOrder.pointsRedeemed || 0

                    await tx.customer.update({
                        where: { id: customerId },
                        data: {
                            loyaltyPoints: { increment: earned - redeemed },
                            totalSpent: { increment: savedOrder.total },
                            visitCount: { increment: 1 },
                            lastVisit: new Date()
                        }
                    })
                }

                // 3. Update Cash Drawer (if Cash & Open Shift exists AND is reportable)
                if ((paymentMethod === 'BANK_NOTE' || paymentMethod === 'CASH') && openShiftId && savedOrder.isReportable) {
                    await tx.shift.update({
                        where: { id: openShiftId },
                        data: { cashPayments: { increment: savedOrder.total } }
                    })
                }
            }

            // B. If REVERSAL (COMPLETED -> CANCELLED)
            if (wasCompleted && isCancelled) {
                // 1. Revert Stock
                const oldItems = previousOrder.items
                for (const item of oldItems) {
                    if (!item.variationSizeId) continue
                    const vs = await tx.variationSize.findUnique({
                        where: { id: item.variationSizeId },
                        include: { variation: { include: { menu: true } } }
                    })

                    if (vs?.variation?.menu) {
                        // 1.1 Find all applicable recipes (Base + Specific Choice)
                        const recipes = await tx.recipe.findMany({
                            where: {
                                OR: [
                                    { menuId: vs.variation.menu.id, variationSizeId: null }, // Tier 1: Base
                                    { variationSizeId: item.variationSizeId }              // Tier 2: Specific Choice
                                ]
                            }
                        })

                        for (const recipe of recipes) {
                            await tx.ingredient.update({
                                where: { id: recipe.ingredientId },
                                data: { subStock: { increment: recipe.quantity * item.quantity } }
                            })
                        }
                    }
                }

                // 2. Revert Loyalty
                if (previousOrder.customerId) {
                    const earned = Math.floor(previousOrder.total / loyaltyRate)
                    const redeemed = previousOrder.pointsRedeemed || 0

                    await tx.customer.update({
                        where: { id: previousOrder.customerId },
                        data: {
                            loyaltyPoints: { decrement: earned - redeemed },
                            totalSpent: { decrement: previousOrder.total },
                            visitCount: { decrement: 1 }
                        }
                    })
                }

                // 3. Revert Cash to the order's OWN shift. The cancel guard above
                //    guarantees that shift is the current open one, so the drawer
                //    that received the sale is the one that gets refunded.
                if ((previousOrder.paymentMethod === 'BANK_NOTE' || previousOrder.paymentMethod === 'CASH') && previousOrder.isReportable && previousOrder.shiftId) {
                    await tx.shift.update({
                        where: { id: previousOrder.shiftId },
                        data: { cashPayments: { decrement: previousOrder.total } }
                    })
                }
            }

            return savedOrder
        })

        return NextResponse.json(result)

    } catch (error: any) {
        console.error("Order Transaction Failed:", error)
        return NextResponse.json({
            error: error.message || 'Transaction failed',
            details: error.meta
        }, { status: 500 })
    }
}

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url)
    const customerId = searchParams.get('customerId')
    const status = searchParams.get('status')
    const paymentMethod = searchParams.get('paymentMethod')
    const nextNum = searchParams.get('next-number')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    try {
        if (nextNum) {
            const today = startOfDay(new Date())
            const count = await prisma.order.count({
                where: { createdAt: { gte: today } }
            })
            return NextResponse.json({ orderNumber: `No. ${String(count + 1).padStart(2, '0')}` })
        }

        const where: any = {}
        if (customerId) where.customerId = customerId
        if (status) where.status = status
        if (paymentMethod) where.paymentMethod = paymentMethod

        if (startDate || endDate) {
            where.createdAt = {}
            if (startDate) where.createdAt.gte = new Date(startDate)
            if (endDate) where.createdAt.lte = new Date(endDate)
        }

        const orders = await prisma.order.findMany({
            where,
            include: { items: true, customer: true, promotion: true },
            orderBy: { createdAt: 'desc' },
            take: 100
        })

        return NextResponse.json(orders)
    } catch (error) {
        console.error(error)
        return NextResponse.json({ error: 'Failed' }, { status: 500 })
    }
}
