import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getSessionUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * Who is signed in, as the database sees them.
 *
 * This used to trust the cookie's contents verbatim, which let a session
 * outlive the user in it: the middleware only checks that the cookie EXISTS,
 * so a deleted or deactivated staff member kept a session that rendered every
 * page while every endpoint resolving a real user returned 401. Confusing to
 * hit and impossible to diagnose from the screen - the till just looked broken.
 *
 * Resolving the user here and clearing a cookie that no longer names anyone
 * makes the session self-heal: the next navigation finds no cookie and the
 * middleware sends them to the PIN screen, which is the honest outcome.
 */
export async function GET() {
    try {
        const user = await getSessionUser()

        if (!user) {
            const store = await cookies()
            if (store.get('pos_session')) store.delete('pos_session')
            return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
        }

        return NextResponse.json({ user })
    } catch (error) {
        console.error('[auth/me] failed', error)
        return NextResponse.json({ error: 'Failed to process session' }, { status: 500 })
    }
}
