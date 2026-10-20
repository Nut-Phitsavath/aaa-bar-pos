import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { onepayConfigured } from '@/lib/onepay'

export const dynamic = 'force-dynamic'

/**
 * Whether this server holds a BCEL OnePay account - so Settings can offer
 * OnePay for bills only when choosing it would work. Yes or no; never the
 * credentials themselves.
 */
export async function GET() {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    return NextResponse.json({ configured: onepayConfigured() })
}
