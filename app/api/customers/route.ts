import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url)
        const query = searchParams.get('q')

        let customers

        if (query) {
            customers = await prisma.customer.findMany({
                where: {
                    OR: [
                        { name: { contains: query } },
                        { phone: { contains: query } },
                        { email: { contains: query } }
                    ]
                }
            })
        } else {
            customers = await prisma.customer.findMany({
                orderBy: { createdAt: 'desc' },
                take: 50
            })
        }

        return NextResponse.json(customers)
    } catch (error) {
        return NextResponse.json({ error: 'Failed to fetch customers' }, { status: 500 })
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json()
        const { name, phone, email, dateOfBirth } = body

        if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })

        const customer = await prisma.customer.create({
            data: {
                name,
                phone,
                email,
                dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null
            }
        })

        return NextResponse.json(customer, { status: 201 })
    } catch (error) {
        console.error(error)
        return NextResponse.json({ error: 'Failed to create customer' }, { status: 500 })
    }
}
