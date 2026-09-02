import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sessionTotal } from '@/lib/sessions'
import { DEFAULT_RATE_LAK, DEFAULT_RATE_USD } from '@/lib/currency'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params

        const session = await prisma.tableSession.findUnique({
            where: { id },
            include: {
                table: true,
                orders: {
                    orderBy: { createdAt: 'asc' },
                    include: {
                        items: true,
                        waiter: { select: { id: true, name: true } }
                    }
                }
            }
        })

        if (!session) {
            return NextResponse.json({ error: 'Session not found' }, { status: 404 })
        }

        // An open bill quotes today's rate; a closed one re-reads the rate it
        // was settled at, forever. Resolving this server-side means no screen
        // can accidentally render a closed bill at the live rate (req #18).
        let fxRateLAK = session.fxRateLAK
        let fxRateUSD = session.fxRateUSD
        let showUsd = false

        const settings = await prisma.setting.findMany({
            where: { key: { in: ['rate_lak', 'rate_usd', 'show_usd'] } }
        })
        const valueOf = (key: string) => settings.find((s) => s.key === key)?.value
        showUsd = valueOf('show_usd') === 'true'

        if (session.status !== 'CLOSED') {
            const live = (key: string, fallback: number) => {
                const parsed = Number(valueOf(key))
                return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
            }
            fxRateLAK = live('rate_lak', DEFAULT_RATE_LAK)
            fxRateUSD = live('rate_usd', DEFAULT_RATE_USD)
        }

        return NextResponse.json({
            ...session,
            total: sessionTotal(session.orders),
            fxRateLAK,
            fxRateUSD,
            showUsd
        })
    } catch (error) {
        console.error('[table-sessions] GET failed', error)
        return NextResponse.json({ error: 'Failed to load session' }, { status: 500 })
    }
}
