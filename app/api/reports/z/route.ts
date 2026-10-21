import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { buildZ } from '@/lib/z-report'

export const dynamic = 'force-dynamic'

/**
 * The Z-report for one shift (requirement #25): GET /api/reports/z?shift=<id>.
 *
 * Without ?shift it is the open shift - the X reading, live and not final - or
 * the last one closed. The window is the shift's own, opened to closed (or to
 * now), the way SambaPOS reports a work period. It used to be a calendar day
 * in UTC, which started the bar's day at 07:00 and split a night in two. The
 * money itself is added up in lib/z-report.ts.
 */
export async function GET(request: Request) {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    try {
        const id = new URL(request.url).searchParams.get('shift')
        const shift = id
            ? await prisma.shift.findUnique({ where: { id }, include: { user: { select: { name: true } } } })
            : (await prisma.shift.findFirst({ where: { status: 'OPEN' }, include: { user: { select: { name: true } } } }))
              ?? (await prisma.shift.findFirst({ orderBy: { startTime: 'desc' }, include: { user: { select: { name: true } } } }))
        if (!shift) return NextResponse.json({ error: 'No shift found' }, { status: 404 })

        const live = shift.status === 'OPEN'
        const start = shift.startTime
        const end = shift.endTime ?? new Date()
        const window = { gte: start, lte: end }

        const [sessions, walkIns, refunds] = await Promise.all([
            // Bills closed in the shift, plus tabs from earlier nights that
            // were collected on in it - the money arrived either way.
            prisma.tableSession.findMany({
                where: { OR: [{ closedAt: window }, { payments: { some: { createdAt: window } } }] },
                include: {
                    table: { select: { name: true } },
                    customer: { select: { name: true } },
                    orders: { select: { status: true, total: true, tax: true, items: { select: { total: true, voidedAt: true } } } },
                    payments: true,
                },
            }),
            prisma.order.findMany({
                where: { sessionId: null, status: 'COMPLETED', isReportable: true, createdAt: window },
                select: { total: true, tax: true, paymentMethod: true, items: { select: { total: true, voidedAt: true } } },
            }),
            // Money handed back, dated by the refund: a bill settled last
            // night and refunded tonight leaves tonight's drawer.
            prisma.payment.findMany({ where: { voidedAt: window }, select: { amount: true } }),
        ])

        const z = buildZ({ sessions, walkIns, refunds, start, end })

        return NextResponse.json({
            ...z,
            live,
            shift: {
                id: shift.id,
                status: shift.status,
                startTime: shift.startTime,
                endTime: shift.endTime,
                startCash: shift.startCash,
                actualCash: shift.actualCash,
                difference: shift.difference,
                openedBy: shift.user?.name ?? null,
                responsiblePerson: shift.responsiblePerson,
            },
            // A closed shift prints what the manager signed for at close; an
            // open one, the float plus the cash taken so far.
            expectedCash: !live && shift.endCash != null ? shift.endCash : shift.startCash + z.cashTaken,
        })
    } catch (error) {
        console.error('[z-report] GET failed', error)
        return NextResponse.json({ error: 'Failed to build report' }, { status: 500 })
    }
}
