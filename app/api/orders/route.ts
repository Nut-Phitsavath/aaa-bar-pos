import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { startOfDay } from 'date-fns'
import { cookies } from 'next/headers'
import { calculateInclusiveTax } from '@/lib/currency'
import { promoBlocker, promoDiscountFor } from '@/lib/promotions'
import { decrementStock } from '@/lib/stock'
// A bill's promo is a snapshot; adding a round can change what it is worth.
import { refreshSessionPromo } from '@/lib/session-promo'
import { requireOpenShift } from '@/lib/shift-guard'
import { printRound } from '@/lib/printers'

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
            cashReceived, changeAmount,
            sessionId, waiterId
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

        // 0b. No shift, no sale.
        //
        // This used to be a single `if` on the counter's payment button, which
        // the table flow walked straight past because it never presses that
        // button - so a whole night could be served and paid for with every
        // order carrying shiftId null and the cash counted by nobody.
        //
        // Cancelling is exempt: a round keyed just before the shift closed must
        // still be voidable, and its own guard below already refuses to reach
        // into a shift that is not the current one.
        if (status !== 'CANCELLED') {
            const currentShift = await prisma.shift.findFirst({ where: { status: 'OPEN' } })
            const shiftCheck = requireOpenShift(currentShift)
            if (!shiftCheck.ok) {
                return NextResponse.json({ error: shiftCheck.reason }, { status: 409 })
            }
        }

        // 1. Validate Items & Menu items
        if (!items || !Array.isArray(items) || items.length === 0) {
            console.error("Order Validation Failed: Items list is invalid or empty", items)
            return NextResponse.json({ error: 'Order must have items' }, { status: 400 })
        }

        // Extract menuIds from items
        const menuIds = Array.from(new Set(items.map((i: any) => i.menuId)))
            .filter(id => id !== undefined && id !== null) as string[]

        if (menuIds.length === 0) {
            console.error("Order Validation Failed: No Menu IDs found", items)
            return NextResponse.json({ error: 'Items must have menuId' }, { status: 400 })
        }

        // 1b. Table orders must name a waiter. An unattributed round makes the
        //     per-waiter shift report a lie, which is the whole reason the
        //     waiter is picked per order instead of taken from the login.
        if (sessionId && !waiterId) {
            return NextResponse.json(
                { error: 'A table order must be assigned to a waiter' },
                { status: 400 }
            )
        }

        if (sessionId) {
            const tableSession = await prisma.tableSession.findUnique({ where: { id: sessionId } })
            if (!tableSession) {
                return NextResponse.json({ error: 'Session not found' }, { status: 404 })
            }
            if (tableSession.status === 'CLOSED') {
                return NextResponse.json({ error: 'SESSION_ALREADY_CLOSED' }, { status: 409 })
            }
        }

        // Check if ALL referenced menu items exist in DB
        const existingMenuItems = await prisma.menu.findMany({
            where: { id: { in: menuIds } },
            select: { id: true, price: true, name: true }
        })

        const existingIds = new Set(existingMenuItems.map(m => m.id))
        const missingIds = menuIds.filter(id => !existingIds.has(id))

        if (missingIds.length > 0) {
            console.error("Order Validation Failed: Stale IDs detected", missingIds)
            return NextResponse.json({
                error: `Foreign Key Violation: Menu items with IDs [${missingIds.join(', ')}] do not exist. Please refresh the menu or clear your cart.`,
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

        // Built from the DB rows fetched above, never from the request body:
        // this map is what makes the reprice below server-authoritative.
        const priceById = new Map(existingMenuItems.map(m => [m.id, m.price]))

        let serverSubtotal = 0
        let serverItemCount = 0
        let serverPromoDiscount = 0
        let serverLoyaltyDiscount = 0
        let serverPointsRedeemed = 0
        let serverTotal = 0
        let serverTax = 0
        let effectivePromoId: string | null = promoId || null

        // 4a. Refuse an unpriced line. A menu row sitting at 0 has not been
        //     priced yet - it is not a free drink - so selling it would hand
        //     the stock away and book nothing. The till warns before it gets
        //     here; this is the boundary that actually decides, because a
        //     second device or a stale tab can post straight past the screen.
        //     Cancellations are exempt: they replay an order already rung up,
        //     and their lines are priced from the stored snapshot, not the menu.
        if (status !== 'CANCELLED') {
            const unpriced = existingMenuItems.filter(m => !(m.price > 0))
            if (unpriced.length > 0) {
                console.error("Order Validation Failed: Unpriced items", unpriced.map(m => m.id))
                return NextResponse.json({
                    error: `These items have no price yet and cannot be sold: ${unpriced.map(m => m.name).join(', ')}. Set a price in Menu first.`,
                    code: 'UNPRICED_ITEM',
                    unpricedIds: unpriced.map(m => m.id)
                }, { status: 400 })
            }
        }

        if (status !== 'CANCELLED') {
            for (const it of items) {
                const unit = priceById.get(it.menuId) ?? 0
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
            let tableOrderNumber: number | null = null
            let isNew = false
            const orderId = id || crypto.randomUUID()

            // Fetch previous state if exists
            const previousOrder = await tx.order.findUnique({
                where: { id: orderId },
                include: { items: true }
            })

            if (previousOrder) {
                orderNumber = previousOrder.orderNumber
                // Editing a round keeps the number it was served under.
                tableOrderNumber = previousOrder.tableOrderNumber
            } else {
                isNew = true
                const today = startOfDay(new Date())
                const count = await tx.order.count({
                    where: { createdAt: { gte: today } }
                })
                orderNumber = `No. ${String(count + 1).padStart(2, '0')}`

                // A table bill numbers its own rounds from 1, which is what the
                // printed bill and the customer talk about ("order #2"). Taken
                // as max+1 rather than count+1 so a voided round keeps its
                // number and the sequence never shifts under an audit. Inside
                // this transaction, so two devices sending at once cannot both
                // claim the same number.
                if (sessionId) {
                    const highest = await tx.order.aggregate({
                        where: { sessionId },
                        _max: { tableOrderNumber: true }
                    })
                    tableOrderNumber = (highest._max.tableOrderNumber ?? 0) + 1
                }
            }

            // 2. Prepare Payload. For non-cancellations we store the SERVER-computed
            //    money (override + log); cancellations keep the order's stored values.
            const isCancelling = status === 'CANCELLED'
            const serverDiscount = serverPromoDiscount + serverLoyaltyDiscount
            const tendered = cashReceived ? parseFloat(cashReceived) : 0

            const orderData = {
                orderNumber,
                tableOrderNumber,
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

            // Same nested-connect rule as shiftLink above: a bare sessionId /
            // waiterId scalar alongside these relation connects makes Prisma
            // reject the whole payload.
            const sessionLink = sessionId
                ? { session: { connect: { id: sessionId } } }
                : {}

            const waiterLink = waiterId
                ? { waiter: { connect: { id: waiterId } } }
                : {}

            // 3. Prepare Items (using menuId)
            const preparedItems = items.map((item: any) => {
                // 1. Find the DB record for this menu item
                const menuRecord = existingMenuItems.find(m => m.id === item.menuId);

                // 2. Size is whatever the cart sent. There is no size axis on the
                //    item any more, so there is nothing to fall back to: a bar
                //    names the serving in the item ("Beer Lao Bucket (5)").
                const finalSize = item.size || item.cupSize;

                // 3. Construct full descriptive name snapshot
                const fullName = item.name || menuRecord?.name || "Item";

                // Line price comes from the DB (authoritative); cancellations keep
                // the order's original snapshot price.
                const dbUnitPrice = isCancelling ? (parseFloat(item.price) || 0) : (menuRecord?.price ?? 0)
                const qty = parseInt(item.quantity) || 0

                return {
                    menuId: item.menuId,
                    name: fullName,
                    price: dbUnitPrice,
                    quantity: qty,
                    total: dbUnitPrice * qty,
                    sugarLevel: item.sugarLevel || null,
                    shotType: item.shotType || null,
                    cupSize: finalSize || null,
                    isTakeaway: item.isTakeaway || false,
                    // Req #4. Trimmed and capped here as well as in the dialog:
                    // this route is also the one a second till would post to.
                    note: (item.note || "").trim().slice(0, 120) || null
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
                        ...sessionLink,
                        ...waiterLink,
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
                        ...sessionLink,
                        ...waiterLink,
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

            // Stock moves when the drink is served, not when the bill is paid.
            // A SENT order is sitting on an open table: the bottle has already
            // left the shelf, so it must be deducted now. No money has changed
            // hands yet though, so loyalty, the cash drawer and the shift link
            // all stay gated on COMPLETED.
            const ACTIVE_STATUSES = ['COMPLETED', 'SENT']
            const wasActive = previousOrder ? ACTIVE_STATUSES.includes(previousOrder.status) : false
            const isNowActive = ACTIVE_STATUSES.includes(status || 'COMPLETED')

            // A. If newly ACTIVE (new order, HOLD -> COMPLETED, or sent to a table)
            if (isNowActive && !wasActive) {

                // 1. Deduct Stock (based on menu recipes)
                //
                // One tier, not two. The recipe used to be resolved as base
                // (menuId, variationSizeId null) OR size-specific override
                // (variationSizeId), which only ever meant anything when one
                // item had several sizes to price differently. It doesn't any
                // more, and no override row was ever written.
                for (const item of preparedItems) {
                    // Delete this line and one malformed cart line empties the
                    // whole bar: an undefined menuId is "no filter" to findMany,
                    // so it matches every recipe. findUnique used to throw here.
                    if (!item.menuId) continue

                    const recipes = await tx.recipe.findMany({
                        where: { menuId: item.menuId }
                    })

                    for (const recipe of recipes) {
                        await decrementStock(tx, recipe.ingredientId, recipe.quantity * item.quantity, {
                            type: 'SALE', userId, notes: `order ${orderId}`, reason: item.menuId,
                        })
                    }
                }

                // Money only moves on a real checkout. A SENT order on an open
                // table has deducted its stock above and stops here — it earns
                // no points and puts nothing in the drawer until the bill is
                // settled by /api/table-sessions/[id]/close.
                if (isNowCompleted && !wasCompleted) {

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

                } // end money-only block
            }

            // B. If REVERSAL (COMPLETED or SENT -> CANCELLED)
            if (previousOrder && wasActive && isCancelled) {
                // 1. Revert Stock
                const oldItems = previousOrder.items
                // Same single-tier lookup as the deduction above, so a void
                // gives back exactly what the sale took.
                for (const item of oldItems) {
                    // Delete this line and voiding one line credits stock the
                    // bar never sold: an undefined menuId filters nothing, so
                    // findMany returns every recipe. Not defensive - load-bearing.
                    if (!item.menuId) continue

                    const recipes = await tx.recipe.findMany({
                        where: { menuId: item.menuId }
                    })

                    for (const recipe of recipes) {
                        await decrementStock(tx, recipe.ingredientId, -(recipe.quantity * item.quantity), {
                            type: 'SALE_VOID', userId, notes: `order ${orderId}`, reason: item.menuId,
                        })
                    }
                }

                // Stamp the lines too, so a counter cancellation lands in the
                // void audit report alongside a table void (req #24) instead of
                // being invisible to it. The free-text reason staff typed is
                // kept as the note; the code is OTHER because this path has no
                // picklist to choose from.
                await tx.orderItem.updateMany({
                    where: { orderId: id, voidedAt: null },
                    data: {
                        voidedAt: new Date(),
                        voidedById: userId,
                        voidReason: 'OTHER',
                        voidNote: cancellationReason || null,
                    },
                })

                // Mirror of the money-only block above. A SENT order never
                // earned points and never reached the drawer, so reversing
                // either here would silently drain a customer's balance or the
                // shift's cash total.
                if (wasCompleted) {

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

                } // end money-only reversal block
            }

            // The round is on the bill now, so the deal may be worth more -
            // or newly worth something, if this is the round that met its
            // minimum. Inside the transaction so the bill is never briefly
            // priced with a stale discount.
            if (sessionId) await refreshSessionPromo(tx as any, sessionId)

            return savedOrder
        })

        // The paper, once the round is safely saved (req #11).
        //
        // Outside the transaction on purpose: a printer that is off, unplugged
        // or still booting must not roll back an order the bar has already
        // poured. What the till gets back is which stations printed, so it can
        // say "kitchen printer not answering" instead of the staff finding out
        // when the food never arrives.
        //
        // ponytail: table rounds only. A counter sale is made in front of the
        // customer and already prints a receipt; wire it here too the day the
        // bar starts taking walk-in food orders.
        let dockets: Awaited<ReturnType<typeof printRound>> = []
        // Its own try: the round is already committed, so a failure from here
        // on must not become a 500 - the till would keep the cart, staff would
        // send it again, and the bar would get a second round and stock taken
        // twice. ponytail: the till gets no printer warning in that case; a
        // shout across the room beats a duplicate round.
        if (status === 'SENT' && sessionId) try {
            const printable = await prisma.order.findUnique({
                where: { id: result.id },
                include: {
                    session: { include: { table: { select: { name: true } } } },
                    waiter: { select: { name: true } },
                    items: {
                        where: { voidedAt: null },
                        include: { menu: { select: { category: { select: { station: true } } } } },
                    },
                },
            })
            if (printable) {
                dockets = await printRound({
                    table: printable.session?.table?.name ?? '—',
                    round: printable.tableOrderNumber,
                    waiter: printable.waiter?.name ?? null,
                    at: printable.createdAt,
                    items: printable.items.map((i) => ({
                        name: i.name,
                        quantity: i.quantity,
                        note: i.note,
                        station: i.menu?.category?.station ?? 'BAR',
                    })),
                })
            }
        } catch (printError: any) {
            console.error('[orders] round saved, dockets not printed:', printError?.message)
        }

        return NextResponse.json({ ...result, dockets })

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
