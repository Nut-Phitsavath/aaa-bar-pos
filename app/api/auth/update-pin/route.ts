import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { requireAdmin } from '@/lib/auth'

export async function POST(request: Request) {
    try {
        // The owner, as the database sees them - not the role a cookie claims.
        const gate = await requireAdmin()
        if (gate instanceof Response) return gate

        const { role, newPin } = await request.json()
        if (!role || !newPin || newPin.length < 4) {
            return NextResponse.json({ error: 'Invalid data' }, { status: 400 })
        }

        const hashedPin = await bcrypt.hash(newPin, 10)

        // Update all users with that role
        await prisma.user.updateMany({
            where: { role },
            data: { pin: hashedPin }
        })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error(error)
        return NextResponse.json({ error: 'Failed to update PIN' }, { status: 500 })
    }
}
