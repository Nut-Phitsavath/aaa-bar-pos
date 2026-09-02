import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sessionTotal } from '@/lib/sessions'
import { balanceOf, changeDue, billTotalOf, discountAmount } from '@/lib/payments'
import { DEFAULT_RATE_LAK, DEFAULT_RATE_USD } from '@/lib/currency'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params

        const session = await prisma.tableSession.findUnique({
            where: { id },
            include: {
                table: true,
                orders: {
                    orderBy: { createdAt: 'asc' },
                    include: {
                        // The photo and category are not on the order line - they
                        // are snapshotted only as name and price - so walk the
                        // relation to fetch them. The customer display groups by
                        // category and shows the photo, exactly as it does for a
                        // walk-in cart.
                        items: {
                            include: {
                                variationSize: {
                                    include: {
                                        variation: {
                                            include: {
                                                menu: {
                                                    select: {
                                                        image: true,
                                                        localName: true,
                                                        category: { select: { name: true } }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        },
                        waiter: { select: { id: true, name: true } }
                    }
                },
                payments: {
                    orderBy: { createdAt: 'asc' },
                    include: { user: { select: { id: true, name: true } } }
                }
            }
        })

        if (!session) {
            return NextResponse.json({ error: 'Session not found' }, { status: 404 })
        }

        // An open bill quotes today's rate; a closed one re-reads the rate it
        // was settled at, forever. Resolving this server-side means no screen
        // can accidentally render a closed bill at the live rate (req #18).
        let fxRateLAK = session.fxRateLAK
        let fxRateUSD = session.fxRateUSD
        let showUsd = false

        const settings = await prisma.setting.findMany({
            where: { key: { in: ['rate_lak', 'rate_usd', 'show_usd'] } }
        })
        const valueOf = (key: string) => settings.find((s) => s.key === key)?.value
        showUsd = valueOf('show_usd') === 'true'

        if (session.status !== 'CLOSED') {
            const live = (key: string, fallback: number) => {
                const parsed = Number(valueOf(key))
                return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
            }
            fxRateLAK = live('rate_lak', DEFAULT_RATE_LAK)
            fxRateUSD = live('rate_usd', DEFAULT_RATE_USD)
        }

        const gross = sessionTotal(session.orders)
        const total = billTotalOf(gross, session.discountType, session.discountValue)

        // Flatten the menu lookup onto each line so no screen has to walk the
        // relation itself. A deleted menu item leaves variationSize null, and
        // the line still renders from its snapshotted name and price.
        const orders = session.orders.map((order) => ({
            ...order,
            items: order.items.map((item) => {
                const menu = item.variationSize?.variation?.menu
                const { variationSize, ...line } = item
                return {
                    ...line,
                    image: menu?.image ?? null,
                    localName: menu?.localName ?? null,
                    category: menu?.category?.name ?? null
                }
            })
        }))

        return NextResponse.json({
            ...session,
            orders,
            // gross is what the rounds add up to; total is what the customer
            // owes after any discount. The bill screen shows both so a
            // reduction is visible rather than silently baked into one figure.
            gross,
            discount: discountAmount(gross, session.discountType, session.discountValue),
            total,
            // Derived here so the screen and the settle endpoint can never
            // disagree about whether this bill is paid.
            balance: balanceOf(total, session.payments),
            changeDue: changeDue(total, session.payments),
            fxRateLAK,
            fxRateUSD,
            showUsd
        })
    } catch (error) {
        console.error('[table-sessions] GET failed', error)
        return NextResponse.json({ error: 'Failed to load session' }, { status: 500 })
    }
}
