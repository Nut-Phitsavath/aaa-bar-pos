import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { requireManager } from '@/lib/auth'
import { canManageUser, isRole, isTillRole, usernameFrom } from '@/lib/roles'

export async function GET() {
    // The username list is half of a PIN brute force -- 4 digits and a known
    // username is 10,000 guesses. Only /api/auth/users (the login picker) is
    // meant to be reachable without a session.
    //
    // A manager reads it because they run the staff screen; who they may EDIT
    // is a narrower question, answered per row by canManageUser.
    const gate = await requireManager()
    if (gate instanceof Response) return gate

    try {
        const users = await prisma.user.findMany({
            orderBy: { name: 'asc' },
            select: {
                id: true,
                name: true,
                username: true,
                role: true,
                isActive: true,
                createdAt: true
            }
        })
        return NextResponse.json(users)
    } catch (error) {
        return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 })
    }
}

/**
 * A username nobody will type, that is still unique.
 *
 * Servers are created by first name in a small bar, so a second Nok is a
 * matter of time; the row must not fail to save because of a collision in a
 * field the person will never see.
 */
async function freeUsername(name: string): Promise<string> {
    const base = usernameFrom(name)
    for (let n = 0; n < 50; n++) {
        const candidate = n === 0 ? base : `${base}${n + 1}`
        const taken = await prisma.user.findUnique({ where: { username: candidate } })
        if (!taken) return candidate
    }
    return `${base}-${crypto.randomUUID().slice(0, 6)}`
}

export async function POST(request: Request) {
    // role came straight from the request body, so anyone could POST
    // { role: "ADMIN" } and mint themselves a permanent backdoor.
    const gate = await requireManager()
    if (gate instanceof Response) return gate

    try {
        const body = await request.json()
        const { name, role, isActive } = body

        if (!name || !isRole(role)) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }
        // A manager may add staff and servers, never an admin or another
        // manager: otherwise "managers can manage staff" quietly means "a
        // manager can promote themselves".
        if (!canManageUser(gate.role, role)) {
            return NextResponse.json({ error: 'ROLE_NOT_ALLOWED' }, { status: 403 })
        }

        // A server never signs in, so the screen never asks for a username or
        // a PIN and neither is sent. Both are generated here: the credential
        // that is never shown to anybody is the one that cannot be shared.
        const isTill = isTillRole(role)
        const username = isTill ? String(body.username || '').trim() : await freeUsername(name)
        const pin = isTill ? String(body.pin || '') : crypto.randomUUID()

        if (isTill && (!username || pin.length < 4)) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        const existing = await prisma.user.findUnique({ where: { username } })
        if (existing) {
            return NextResponse.json({ error: 'Username already exists' }, { status: 400 })
        }

        const user = await prisma.user.create({
            data: {
                name: String(name).trim(),
                username,
                role,
                pin: await bcrypt.hash(pin, 10),
                isActive: isActive ?? true
            },
            select: {
                id: true,
                name: true,
                username: true,
                role: true,
                isActive: true,
                createdAt: true
            }
        })

        return NextResponse.json(user)
    } catch (error) {
        console.error('User POST Error:', error)
        return NextResponse.json({ error: 'Failed to create user' }, { status: 500 })
    }
}
