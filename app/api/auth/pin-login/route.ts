import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { cookieSecure } from '@/lib/cookie-scope'
import { cookies } from 'next/headers'
import { SESSION_COOKIE, sessionSecret, signSession } from '@/lib/session'

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

        // A session only this server can write - see lib/session.
        const secret = sessionSecret()
        if (!secret) {
            console.error('[pin-login] SESSION_SECRET is missing from .env; nobody can sign in until it is set')
            return NextResponse.json({ error: 'This POS is not set up for sign-in yet (SESSION_SECRET is missing).' }, { status: 500 })
        }
        const cookieStore = await cookies()
        cookieStore.set(SESSION_COOKIE, signSession({ id: user.id, role: user.role }, secret), {
            httpOnly: true,
            secure: cookieSecure(request),
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
