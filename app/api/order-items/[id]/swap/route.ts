import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { decrementStock } from '@/lib/stock'
import {
    canSwap, chargeFor, componentIndex, contentsOf, remainingContents, valueOf,
    type SellableMenu,
} from '@/lib/packages'
import { sellableMenus } from '@/lib/packages-db'
import { requireOpenShift } from '@/lib/shift-guard'
import { EXCHANGE_CHARGE, recomputeOrderTotal } from '@/lib/swap-charge'

export const dynamic = 'force-dynamic'

/**
 * What earlier swaps put into this package, as components a later swap can
 * take back out.
 *
 * Priced at today's menu where the item is still sold, falling back to what the
 * swap recorded: a drink whose price rose since should be valued at what the
 * bar charges for it now, but a delisted one still has to be tradeable.
 */
function addedComponents(
    swaps: { reversedAt: Date | null; lines: any[] }[],
    menus: SellableMenu[],
) {
    const byMenu = new Map(menus.map((m) => [m.menuId, m]))
    const added = new Map<string, any>()
    for (const swap of swaps) {
        if (swap.reversedAt) continue
        for (const line of swap.lines) {
            if (line.direction !== 'IN' || !line.menuId) continue
            const at = added.get(line.menuId)
            if (at) { at.quantity += line.quantity; continue }
            const live = byMenu.get(line.menuId)
            added.set(line.menuId, {
                menuId: line.menuId,
                variationSizeId: live?.variationSizeId ?? line.variationSizeId,
                name: live?.name ?? line.name,
                localName: live?.localName ?? null,
                unitPrice: live?.unitPrice ?? line.unitPrice,
                quantity: line.quantity,
            })
        }
    }
    return Array.from(added.values())
}

/** The recipe rule the order path uses: the menu's base lines plus this size's. */
async function recipeFor(tx: any, variationSizeId: string) {
    const vs = await tx.variationSize.findUnique({
        where: { id: variationSizeId },
        include: { variation: { include: { menu: true } } },
    })
    if (!vs?.variation?.menu) return []
    return tx.recipe.findMany({
        where: {
            OR: [
                { menuId: vs.variation.menu.id, variationSizeId: null },
                { variationSizeId },
            ],
        },
    })
}

