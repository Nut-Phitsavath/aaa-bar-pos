import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { SESSION_COOKIE, isPublicApi, readSession, sessionSecret } from '@/lib/session'

/**
 * The quick check in front of every page and API route (Next.js 16 calls this
 * file proxy.ts; it was middleware.ts).
 *
 * A session is a cookie this server signed (lib/session). Without one, a
 * protected page sends you to the PIN screen and an API call is refused with
 * 401 - except the few routes the PIN screen, the customer display and BCEL's
 * callback need (isPublicApi). Before this, /api was excluded from the matcher
 * altogether and 22 write routes - menu prices, promotions, stock, customers,
 * uploads - checked nothing, so anything on the bar's network could change
 * them.
 *
 * This is the optimistic layer. Routes still resolve the user from the
 * database (lib/auth) before trusting who they are.
 */
export function proxy(request: NextRequest) {
    const path = request.nextUrl.pathname
    const host = request.headers.get('host') || ''
    const raw = request.cookies.get(SESSION_COOKIE)?.value
    const session = readSession(raw, sessionSecret())

    // A cookie that is there but is not a session - an old unsigned one from
    // before this, a tampered one, an expired one - is cleared on the way out,
    // so the browser stops sending it.
    const clearBadCookie = (response: NextResponse) => {
        if (raw && !session) response.cookies.delete(SESSION_COOKIE)
        return response
    }

    // The API: signed in, or one of the few public routes.
    if (path.startsWith('/api/')) {
        if (session || isPublicApi(request.method, path)) return NextResponse.next()
        return clearBadCookie(NextResponse.json({ error: 'Not signed in' }, { status: 401 }))
    }

    // 1. Subdomain Lockdown: monitor.sattavath.store (the cafe's remote view)
    if (host.includes('monitor.sattavath.store')) {
        const isAllowedPath = path === '/monitor' ||
            path.startsWith('/_next/') ||
            path.includes('favicon.ico') ||
            path.includes('.png') ||
            path.includes('.svg')

        if (!isAllowedPath) {
            const url = request.nextUrl.clone()
            url.pathname = '/monitor'
            return NextResponse.redirect(url)
        }
    }

    // Pages that need someone signed in. /users and /shifts are new to the
    // list: their APIs were always behind a sign-in, so the pages rendered
    // empty for anyone who walked up to them.
    const protectedRoutes = ['/dashboard', '/pos', '/tables', '/tabs', '/orders', '/inventory', '/customers', '/promotions', '/reports', '/menu', '/settings', '/users', '/shifts']
    const isProtectedRoute = protectedRoutes.some(route => path.startsWith(route))

    if (isProtectedRoute) {
        if (!session) {
            const url = request.nextUrl.clone()
            url.pathname = '/pin-login'
            return clearBadCookie(NextResponse.redirect(url))
        }

        // Role-based access, from the signed role.
        const role = session.role
        const staffRestrictedRoutes = ['/promotions', '/reports', '/menu', '/settings', '/dashboard']

        if (role === 'STAFF' && staffRestrictedRoutes.some(route => path.startsWith(route))) {
            // Bounce staff to the floor plan, which is where they land at login.
            const url = request.nextUrl.clone()
            url.pathname = '/tables'
            return NextResponse.redirect(url)
        }

        if (role === 'KITCHEN') {
            // Kitchen sees the kitchen, and orders to see what's coming.
            const kitchenAllowedRoutes = ['/kitchen', '/orders']
            if (!kitchenAllowedRoutes.some(route => path.startsWith(route))) {
                const url = request.nextUrl.clone()
                url.pathname = '/kitchen'
                return NextResponse.redirect(url)
            }
        }
    }

    return clearBadCookie(NextResponse.next())
}

export const config = {
    matcher: [
        /*
         * Every path except static files and image optimisation. /api is IN
         * the matcher now - that is the point - and so is /pin-login, which
         * simply is not a protected route.
         */
        '/((?!_next/static|_next/image|favicon.ico).*)',
    ],
}
