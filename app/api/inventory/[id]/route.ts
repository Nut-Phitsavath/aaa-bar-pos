import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { canEditUnits } from '@/lib/ingredient-form'
import { BASE_UNIT, type MeasureType } from '@/lib/units'

// Inventory ID API routes

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const user = await getSessionUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const body = await request.json()
        const { name, unit, measureType, purchaseUnit, purchaseMultiplier,
                mainStock, subStock, minStock, maxStock, minStockSub, maxStockSub, cost } = body

        const existing = await prisma.ingredient.findUnique({ where: { id } })
        if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

        // Only guard when the conversion is actually being changed. Renaming an
        // ingredient must not be blocked because it has history.
        const changingUnits =
            (measureType !== undefined && measureType !== existing.measureType) ||
            (purchaseUnit !== undefined && purchaseUnit !== existing.purchaseUnit) ||
            (purchaseMultiplier !== undefined && Number(purchaseMultiplier) !== existing.purchaseMultiplier)

        if (changingUnits) {
            // A movement row, not a non-zero balance: an ingredient received
            // and fully consumed is back at zero and must stay locked.
            const hasMovements = (await prisma.stockTransaction.count({
                where: { ingredientId: id },
            })) > 0
            const check = canEditUnits({ hasMovements, role: user.role })
            if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 409 })
        }

        const mt: MeasureType = ['WEIGHT', 'VOLUME', 'EACH'].includes(measureType)
            ? measureType
            : (existing.measureType as MeasureType)
        const multiplier = mt === 'EACH' ? 1 : Number(purchaseMultiplier ?? existing.purchaseMultiplier)
        if (!Number.isFinite(multiplier) || multiplier <= 0) {
            return NextResponse.json({ error: 'MULTIPLIER_MUST_BE_POSITIVE' }, { status: 400 })
        }

        const updatedData = {
            name,
            unit,
            measureType: mt,
            // Derived from the measure type, never taken from the client - the
            // one place a base unit is decided is the measure type.
            baseUnit: BASE_UNIT[mt],
            purchaseUnit: purchaseUnit ?? existing.purchaseUnit,
            purchaseMultiplier: multiplier,
            mainStock: parseFloat(mainStock?.toString() || "0"),
            subStock: parseFloat(subStock?.toString() || "0"),
            minStock: parseFloat(minStock?.toString() || "0"),
            maxStock: parseFloat(maxStock?.toString() || "0"),
            minStockSub: parseFloat(minStockSub?.toString() || "0"),
            maxStockSub: parseFloat(maxStockSub?.toString() || "0"),
            cost: parseFloat(cost?.toString() || "0"),
            categoryId: body.categoryId || null
        }

        const ingredient = await prisma.ingredient.update({
            where: { id },
            data: updatedData
        })

        return NextResponse.json({ success: true, ingredient })
    } catch (error) {
        console.error(error)
        return NextResponse.json({ error: 'Failed to update ingredient' }, { status: 500 })
    }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        await prisma.ingredient.delete({
            where: { id }
        })
        return NextResponse.json({ success: true })
    } catch (error) {
        console.error(error)
        return NextResponse.json({ error: 'Failed to delete ingredient' }, { status: 500 })
    }
}
