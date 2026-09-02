import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sessionTotal } from '@/lib/sessions'

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

        return NextResponse.json({
            ...session,
            total: sessionTotal(session.orders)
        })
    } catch (error) {
        console.error('[table-sessions] GET failed', error)
        return NextResponse.json({ error: 'Failed to load session' }, { status: 500 })
    }
}
