import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

export async function GET() {
    try {
        const cookieStore = await cookies()
        const sessionCookie = cookieStore.get('pos_session')

        if (!sessionCookie) {
            return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
        }

        const user = JSON.parse(sessionCookie.value)

        return NextResponse.json({ user })
    } catch (error) {
        return NextResponse.json({ error: 'Failed to process session' }, { status: 500 })
    }
}
