import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { requireAdmin } from '@/lib/auth'

export async function GET() {
    // The username list is half of a PIN brute force -- 4 digits and a known
    // username is 10,000 guesses. Only /api/auth/users (the login picker) is
    // meant to be reachable without a session.
    const gate = await requireAdmin()
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

export async function POST(request: Request) {
    // role came straight from the request body, so anyone could POST
    // { role: "ADMIN" } and mint themselves a permanent backdoor.
    const gate = await requireAdmin()
    if (gate instanceof Response) return gate

    try {
        const body = await request.json()
        const { name, username, role, pin, isActive } = body

        if (!name || !username || !role || !pin) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        const existing = await prisma.user.findUnique({
            where: { username }
        })

        if (existing) {
            return NextResponse.json({ error: 'Username already exists' }, { status: 400 })
        }

        const hashedPin = await bcrypt.hash(pin, 10)

        const user = await prisma.user.create({
            data: {
                name,
                username,
                role,
                pin: hashedPin,
                isActive
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
