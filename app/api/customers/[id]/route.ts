import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const body = await request.json()
        const { name, phone, email, dateOfBirth } = body

        const customer = await prisma.customer.update({
            where: { id },
            data: {
                name,
                phone,
                email,
                dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null
            }
        })

        return NextResponse.json({ success: true, customer })
    } catch (error) {
        console.error(error)
        return NextResponse.json({ error: 'Failed to update customer' }, { status: 500 })
    }
}
