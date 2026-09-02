import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

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
