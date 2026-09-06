import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * Save an arrangement of the till's categories or of one category's items.
 *
 * Open to any signed-in till user, by decision: the person who knows Beer Lao
 * outsells everything is the one pouring it, and putting the menu layout behind
 * a manager means it never gets tidied. Nothing here touches money or stock -
 * the worst case is a menu in an odd order, fixed by dragging it back.
 *
 * The whole list arrives at once rather than one moved item, so the order in
 * the database is exactly the order on the screen. Sending "item X is now
 * third" leaves every other row's number to be inferred, and two tills doing
 * that at once produce an arrangement neither of them chose.
 */
export async function PUT(request: Request) {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    try {
        const { kind, ids } = await request.json()
        if (kind !== 'CATEGORY' && kind !== 'MENU') {
            return NextResponse.json({ error: 'UNKNOWN_KIND' }, { status: 400 })
        }
        if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== 'string')) {
            return NextResponse.json({ error: 'INVALID_ORDER' }, { status: 400 })
        }
        // A duplicate id would give two rows the same position and leave the
        // list to settle however SQLite feels.
        if (new Set(ids).size !== ids.length) {
            return NextResponse.json({ error: 'DUPLICATE_ID' }, { status: 400 })
        }

        await prisma.$transaction(
            ids.map((id: string, index: number) =>
                kind === 'CATEGORY'
                    ? prisma.category.update({ where: { id }, data: { displayOrder: index } })
                    : prisma.menu.update({ where: { id }, data: { displayOrder: index } }),
            ),
        )

        return NextResponse.json({ saved: ids.length })
    } catch (error) {
        console.error('[menu order] PUT failed', error)
        return NextResponse.json({ error: 'Failed to save order' }, { status: 500 })
    }
}
