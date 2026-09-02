import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'

export async function POST() {
    // One unauthenticated POST used to delete every order, sale and shift, with
    // no confirmation and no backup to restore from.
    const gate = await requireAdmin()
    if (gate instanceof Response) return gate

    try {
        // Danger zone: Wipe orders, order items, shifts, etc.
        // We keep users, menu products, and ingredients.

        await prisma.orderItem.deleteMany({})
        await prisma.order.deleteMany({})
        await prisma.shift.deleteMany({})

        // Reset stock to initial if needed? 
        // For now just wipe transactions.

        return NextResponse.json({ success: true, message: "System wiped successfully" })
    } catch (e) {
        console.error(e)
        return NextResponse.json({ error: "Failed to wipe system" }, { status: 500 })
    }
}
