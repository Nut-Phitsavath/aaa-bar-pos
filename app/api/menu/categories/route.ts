import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
    try {
        const categories = await prisma.category.findMany({
            orderBy: { name: 'asc' }
        })
        return NextResponse.json(categories)
    } catch (error) {
        console.error(error)
        return NextResponse.json({ error: 'Failed to fetch categories' }, { status: 500 })
    }
}

export async function POST(request: Request) {
    try {
        const { name, hasSugarLevel, hasShotType } = await request.json()
        if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 })

        const category = await prisma.category.create({
            data: {
                name,
                hasSugarLevel: Boolean(hasSugarLevel),
                hasShotType: Boolean(hasShotType)
            }
        })

        return NextResponse.json(category, { status: 201 })
    } catch (error) {
        console.error(error)
        return NextResponse.json({ error: 'Failed to create category' }, { status: 500 })
    }
}
