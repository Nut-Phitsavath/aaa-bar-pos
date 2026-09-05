import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { requireManager } from '@/lib/auth'
import { canManageUser, isRole, isTillRole } from '@/lib/roles'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
    // Same hole as POST /api/users: role and pin came from the body, so this
    // could promote any account to ADMIN or reset anyone's PIN.
    const gate = await requireManager()
    if (gate instanceof Response) return gate

    try {
        const body = await request.json()
        const { name, role, pin, isActive } = body
        const { id } = await params

        if (!name || !isRole(role)) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        const target = await prisma.user.findUnique({ where: { id }, select: { role: true, username: true } })
        if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 })

        // Both ends are checked: a manager may not edit an admin, and may not
        // turn someone they CAN edit into someone they could not.
        if (!canManageUser(gate.role, target.role) || !canManageUser(gate.role, role)) {
            return NextResponse.json({ error: 'ROLE_NOT_ALLOWED' }, { status: 403 })
        }

        const isTill = isTillRole(role)
        // A server's username is generated and never shown, so an edit leaves
        // it alone rather than blanking it.
        const username = isTill ? String(body.username || '').trim() : target.username

        if (isTill && !username) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        const existing = await prisma.user.findUnique({ where: { username } })
        if (existing && existing.id !== id) {
            return NextResponse.json({ error: 'Username already taken' }, { status: 400 })
        }

        const updateData: any = { name: String(name).trim(), username, role, isActive }
        if (isTill && pin && pin.length >= 4) {
            updateData.pin = await bcrypt.hash(pin, 10)
        }
        // Demoted to a server: the PIN they used to sign in with stops working
        // the moment the role says they no longer sign in.
        if (!isTill && isTillRole(target.role)) {
            updateData.pin = await bcrypt.hash(crypto.randomUUID(), 10)
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