/** What this package still holds, so the screen can cap what may leave it. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const user = await getSessionUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const item = await prisma.orderItem.findUnique({
            where: { id },
            include: {
                swaps: { include: { lines: true }, orderBy: { createdAt: 'asc' } },
                variationSize: { include: { variation: { include: { menu: { include: { recipes: true } } } } } },
            },
        })
        if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })

        const menu = item.variationSize?.variation?.menu
        const menus = await sellableMenus()
        const index = componentIndex(menus)
        const contents = menu
            ? contentsOf(menu.recipes.map((r) => ({ ingredientId: r.ingredientId, quantity: r.quantity })), index)
                .map((c) => ({ ...c, quantity: c.quantity * item.quantity }))
            : []
        const alreadyRemoved = item.swaps.filter((s) => !s.reversedAt).flatMap((s) =>
            s.lines.filter((l) => l.direction === 'OUT' && l.menuId)
                .map((l) => ({ menuId: l.menuId as string, quantity: l.quantity })))

        return NextResponse.json({
            name: item.name,
            quantity: item.quantity,
            contents,
            remaining: remainingContents(contents, alreadyRemoved, addedComponents(item.swaps, menus)),
            swaps: item.swaps,
        })
    } catch (error) {
        console.error('[package swap] GET failed', error)
        return NextResponse.json({ error: 'Failed to load package' }, { status: 500 })
    }
}

/**
 * Swap what a package delivered (req #8), logging it as we go (req #9).
 *
 * No manager PIN: the owner's call, and the right one - this happens ten times
 * a night and a PIN each time would be worked around within a week. The price
 * floor and the per-package cap are what stop it being abused, and the log is
 * what a manager reads afterwards.
 *
 * The bill's package line is never touched. It still says what was sold at what
 * price; the swap is a separate fact about what left the shelf, and a dearer
 * replacement arrives as its own charged line rather than by quietly editing
 * the price of something the customer already agreed to.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const user = await getSessionUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        // Every other money path in this app refuses to run with the night
        // closed - orders, payments, voids. A swap moves stock and can add a
        // charge, so it belongs to a shift for exactly the same reasons.
        const openShift = await prisma.shift.findFirst({ where: { status: 'OPEN' } })
        const shiftCheck = requireOpenShift(openShift)
        if (!shiftCheck.ok) {
            return NextResponse.json({ error: shiftCheck.reason }, { status: 409 })
        }

        const body = await request.json()
        const removing: { menuId: string; quantity: number }[] = Array.isArray(body.removing) ? body.removing : []
        const adding: { variationSizeId: string; quantity: number }[] = Array.isArray(body.adding) ? body.adding : []

        const item = await prisma.orderItem.findUnique({
            where: { id },
            include: {
                order: { select: { id: true, status: true, sessionId: true } },
                swaps: { include: { lines: true } },
                variationSize: { include: { variation: { include: { menu: { include: { recipes: true } } } } } },
            },
        })
        if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })
        if (item.voidedAt) return NextResponse.json({ error: 'LINE_VOIDED' }, { status: 409 })
        if (item.order.status === 'CANCELLED') return NextResponse.json({ error: 'ORDER_CANCELLED' }, { status: 409 })

        // A settled bill is closed for business: changing what it delivered
        // after the money is counted is a different job (reopen it first).
        if (item.order.sessionId) {
            const session = await prisma.tableSession.findUnique({
                where: { id: item.order.sessionId },
                select: { status: true },
            })
            if (session?.status === 'CLOSED') {
                return NextResponse.json({ error: 'SESSION_ALREADY_CLOSED' }, { status: 409 })
            }
        }

        const menu = item.variationSize?.variation?.menu
        if (!menu) return NextResponse.json({ error: 'NOT_A_PACKAGE' }, { status: 409 })

        const menus = await sellableMenus()
        const index = componentIndex(menus)
        // A line of two buckets holds twice the contents of one.
        const perPackage = contentsOf(
            menu.recipes.map((r) => ({ ingredientId: r.ingredientId, quantity: r.quantity })),
            index,
        )
        const contents = perPackage.map((c) => ({ ...c, quantity: c.quantity * item.quantity }))
        if (contents.length === 0) return NextResponse.json({ error: 'NOT_A_PACKAGE' }, { status: 409 })

        const alreadyRemoved = item.swaps.filter((s) => !s.reversedAt).flatMap((s) =>
            s.lines.filter((l) => l.direction === 'OUT' && l.menuId)
                .map((l) => ({ menuId: l.menuId as string, quantity: l.quantity })))
        const left = remainingContents(contents, alreadyRemoved, addedComponents(item.swaps, menus))

        const check = canSwap(left, removing, adding)
        if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 409 })

        // Priced from the menu as it stands right now, then snapshotted onto the
        // swap: tomorrow's price rise must not rewrite tonight's exchange.
        const outLines = removing.map((r) => {
            const held = left.find((c) => c.menuId === r.menuId)!
            return {
                direction: 'OUT', menuId: held.menuId, variationSizeId: held.variationSizeId,
                name: held.name, quantity: r.quantity, unitPrice: held.unitPrice,
            }
        })

        const sizes = await prisma.variationSize.findMany({
            where: { id: { in: adding.map((a) => a.variationSizeId) } },
            include: { variation: { include: { menu: true } } },
        })
        const inLines = adding.map((a) => {
            const size = sizes.find((s) => s.id === a.variationSizeId)
            if (!size) throw new Error('UNKNOWN_ITEM')
            return {
                direction: 'IN', menuId: size.variation.menu.id, variationSizeId: size.id,
                name: size.variation.menu.localName
                    ? `${size.variation.menu.localName} (${size.variation.menu.name})`
                    : size.variation.menu.name,
                quantity: a.quantity, unitPrice: size.price,
            }
        })

        const outValue = valueOf(outLines)
        const inValue = valueOf(inLines)
        const charged = chargeFor(outValue, inValue)

        const swap = await prisma.$transaction(async (tx) => {
            // Stock moves both ways through the same recipes the order path
            // used, so a bottle returned to the shelf is the same bottle the
            // package took off it.
            for (const line of outLines) {
                if (!line.variationSizeId) continue
                for (const r of await recipeFor(tx, line.variationSizeId)) {
                    await decrementStock(tx, r.ingredientId, -(r.quantity * line.quantity), {
                        type: 'EXCHANGE', userId: user.id,
                        notes: `swap out, item ${item.id}`, reason: line.menuId,
                    })
                }
            }
            for (const line of inLines) {
                if (!line.variationSizeId) continue
                for (const r of await recipeFor(tx, line.variationSizeId)) {
                    await decrementStock(tx, r.ingredientId, r.quantity * line.quantity, {
                        type: 'EXCHANGE', userId: user.id,
                        notes: `swap in, item ${item.id}`, reason: line.menuId,
                    })
                }
            }

            const created = await tx.packageSwap.create({
                data: {
                    orderItemId: item.id,
                    sessionId: item.order.sessionId,
                    userId: user.id,
                    outValue, inValue, charged,
                    lines: { create: [...outLines, ...inLines] },
                },
                include: { lines: true },
            })

            // Only a dearer replacement reaches the bill, as one line under the
            // package it belongs to. A cheaper one changes nothing: the package
            // price is a floor.
            if (charged > 0) {
                // Named for what it is. The detail of what was traded prints
                // directly above it, so repeating the drinks here only made an
                // 80mm slip wrap a line nobody needed twice.
                const chargeItem = await tx.orderItem.create({
                    data: {
                        orderId: item.order.id,
                        name: EXCHANGE_CHARGE,
                        price: charged,
                        quantity: 1,
                        total: charged,
                    },
                })
                // Recorded on the swap so undoing it strikes this exact line
                // rather than hunting for one that looks similar.
                await tx.packageSwap.update({
                    where: { id: created.id },
                    data: { chargeItemId: chargeItem.id },
                })
                await recomputeOrderTotal(tx, item.order.id)
            }

            return created
        })

        return NextResponse.json({ swap, charged, outValue, inValue })
    } catch (error: any) {
        if (error?.message === 'UNKNOWN_ITEM') {
            return NextResponse.json({ error: 'UNKNOWN_ITEM' }, { status: 400 })
        }
        console.error('[package swap] POST failed', error)
        return NextResponse.json({ error: 'Failed to swap' }, { status: 500 })
    }
}
