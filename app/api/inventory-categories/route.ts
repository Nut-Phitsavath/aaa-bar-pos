import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
    try {
        const categories = await prisma.ingredientCategory.findMany({
            include: {
                _count: {
                    select: { ingredients: true }
                }
            },
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
        const { name } = await request.json()
        if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })

        const category = await prisma.ingredientCategory.create({
            data: { name }
        })
        return NextResponse.json(category)
    } catch (error) {
        console.error(error)
        return NextResponse.json({ error: 'Failed to create category' }, { status: 500 })
    }
}
