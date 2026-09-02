import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { validatePromotionInput } from '@/lib/promotions'

export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const body = await request.json()
        const { name, description, code, discountType, isActive } = body

        const v = validatePromotionInput(body)
        if (!v.ok) {
            return NextResponse.json({ error: v.error }, { status: 400 })
        }

        await prisma.promotion.update({
            where: { id },
            data: {
                name,
                description,
                code,
                discountType,
                discountValue: v.value,
                startDate: v.start,
                endDate: v.end,
                isActive: isActive ?? true,
                staffPickable: v.staffPickable,
                minItems: v.minItems
            }
        })

        return NextResponse.json({ success: true })
    } catch (error: any) {
        console.error(error)
        if (error.code === 'P2002') {
            return NextResponse.json({ error: 'Promo code already exists' }, { status: 400 })
        }
        return NextResponse.json({ error: 'Failed to update promotion' }, { status: 500 })
    }
}
