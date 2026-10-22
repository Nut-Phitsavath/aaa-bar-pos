/**
 * Whose name and logo the till shows: the sidebar's header and the PIN screen.
 *
 * CaniSoftware's, until the owner sets their own in Settings (shop name, shop
 * logo). Then the bar's name and logo take that place, and CaniSoftware moves
 * to a small "Powered by" line - the way a POS vendor usually signs a venue's
 * till. The receipt already prints the shop's name; this brings the till's
 * own screens into line, so the next bar is a Settings change, not a code one.
 *
 * Each setting works on its own: a name with no logo shows a lettered mark
 * made from the name; a logo with no name still shows the logo.
 */

export const VENDOR = {
    name: 'CANISOFTWARE',
    tagline: 'POS SOLUTION',
    logo: '/solution_logo.png',
} as const

type ShopSettings = { shopName?: string | null; shop_name?: string | null; shopLogo?: string | null } | null | undefined

export type Brand = {
    /** The owner has set a name or a logo: show theirs, and "Powered by" for us. */
    custom: boolean
    /** The headline: the name's first word ("AAA"), or CANISOFTWARE. */
    title: string
    /** The rest of the name ("Night Club"), or our tagline. */
    subtitle: string
    /** The uploaded logo, our logo by default, or null for a lettered mark. */
    logo: string | null
    /** Letters for the mark when there is no logo: a short first word, else initials. */
    mark: string
}

export function brandOf(settings: ShopSettings): Brand {
    const name = (settings?.shopName || settings?.shop_name || '').trim()
    const logo = settings?.shopLogo?.trim() || null
    if (!name && !logo) {
        return { custom: false, title: VENDOR.name, subtitle: VENDOR.tagline, logo: VENDOR.logo, mark: 'C' }
    }
    const words = name.split(/\s+/).filter(Boolean)
    const first = words[0] ?? ''
    const mark = first.length <= 4 ? first : words.slice(0, 3).map((w) => w[0]).join('').toUpperCase()
    return {
        custom: true,
        title: first || VENDOR.name,
        subtitle: words.slice(1).join(' '),
        logo,
        mark: mark || 'C',
    }
}
