import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { cookies } from 'next/headers'

export async function POST(request: Request) {
    try {
        const { pin, username } = await request.json()

        if (!pin || pin.length < 4) {
            return NextResponse.json({ error: 'Invalid PIN' }, { status: 400 })
        }

        if (!username) {
            return NextResponse.json({ error: 'Username is required' }, { status: 400 })
        }

        const user = await prisma.user.findUnique({
            where: {
                username: username
            }
        })

        if (!user || !user.isActive) {
            return NextResponse.json({ error: 'Invalid User' }, { status: 401 })
        }

        const isMatch = await bcrypt.compare(pin, user.pin)

        if (!isMatch) {
            return NextResponse.json({ error: 'Invalid PIN for this user' }, { status: 401 })
        }

        // Create session
        const cookieStore = await cookies()
        const sessionData = {
            id: user.id,
            name: user.name,
            username: user.username,
            role: user.role
        }

        cookieStore.set('pos_session', JSON.stringify(sessionData), {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 60 * 60 * 24 // 24 hours
        })

        return NextResponse.json({
            user: {
                id: user.id,
                name: user.name,
                username: user.username,
                role: user.role
            }
        })
    } catch (error) {
        console.error(error)
        return NextResponse.json({ error: 'Authentication failed' }, { status: 500 })
    }
}
