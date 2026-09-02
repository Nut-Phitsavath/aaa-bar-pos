import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { requireAdmin } from '@/lib/auth'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
    // Same hole as POST /api/users: role and pin came from the body, so this
    // could promote any account to ADMIN or reset anyone's PIN.
    const gate = await requireAdmin()
    if (gate instanceof Response) return gate

    try {
        const body = await request.json()
        const { name, username, role, pin, isActive } = body
        const { id } = await params

        if (!name || !username || !role) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        // Check if username already exists for a different user
        const existing = await prisma.user.findUnique({ where: { username } })
        if (existing && existing.id !== id) {
            return NextResponse.json({ error: 'Username already taken' }, { status: 400 })
        }

        let updateData: any = { name, username, role, isActive }
        if (pin && pin.length >= 4) {
            updateData.pin = await bcrypt.hash(pin, 10)
        }

        const user = await prisma.user.update({
            where: { id },
            data: updateData,
            select: { id: true, name: true, username: true, role: true, isActive: true }
        })

        return NextResponse.json(user)

    } catch (error) {
        console.error('User PUT Error:', error)
        return NextResponse.json({ error: 'Failed to update user' }, { status: 500 })
    }
}
