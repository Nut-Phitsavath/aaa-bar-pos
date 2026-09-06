import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { requireOpenShift } from '@/lib/shift-guard'
import { decrementStock } from '@/lib/stock'
import { componentIndex, contentsOf, remainingContents, type SellableMenu } from '@/lib/packages'
import { sellableMenus } from '@/lib/packages-db'
import { canReturn, returnable, type Returnable } from '@/lib/returns'

export const dynamic = 'force-dynamic'

/** Restocking is recorded as a stock movement, so it needs no table of its own. */
export const RETURN_TYPE = 'RETURN_UNOPENED'

/**
 * Everything this table was actually served, in things the bar can restock.
 *
 * Two kinds of line become returnable. A plain drink is itself. A package is
 * its contents, netted for any exchanges - a set whose Heinekens became Beer
 * Lao hands back Beer Lao, because that is what is standing on the table.
 *
 * Voided lines are skipped: their stock already went back when they were
 * struck, and offering them again would return the same bottle twice.
 */
async function servedBy(sessionId: string): Promise<{ had: Returnable[]; menus: SellableMenu[] }> {
    const orders = await prisma.order.findMany({
        where: { sessionId, status: { notIn: ['CANCELLED', 'HOLD'] } },
        include: {
            items: {
                include: {
                    swaps: { include: { lines: true } },
                    variationSize: { include: { variation: { include: { menu: { include: { recipes: true } } } } } },
                },
            },
        },
    })

    const menus = await sellableMenus()
    const index = componentIndex(menus)
    const byMenuId = new Map(menus.map((m) => [m.menuId, m]))
    const had: Returnable[] = []

    for (const order of orders) {
        for (const item of order.items) {
            if (item.voidedAt || !item.variationSizeId) continue
            const menu = item.variationSize?.variation?.menu
            if (!menu) continue

            const contents = contentsOf(
                menu.recipes.map((r) => ({ ingredientId: r.ingredientId, quantity: r.quantity })),
                index,
            ).map((c) => ({ ...c, quantity: c.quantity * item.quantity }))

            if (contents.length > 0) {
                // A package: what it delivers now, exchanges included.
                const live = item.swaps.filter((s) => !s.reversedAt)
                const removed = live.flatMap((s) =>
                    s.lines.filter((l) => l.direction === 'OUT' && l.menuId)
                        .map((l) => ({ menuId: l.menuId as string, quantity: l.quantity })))
                const added = live.flatMap((s) =>
                    s.lines.filter((l) => l.direction === 'IN' && l.menuId)
                        .map((l) => {
                            const sellable = byMenuId.get(l.menuId as string)
                            return {
                                menuId: l.menuId as string,
                                variationSizeId: sellable?.variationSizeId ?? l.variationSizeId,
                                name: sellable?.name ?? l.name,
                                localName: sellable?.localName ?? null,
                                unitPrice: sellable?.unitPrice ?? l.unitPrice,
                                quantity: l.quantity,
                            }
                        }))
                for (const c of remainingContents(contents, removed, added)) {
                    had.push({
                        menuId: c.menuId, variationSizeId: c.variationSizeId,
                        name: c.name, localName: c.localName, quantity: c.quantity,
                    })
                }
                continue
            }

            // A plain drink, returnable only if the bar sells it singly - which
            // is also the only way its stock knows how to come back.
            const sellable = menus.find((m) => m.variationSizeId === item.variationSizeId)
            if (!sellable || sellable.recipe.length !== 1) continue
            had.push({
                menuId: sellable.menuId,
                variationSizeId: sellable.variationSizeId,
                name: sellable.name,
                localName: sellable.localName ?? null,
                quantity: item.quantity,
            })
        }
    }

    return { had, menus }
}

