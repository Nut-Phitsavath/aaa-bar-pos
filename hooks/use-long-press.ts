"use client"

import { useCallback, useRef } from "react"

/**
 * Press and hold, on a touchscreen that is also a mouse.
 *
 * A till gets both: staff prod it with a finger, an owner uses a mouse at the
 * back. Pointer events cover both, so there is one code path rather than a
 * touch branch and a mouse branch that drift apart.
 *
 * Two things make this reliable on a real touch screen and are easy to miss:
 * a hold that starts to travel is a scroll, not a press, so movement past a few
 * pixels cancels it; and the browser's own long-press behaviours - text
 * selection and the context menu - fire on top of ours unless they are refused.
 */
export function useLongPress(
    onLongPress: () => void,
    { delay = 400, tolerance = 8 }: { delay?: number; tolerance?: number } = {},
) {
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const origin = useRef<{ x: number; y: number } | null>(null)

    const clear = useCallback(() => {
        if (timer.current) clearTimeout(timer.current)
        timer.current = null
        origin.current = null
    }, [])

    const onPointerDown = useCallback((e: React.PointerEvent) => {
        // Ignore right-click and any secondary button: a context-menu press is
        // not someone asking to rearrange the menu.
        if (e.button !== 0) return
        origin.current = { x: e.clientX, y: e.clientY }
        timer.current = setTimeout(() => {
            timer.current = null
            onLongPress()
        }, delay)
    }, [delay, onLongPress])

    const onPointerMove = useCallback((e: React.PointerEvent) => {
        if (!origin.current) return
        const moved = Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y)
        // Past the tolerance this is a scroll, and a list that jumps into
        // reorder mode when you try to scroll it is unusable.
        if (moved > tolerance) clear()
    }, [clear, tolerance])

    return {
        onPointerDown,
        onPointerMove,
        onPointerUp: clear,
        onPointerLeave: clear,
        onPointerCancel: clear,
        onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
        style: { WebkitTouchCallout: "none", userSelect: "none" } as React.CSSProperties,
    }
}
