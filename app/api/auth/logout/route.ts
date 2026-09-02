import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

export async function POST() {
    const cookieStore = await cookies()
    // Assuming 'session' is the cookie name, or whatever Supabase uses.
    // For the demo login we created earlier, we might have set a cookie.
    // Let's delete generic auth cookies.
    cookieStore.delete('pos_session')
    cookieStore.delete('session')
    cookieStore.delete('sb-access-token')
    cookieStore.delete('sb-refresh-token')

    return NextResponse.json({ success: true })
}
