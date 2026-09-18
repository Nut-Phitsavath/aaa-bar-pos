import type { MovingLine } from './table-ops'

type Executor = any

/** The fields a line needs before it can be divided or reparented. */
export type MovableLine = {
    id: string
    menuId: string | null
    name: string
    price: number
    quantity: number
    note: string | null
    sugarLevel: string | null
    shotType: string | null
    isTakeaway: boolean
}

/**
 * Put chosen drinks onto another order, dividing rows where only some of a
 * line is going.
 *
 * Shared by SPLIT (a new bill at the same table) and SEND (an existing bill at
 * another table), because the arithmetic is the same and it is money: two
 * copies would be two chances for the halves to stop adding up to what the
 * customer was originally quoted.
 *
 * A line going in full is REPARENTED rather than copied, so its id survives and
 * anything pointing at it - a package swap, a void stamp - still resolves. Only
 * a partial move creates a row, and then the original is reduced by exactly
 * what left.
 *
 * `total` is price x quantity on every line in the database, and the orders
 * route writes it that way, so dividing is exact arithmetic rather than a
 * proportion that could drift a satang.
 *
 * Nothing is re-priced and no stock moves: the drinks were poured either way.
 * What changes is which bill pays for them.
 *
 * Returns the ids of the lines that moved whole, because those are the ones
 * whose package swaps have to follow them to the new session.
 */
export async function placeLinesOnOrder(
    tx: Executor,
    moving: MovingLine[],
    byId: Map<string, MovableLine>,
    targetOrderId: string,
): Promise<string[]> {
    const wholeLines: string[] = []

    for (const pick of moving) {
        const line = byId.get(pick.itemId)
        if (!line) continue

        if (pick.quantity >= line.quantity) {
            wholeLines.push(pick.itemId)
            continue
        }

        const staying = line.quantity - pick.quantity
        await tx.orderItem.update({
            where: { id: pick.itemId },
            data: { quantity: staying, total: line.price * staying },
        })
        await tx.orderItem.create({
            data: {
                orderId: targetOrderId,
                menuId: line.menuId,
                // Snapshotted name and price, copied rather than re-read: the
                // new row is the same drink sold at the same moment for the
                // same money, and tomorrow's price rise must not reach it.
                name: line.name,
                price: line.price,
                quantity: pick.quantity,
                total: line.price * pick.quantity,
                note: line.note,
                sugarLevel: line.sugarLevel,
                shotType: line.shotType,
                isTakeaway: line.isTakeaway,
            },
        })
    }

    if (wholeLines.length > 0) {
        await tx.orderItem.updateMany({
            where: { id: { in: wholeLines } },
            data: { orderId: targetOrderId },
        })
    }

    return wholeLines
}
