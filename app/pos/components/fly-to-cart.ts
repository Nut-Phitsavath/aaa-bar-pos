/**
 * The "your tap landed" receipt.
 *
 * On the bar's till the cart panel sits beside the grid, and a new line
 * appearing there is confirmation enough. On a phone it does not: the cart is
 * a header icon, and a tap that visibly does nothing reads as a tap that
 * missed - so the cashier taps again and the round goes out twice.
 *
 * Lives here rather than in the customization dialog because adding a drink no
 * longer goes through that dialog. A tap on the grid is the common path now,
 * and the uncommon one - editing a note on a line already in the cart - is the
 * one that opens a modal.
 *
 * Raw DOM on purpose. It runs after the cart state has already changed, it
 * outlives the element that triggered it, and nothing should re-render because
 * of it.
 */

const FLIGHT_MS = 450

/** The cart icon in the header, which is both the target and the fallback. */
function cartIcon(): HTMLElement | null {
    return document.getElementById('cart-icon-header')
}

/** A short swell on the cart badge. The whole confirmation when motion is off. */
function pulseCart() {
    const icon = cartIcon()
    if (!icon) return
    icon.classList.add('scale-125', 'text-amber-500')
    setTimeout(() => icon.classList.remove('scale-125', 'text-amber-500'), 200)
}

export function flyToCart(from: DOMRect, imageUrl?: string) {
    if (typeof window === 'undefined' || typeof document === 'undefined') return

    // A cashier who has asked their device to stop moving things still needs to
    // know the tap registered; they get the badge pulse and nothing thrown
    // across the screen.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        pulseCart()
        return
    }

    const icon = cartIcon()
    const target = icon?.getBoundingClientRect()
    const targetX = target ? target.left : window.innerWidth - 100
    const targetY = target ? target.top : 100

    const flying = document.createElement('img')
    flying.src = imageUrl && imageUrl !== '/placeholder.svg' ? imageUrl : '/placeholder-logo.png'
    flying.alt = ''
    flying.setAttribute('aria-hidden', 'true')
    // Ease-out rather than ease-in-out: the drink should leave the shelf fast
    // and settle into the cart, not accelerate away in the middle.
    flying.className =
        'fixed z-[10000] rounded-md shadow-2xl object-cover pointer-events-none ' +
        'transition-all ease-[cubic-bezier(0.22,1,0.36,1)]'
    flying.style.transitionDuration = `${FLIGHT_MS}ms`
    flying.style.width = '100px'
    flying.style.height = '100px'
    flying.style.top = `${from.top - 50}px`
    flying.style.left = `${from.left + from.width / 2 - 50}px`
    document.body.appendChild(flying)

    requestAnimationFrame(() => {
        flying.style.top = `${targetY}px`
        flying.style.left = `${targetX}px`
        flying.style.width = '20px'
        flying.style.height = '20px'
        flying.style.opacity = '0.2'
        flying.style.transform = 'scale(0.1) rotate(180deg)'
    })

    setTimeout(() => {
        flying.remove()
        pulseCart()
    }, FLIGHT_MS)
}
