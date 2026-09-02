import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
    const path = request.nextUrl.pathname
    const host = request.headers.get('host') || ''

    // 1. Subdomain Lockdown: monitor.sattavath.store
    if (host.includes('monitor.sattavath.store')) {
        // Allow API, static assets, and only the /monitor page
        const isAllowedPath = path === '/monitor' ||
            path.startsWith('/api/') ||
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

    // Define protected routes
    const protectedRoutes = ['/dashboard', '/pos', '/orders', '/inventory', '/customers', '/promotions', '/reports', '/menu', '/settings']

    // ... rest of the existing protected route logic ...
    const isProtectedRoute = protectedRoutes.some(route => path.startsWith(route))

    if (isProtectedRoute) {
        // Check for session cookie
        const hasSession = request.cookies.has('pos_session')

        if (!hasSession) {
            // Redirect to pin-login if not authenticated
            const url = request.nextUrl.clone()
            url.pathname = '/pin-login'
            return NextResponse.redirect(url)
        }

        // Role-based access control
        const session = request.cookies.get('pos_session')
        if (session) {
            try {
                const user = JSON.parse(session.value)
                const role = user.role

                // Define restricted routes for STAFF
                const staffRestrictedRoutes = ['/promotions', '/reports', '/menu', '/settings', '/dashboard']

                if (role === 'STAFF') {
                    const isRestricted = staffRestrictedRoutes.some(route => path.startsWith(route))
                    if (isRestricted) {
                        const url = request.nextUrl.clone()
                        url.pathname = '/pos'
                        return NextResponse.redirect(url)
                    }
                }

                if (role === 'KITCHEN') {
                    // Kitchen should only access kitchen
                    const kitchenAllowedRoutes = ['/kitchen', '/orders'] // Allow orders to see what's coming
                    const isAllowed = kitchenAllowedRoutes.some(route => path.startsWith(route))
                    if (!isAllowed) {
                        const url = request.nextUrl.clone()
                        url.pathname = '/kitchen'
                        return NextResponse.redirect(url)
                    }
                }
            } catch (e) {
                console.error('Error parsing session in middleware:', e)
            }
        }
    }

    return NextResponse.next()
}

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - api (API routes)
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         * - role-select (login page)
         * - pin-login (login page)
         */
        '/((?!api|_next/static|_next/image|favicon.ico|pin-login).*)',
    ],
}
