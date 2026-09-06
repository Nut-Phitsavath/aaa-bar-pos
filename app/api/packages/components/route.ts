import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { componentIndex } from '@/lib/packages'
import { sellableMenus } from '@/lib/packages-db'

export const dynamic = 'force-dynamic'

/**
 * Which ingredients the menu sells one of, and for how much.
 *
 * The recipe screen uses it to say whether a package component can be swapped
 * before anyone finds out at a table. A bottle of wine sitting in a set with no
 * single-bottle menu item behind it looks identical to a Heineken on that
 * screen, right up until the exchange dialog shows an empty column.
 */
export async function GET() {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    try {
        const index = componentIndex(await sellableMenus())
        const components: Record<string, { name: string; localName: string | null; unitPrice: number }> = {}
        for (const [ingredientId, menu] of index) {
            components[ingredientId] = {
                name: menu.name,
                localName: menu.localName ?? null,
                unitPrice: menu.unitPrice,
            }
        }
        return NextResponse.json({ components })
    } catch (error) {
        console.error('[package components] GET failed', error)
        return NextResponse.json({ error: 'Failed to load components' }, { status: 500 })
    }
}
