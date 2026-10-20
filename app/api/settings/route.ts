import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'

export async function GET() {
    try {
        const settingsRaw = await prisma.setting.findMany()
        const settings: Record<string, string> = {}
        settingsRaw.forEach(s => {
            settings[s.key] = s.value
        })
        return NextResponse.json(settings)
    } catch (error) {
        return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 })
    }
}

export async function POST(request: Request) {
    try {
        // Settings now decide where the server sends every round (the docket
        // printer addresses), so writing them is for the people who can open
        // the Settings page: the owner and managers. Reading stays open - the
        // receipt page fetches the shop name and footer without signing in.
        const user = await getSessionUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        if (user.role !== 'ADMIN' && user.role !== 'MANAGER') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        const updates = await request.json()

        // Use a transaction for multiple updates
        await prisma.$transaction(
            Object.entries(updates).map(([key, value]) =>
                prisma.setting.upsert({
                    where: { key },
                    update: { value: String(value) },
                    create: { key, value: String(value) }
                })
            )
        )

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error("Settings Update Error:", error)
        return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 })
    }
}
