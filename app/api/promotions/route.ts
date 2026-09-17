import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { validatePromotionInput } from '@/lib/promotions'

export async function GET() {
    try {
        const promotions = await prisma.promotion.findMany({
            // The shelf a deal is scoped to, so the picker on the bill screen can
            // say "25% · Beer · needs 15+" instead of just a name.
            include: { category: { select: { id: true, name: true } } },
            orderBy: { createdAt: 'desc' }
        })
        return NextResponse.json(promotions)
    } catch (error) {
        // Was silent: a 500 here left nothing in the server log to debug from.
        console.error('Promotions GET error:', error)
        return NextResponse.json({ error: 'Failed to fetch promotions' }, { status: 500 })
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json()
        const { name, description, code, discountType, isActive } = body

        const v = validatePromotionInput(body)
        if (!v.ok) {
            return NextResponse.json({ error: v.error }, { status: 400 })
        }

        const promotion = await prisma.promotion.create({
            data: {
                name,
                description,
                code,
                discountType,
                discountValue: v.value,
                startDate: v.start,
                endDate: v.end,
                isActive: !!isActive,
                staffPickable: v.staffPickable,
                minItems: v.minItems,
                categoryId: v.categoryId
            }
        })

        return NextResponse.json(promotion)
    } catch (error: any) {
        console.error(error)
        if (error.code === 'P2002') {
            return NextResponse.json({ error: 'Promo code already exists' }, { status: 400 })
        }
        return NextResponse.json({ error: 'Failed to create promotion' }, { status: 500 })
    }
}
