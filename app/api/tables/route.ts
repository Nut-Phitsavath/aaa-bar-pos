import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireManager } from '@/lib/auth'
import { sessionTotal, BILLABLE_ORDER_STATUSES, sessionBillTotal } from '@/lib/sessions'
import { outstandingByCustomer } from '@/lib/customer-tabs'
import { parseMinSpend } from '@/lib/min-spend'
import { paidTotal } from '@/lib/payments'

// The floor plan polls this every 5s; it must never be served stale.
export const dynamic = 'force-dynamic'

export async function GET() {
    try {
        const tables = await prisma.table.findMany({
            where: { isActive: true },
            orderBy: [{ area: 'asc' }, { displayOrder: 'asc' }, { name: 'asc' }],
            include: {
                sessions: {
                    // Every open bill, not one of them. Splitting leaves two
                    // bills on one table (req #2), and `take: 1` meant the
                    // floor plan showed only the newer one - the other became
                    // unreachable until the first was settled.
                    where: { status: { not: 'CLOSED' } },
                    orderBy: { openedAt: 'asc' },
                    include: {
                        customer: { select: { id: true, name: true } },
                        orders: {
                            select: { status: true, total: true, waiterId: true }
                        },
                        // So the floor plan can say a table has started paying.
                        // PART_PAID already existed in lib/bills.ts and drove
                        // the reports; it never reached the room, so a table
                        // that had handed over 3,000 of 3,500 looked exactly
                        // like one that had paid nothing.
                        payments: true
                    }
                }
            }
        })

        // What each regular already owes, in one query rather than one per
        // table. This is the whole point of naming a table: the floor plan can
        // say "this person owes you money" while they are still in the room.
        const owedByCustomer = await outstandingByCustomer()

        const payload = tables.map((table) => {
            const sessions = table.sessions.map((session) => {
                const billable = session.orders.filter((o) =>
                    (BILLABLE_ORDER_STATUSES as readonly string[]).includes(o.status))

                return {
                    id: session.id,
                    status: session.status,
                    openedAt: session.openedAt.toISOString(),
                    // Distinguishes two bills that share an openedAt, so this
                    // screen and the till letter them the same way. See
                    // orderBills in lib/table-ops.
                    createdAt: session.createdAt.toISOString(),
                    // The letter saved at the split, which wins over working
                    // one out - see billLabel.
                    splitIndex: session.splitIndex,
                    orderCount: billable.length,
                    waiterCount: new Set(billable.map((o) => o.waiterId).filter(Boolean)).size,
                    // What they will actually pay, discount included.
                    total: sessionBillTotal(session),
                    // Confirmed tenders only: a customer scanning a QR is not
                    // the bank paying, and a table is not part paid because
                    // somebody opened their phone.
                    paid: paidTotal(session.payments),
                    // When the bill was asked for, so the floor plan can age it.
                    billRequestedAt: session.billRequestedAt?.toISOString() ?? null,
                    isOwnerVip: session.isOwnerVip,
                    customer: session.customer
                        ? {
                            id: session.customer.id,
                            name: session.customer.name,
                            owes: owedByCustomer.get(session.customer.id) ?? 0
                        }
                        : null
                }
            })

            return {
                id: table.id,
                name: table.name,
                area: table.area,
                seats: table.seats,
                displayOrder: table.displayOrder,
                // The room's floor, so the manage screen can show which rooms
                // carry one. Null on an ordinary table.
                minSpend: table.minSpend,
                // Settled but not yet cleared, and any booking held on it. The
                // floor plan resolves these into one state alongside the
                // sessions - see resolveTableState in lib/table-state.
                needsClearing: table.needsClearing,
                reservedFor: table.reservedFor,
                reservedAt: table.reservedAt?.toISOString() ?? null,
                sessions,
                // The oldest bill, which is the party who sat down. Kept so a
                // table with one bill - almost all of them - reads exactly as
                // it always did, and only the split case needs the array.
                session: sessions[0] ?? null
            }
        })

        return NextResponse.json(payload)
    } catch (error) {
        console.error('[tables] GET failed', error)
        return NextResponse.json({ error: 'Failed to load tables' }, { status: 500 })
    }
}

export async function POST(request: Request) {
    // The floor plan is read by every till all night, but changing it is a
    // manager's job. Until now these three handlers had no check at all, so
    // anything that could reach the host could rename or delete a table.
    const gate = await requireManager()
    if (gate instanceof Response) return gate

    try {
        const { name, area, seats, displayOrder, minSpend } = await request.json()

        if (!name || typeof name !== 'string' || !name.trim()) {
            return NextResponse.json({ error: 'Table name is required' }, { status: 400 })
        }

        const table = await prisma.table.create({
            data: {
                name: name.trim(),
                // Free text on purpose: the floor plan builds its filter tabs
                // from whatever areas the tables actually name, so a new one
                // appears as a new tab without a migration.
                area: String(area || 'INDOOR').trim().slice(0, 24) || 'INDOOR',
                seats: Number(seats) || 4,
                displayOrder: Number(displayOrder) || 0,
                minSpend: parseMinSpend(minSpend)
            }
        })

        return NextResponse.json(table)
    } catch (error) {
        console.error('[tables] POST failed', error)
        return NextResponse.json({ error: 'Failed to create table' }, { status: 500 })
    }
}
