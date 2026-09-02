import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { cookies } from 'next/headers'

export async function POST(request: Request) {
    try {
        const cookieStore = await cookies()
        const session = cookieStore.get('pos_session')
        if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const user = JSON.parse(session.value)
        if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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