/** What earlier counts on this bill already took back. */
async function alreadyReturned(sessionId: string) {
    const rows = await prisma.stockTransaction.findMany({
        where: { type: RETURN_TYPE, notes: { contains: sessionId } },
    })
    // The menuId is stamped in `reason` so a second visit to the screen can net
    // against it without a table of its own.
    return rows.map((r) => ({ menuId: r.reason ?? '', quantity: r.quantity }))
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const user = await getSessionUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const { had } = await servedBy(id)
        return NextResponse.json({ items: returnable(had, await alreadyReturned(id)) })
    } catch (error) {
        console.error('[returns] GET failed', error)
        return NextResponse.json({ error: 'Failed to load returnable items' }, { status: 500 })
    }
}

/**
 * Record the unopened count (req #10).
 *
 * Stock goes back; the bill does not move. The customer bought the package and
 * paid for it - what they did not open returns to the fridge to be sold again,
 * which is the whole economics of selling a set.
 *
 * No manager approval, matching the exchange screen and for the same reason:
 * it happens while tables are being cleared and a PIN would be worked around
 * within a week. Every row names who counted it.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const user = await getSessionUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const openShift = await prisma.shift.findFirst({ where: { status: 'OPEN' } })
        const shiftCheck = requireOpenShift(openShift)
        if (!shiftCheck.ok) {
            return NextResponse.json({ error: shiftCheck.reason }, { status: 409 })
        }

        // A settled bill still takes returns, but only tonight's. Bottles turn
        // up when the table is cleared, which is after the customer has paid -
        // refusing a closed bill outright would leave staff with no way to
        // record them at all. Last week's bill is a different matter: its
        // drawer is counted and its stock has been signed off, so the same
        // rule reopen and refund use applies here.
        const session = await prisma.tableSession.findUnique({
            where: { id },
            select: { status: true, orders: { select: { shiftId: true } } },
        })
        if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
        if (session.status === 'CLOSED') {
            const billShiftId = session.orders.find((o) => o.shiftId)?.shiftId ?? null
            if (!billShiftId || billShiftId !== openShift?.id) {
                return NextResponse.json({ error: 'RETURN_OTHER_SHIFT' }, { status: 409 })
            }
        }

        const body = await request.json()
        const returning: { menuId: string; quantity: number }[] =
            Array.isArray(body.items) ? body.items : []

        const { had } = await servedBy(id)
        const available = returnable(had, await alreadyReturned(id))
        const check = canReturn(available, returning)
        if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 409 })

        await prisma.$transaction(async (tx) => {
            for (const line of returning) {
                const item = available.find((a) => a.menuId === line.menuId)!
                if (!item.variationSizeId) continue

                const vs = await tx.variationSize.findUnique({
                    where: { id: item.variationSizeId },
                    include: { variation: { include: { menu: true } } },
                })
                if (!vs?.variation?.menu) continue

                const recipes = await tx.recipe.findMany({
                    where: {
                        OR: [
                            { menuId: vs.variation.menu.id, variationSizeId: null },
                            { variationSizeId: item.variationSizeId },
                        ],
                    },
                })
                for (const recipe of recipes) {
                    // Negative decrement: the same rounded path a sale takes.
                    await decrementStock(tx, recipe.ingredientId, -(recipe.quantity * line.quantity))
                }

                // Exactly one row per returned line, whatever the recipe holds.
                // The netting above counts these rows, so writing one per
                // ingredient would make a two-ingredient drink look twice
                // returned and quietly halve the cap on the next visit.
                if (recipes.length > 0) {
                    await tx.stockTransaction.create({
                        data: {
                            ingredientId: recipes[0].ingredientId,
                            type: RETURN_TYPE,
                            quantity: line.quantity,
                            toStore: 'SUB',
                            reason: line.menuId,
                            notes: `${id} · ${item.name}`,
                            userId: user.id,
                        },
                    })
                }
            }
        })

        const { had: after } = await servedBy(id)
        return NextResponse.json({
            items: returnable(after, await alreadyReturned(id)),
            returned: returning.reduce((n, l) => n + l.quantity, 0),
        })
    } catch (error) {
        console.error('[returns] POST failed', error)
        return NextResponse.json({ error: 'Failed to record return' }, { status: 500 })
    }
}
