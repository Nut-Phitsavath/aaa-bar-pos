import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'

export async function GET(request: Request) {
    try {
        const stockCounts = await prisma.stockCount.findMany({
            include: {
                ingredient: { select: { name: true, unit: true } }
            },
            orderBy: { createdAt: 'desc' },
            take: 50
        })
        return NextResponse.json(stockCounts)
    } catch (error) {
        console.error(error)
        return NextResponse.json({ error: 'Failed to fetch stock counts' }, { status: 500 })
    }
}

/**
 * Submit a stock count (requirement #22, the half that was missing).
 *
 * Takes the whole sheet at once. It used to take one ingredient per call, which
 * made a 24-line count 24 requests and 24 separate transactions - so a tablet
 * that lost the bar's wifi halfway through left the shelf half-corrected, with
 * a variance report showing a count that never finished and no way to tell
 * which half landed. A stocktake is one pass of the shelf; it commits or it
 * doesn't.
 *
 * `theoreticalStock` is read HERE, not accepted from the client. The sheet is
 * printed, someone walks the room, and the numbers get typed in twenty minutes
 * later - by which time the bar has sold things and the client's figure is
 * stale. Booking an adjustment against a stale baseline would silently move the
 * shelf by the difference between two moments rather than to the counted
 * figure. What the counter wrote down is the truth about the shelf; what the
 * system thought is whatever it thinks at the instant we write.
 *
 * Quantities arrive in BASE units. The screen converts from bottles and cans on
 * the way in, the same as every other stock entry in the app.
 */
export async function POST(request: Request) {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    try {
        const body = await request.json()

        // One shape, always a list. A single-line count is a list of one.
        const counts: unknown = body?.counts
        if (!Array.isArray(counts) || counts.length === 0) {
            return NextResponse.json({ error: 'NO_COUNTS' }, { status: 400 })
        }

        // A count of zero is a real and serious reading - the shelf is empty -
        // so it has to survive validation that a missing value must not. The
        // screen never sends a blank line, and this is the backstop.
        const clean: { ingredientId: string; actualStock: number; notes: string | null }[] = []
        for (const c of counts as any[]) {
            const qty = Number(c?.actualStock)
            if (!c?.ingredientId || typeof c.ingredientId !== 'string') {
                return NextResponse.json({ error: 'MISSING_INGREDIENT' }, { status: 400 })
            }
            if (!Number.isFinite(qty) || qty < 0) {
                return NextResponse.json({ error: 'INVALID_QUANTITY' }, { status: 400 })
            }
            clean.push({
                ingredientId: c.ingredientId,
                actualStock: qty,
                notes: typeof c.notes === 'string' && c.notes.trim() ? c.notes.trim() : null,
            })
        }

        // The same shelf counted twice on one sheet has no single answer, and
        // applying both would move stock twice.
        const ids = clean.map((c) => c.ingredientId)
        if (new Set(ids).size !== ids.length) {
            return NextResponse.json({ error: 'DUPLICATE_INGREDIENT' }, { status: 400 })
        }

        const result = await prisma.$transaction(async (tx) => {
            const ingredients = await tx.ingredient.findMany({
                where: { id: { in: ids } },
                select: { id: true, subStock: true },
            })
            if (ingredients.length !== ids.length) {
                throw new Error('UNKNOWN_INGREDIENT')
            }
            const shelf = new Map(ingredients.map((i) => [i.id, i.subStock]))

            const written = []
            for (const c of clean) {
                const theoretical = shelf.get(c.ingredientId)!
                const difference = c.actualStock - theoretical

                const count = await tx.stockCount.create({
                    data: {
                        ingredientId: c.ingredientId,
                        theoreticalStock: theoretical,
                        actualStock: c.actualStock,
                        difference,
                        notes: c.notes,
                        userId: user.id,
                    },
                })
                written.push(count)

                // A line that agreed is still worth recording - it is how you
                // know the shelf was looked at - but it moves nothing.
                if (difference !== 0) {
                    await tx.stockTransaction.create({
                        data: {
                            ingredientId: c.ingredientId,
                            type: 'SHOP_ADJUST',
                            quantity: difference,
                            toStore: 'SUB',
                            userId: user.id,
                            // A counted shelf is not a guess about why. The
                            // reason a bottle is missing is what the variance
                            // report exists to make someone go and find out.
                            reason: 'COUNTING_ERROR',
                            notes: `Stock count: system ${theoretical}, counted ${c.actualStock}${c.notes ? ` — ${c.notes}` : ''}`,
                        },
                    })

                    // subStock is the shop shelf. Set, not increment: what the
                    // counter wrote down IS the shelf, and the theoretical it
                    // is measured against was read inside this transaction a
                    // moment ago.
                    //
                    // ponytail: assumes the count is typed in close to when it
                    // was walked, which at this bar means at close with the
                    // doors shut. A round sold BETWEEN the fridge and the
                    // keyboard is written back onto the shelf by this. Fixing it
                    // properly means the sheet carrying the moment it was
                    // counted and replaying sales since - do that if counting
                    // ever moves to mid-service.
                    await tx.ingredient.update({
                        where: { id: c.ingredientId },
                        data: { subStock: c.actualStock },
                    })
                }
            }
            return written
        })

        const discrepancies = result.filter((r) => r.difference !== 0).length
        return NextResponse.json({
            counted: result.length,
            discrepancies,
            countedAt: result[0]?.createdAt ?? new Date(),
        })
    } catch (error: any) {
        if (error?.message === 'UNKNOWN_INGREDIENT') {
            return NextResponse.json({ error: 'UNKNOWN_INGREDIENT' }, { status: 400 })
        }
        console.error('[stock-count] POST failed', error)
        return NextResponse.json({ error: 'Failed to submit stock count' }, { status: 500 })
    }
}
