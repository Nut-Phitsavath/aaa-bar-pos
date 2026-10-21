import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sessionTotal, sessionBillTotal } from '@/lib/sessions'
import { balanceOf, changeDue, discountAmount } from '@/lib/payments'
import { DEFAULT_RATE_LAK, DEFAULT_RATE_USD, billRates, taxRateOf } from '@/lib/currency'
import { outstandingForCustomer } from '@/lib/customer-tabs'
import { componentIndex, contentsOf } from '@/lib/packages'
import { sellableMenus } from '@/lib/packages-db'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params

        const session = await prisma.tableSession.findUnique({
            where: { id },
            include: {
                // Name the deal, so the bill screen can say which one is on.
                promotion: { select: { id: true, name: true, code: true } },
                // The other bills open at this table, so the till can say which
                // one it has open and hop to the sibling. Splitting leaves two
                // parties at one table, and until now the banner read plain
                // "T5" on both of them - a waiter could not tell which guests
                // they were about to charge.
                //
                // Id, status and openedAt only: the letter comes from the
                // opening order and the rest of this payload is already heavy.
                table: {
                    include: {
                        sessions: {
                            where: { status: { not: 'CLOSED' } },
                            orderBy: { openedAt: 'asc' },
                            select: { id: true, status: true, openedAt: true, createdAt: true, splitIndex: true },
                        },
                    },
                },
                orders: {
                    orderBy: { createdAt: 'asc' },
                    include: {
                        // The photo and category are not on the order line - they
                        // are snapshotted only as name and price - so join the
                        // menu item to fetch them. The customer display groups by
                        // category and shows the photo, exactly as it does for a
                        // walk-in cart.
                        items: {
                            include: {
                                // Who struck this line, so the ticket can say so
                                // without anyone opening the void report.
                                voidedBy: { select: { name: true } },
                                // What this package actually delivered, so the
                                // ticket and the printed bill can say so (req #9).
                                swaps: { include: { lines: true }, orderBy: { createdAt: "asc" } },
                                menu: {
                                    select: {
                                        image: true,
                                        localName: true,
                                        category: { select: { name: true } },
                                        // Enough to say whether this line is a
                                        // package with anything swappable in it.
                                        recipes: { select: { ingredientId: true, quantity: true } }
                                    }
                                }
                            }
                        },
                        // waiter is the server who took the order; user is the
                        // POS staff who keyed it. The printed bill names both.
                        waiter: { select: { id: true, name: true } },
                        user: { select: { id: true, name: true } }
                    }
                },
                payments: {
                    orderBy: { createdAt: 'asc' },
                    include: { user: { select: { id: true, name: true } } }
                },
                customer: { select: { id: true, name: true, phone: true } }
            }
        })

        if (!session) {
            return NextResponse.json({ error: 'Session not found' }, { status: 404 })
        }

        // An open bill quotes today's rates; a closed one re-reads the rates it
        // was settled at, forever - FX and VAT alike. Resolving this server-side
        // means no screen can render a closed bill at live rates (req #18).
        const settings = await prisma.setting.findMany({
            where: { key: { in: ['rate_lak', 'rate_usd', 'show_usd', 'taxRate', 'tax_rate'] } }
        })
        const valueOf = (key: string) => settings.find((s) => s.key === key)?.value
        const showUsd = valueOf('show_usd') === 'true'
        const live = (key: string, fallback: number) => {
            const parsed = Number(valueOf(key))
            return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
        }
        const { lak: fxRateLAK, usd: fxRateUSD, tax: taxRate } = billRates(session, {
            lak: live('rate_lak', DEFAULT_RATE_LAK),
            usd: live('rate_usd', DEFAULT_RATE_USD),
            tax: taxRateOf(valueOf('taxRate') ?? valueOf('tax_rate')),
        })

        // What this guest already owes on other nights. The till needs it
        // before the round is served, not after: a regular who is 20,000 down
        // is a conversation with the manager, and by settle time it is too late.
        const customerOwes = session.customerId
            ? (await outstandingForCustomer(session.customerId)).total
            : 0

        const gross = sessionTotal(session.orders)
        const total = sessionBillTotal(session)

        // Built once for the whole bill: which components a package holds is
        // the same question for every line on it.
        const sellableIndex = componentIndex(await sellableMenus())

        // Flatten the menu lookup onto each line so no screen has to walk the
        // relation itself. A deleted menu item leaves menuId (and so item.menu)
        // null, and the line still renders from its snapshotted name and price.
        const orders = session.orders.map((order) => ({
            ...order,
            items: order.items.map((item) => {
                const { menu, ...line } = item
                return {
                    ...line,
                    image: menu?.image ?? null,
                    localName: menu?.localName ?? null,
                    category: menu?.category?.name ?? null,
                    // Whether the ticket offers an Exchange button on this line.
                    // Derived rather than keyed off a category name, so renaming
                    // "Sets" cannot silently remove the feature from the floor.
                    swappable: contentsOf(menu?.recipes ?? [], sellableIndex).length > 0
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
            // The promotion, and then the manual discount on what is left.
            //
            // Computed off the post-promo base, not the gross. Taking the
            // manager's percentage off the full amount while the total is
            // priced after the promo would leave the bill screen showing three
            // numbers that do not add up - which on a settle screen is the
            // moment a customer stops trusting the till.
            promoId: session.promoId,
            promoName: session.promotion?.name ?? null,
            promoDiscount: session.promoDiscount ?? 0,
            discount: discountAmount(
                Math.max(0, gross - (session.promoDiscount ?? 0)),
                session.discountType,
                session.discountValue
            ),
            total,
            // Derived here so the screen and the settle endpoint can never
            // disagree about whether this bill is paid.
            balance: balanceOf(total, session.payments),
            changeDue: changeDue(total, session.payments),
            fxRateLAK,
            fxRateUSD,
            taxRate,
            showUsd,
            customerOwes
        })
    } catch (error) {
        console.error('[table-sessions] GET failed', error)
        return NextResponse.json({ error: 'Failed to load session' }, { status: 500 })
    }
}
