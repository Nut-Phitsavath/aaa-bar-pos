import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { outstandingForCustomer } from '@/lib/customer-tabs'

export const dynamic = 'force-dynamic'

/**
 * Say whose table this is - or create the customer on the spot.
 *
 * Creating inline matters more than it looks. Without it, a new face wanting a
 * tab at 1am means abandoning the till, going to Users, making a record and
 * starting over; what actually happens then is the tab gets put on whichever
 * name is already in the list, and the ledger stops meaning anything.
 *
 * Matching is on phone number, not name. "Somsak" is half the room; the number
 * is the only thing that reliably identifies a person, and two records for one
 * customer splits their debt in two.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const { customerId, name, phone } = await request.json()

        const user = await getSessionUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const session = await prisma.tableSession.findUnique({ where: { id } })
        if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

        // Detaching is allowed: a table can be handed to someone else, or the
        // name can simply have been wrong.
        if (customerId === null && !name) {
            const updated = await prisma.tableSession.update({
                where: { id },
                data: { customerId: null },
            })
            return NextResponse.json({ session: updated, customer: null, outstanding: 0 })
        }

        let resolvedId: string | null = customerId ?? null

        if (!resolvedId && name) {
            const trimmedPhone = (phone || '').trim()
            // Reuse a record before making a second one for the same person.
            const existing = trimmedPhone
                ? await prisma.customer.findFirst({ where: { phone: trimmedPhone } })
                : null

            resolvedId = existing
                ? existing.id
                : (await prisma.customer.create({
                    data: { name: String(name).trim(), phone: trimmedPhone || null, type: 'VIP' },
                })).id
        }

        if (!resolvedId) {
            return NextResponse.json({ error: 'CUSTOMER_REQUIRED' }, { status: 400 })
        }

        const customer = await prisma.customer.findUnique({ where: { id: resolvedId } })
        if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

        const updated = await prisma.tableSession.update({
            where: { id },
            data: { customerId: resolvedId },
        })

        // Hand back what they already owe, so the screen that attached them can
        // say so immediately rather than waiting for a poll.
        const { total } = await outstandingForCustomer(resolvedId)

        return NextResponse.json({
            session: updated,
            customer: { id: customer.id, name: customer.name, phone: customer.phone },
            outstanding: total,
        })
    } catch (error) {
        console.error('[session customer] PUT failed', error)
        return NextResponse.json({ error: 'Failed to set customer' }, { status: 500 })
    }
}
