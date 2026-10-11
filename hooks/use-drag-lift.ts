"use client"

import { useEffect, useState } from "react"

/**
 * Whether a draggable row is currently lifted, for styling it.
 *
 * Exists because putting the lift shadow in Motion's `whileDrag` left it stuck
 * on the row after release, intermittently, for two separate reasons:
 *
 *   1. `whileDrag={{ boxShadow: ... }}` has nothing to animate back TO. The row
 *      carries no box-shadow of its own, so on release Motion interpolates
 *      towards a value it has to read from computed style, and a shadow that
 *      never resolves cleanly can leave its last frame painted.
 *
 *   2. If the drag end never fires - the pointer released off the element, the
 *      row re-keyed mid-gesture, the browser swallowed the pointerup - the
 *      whileDrag state is simply never exited.
 *
 * So the shadow is a plain class, present or absent, with no animation target
 * to resolve. And the hook listens for pointerup on the WINDOW while lifted, so
 * a drag end that never arrives still clears it. Transforms stay in whileDrag,
 * which Motion handles cleanly.
 */
export function useDragLift() {
    const [lifted, setLifted] = useState(false)

    useEffect(() => {
        if (!lifted) return
        const clear = () => setLifted(false)
        // Captured on the window: the pointer is very often released somewhere
        // other than the row it started on, which is the case that used to
        // leave a shadow behind.
        window.addEventListener("pointerup", clear)
        window.addEventListener("pointercancel", clear)
        // Ends a gesture that was interrupted by tabbing away mid-drag.
        window.addEventListener("blur", clear)
        return () => {
            window.removeEventListener("pointerup", clear)
            window.removeEventListener("pointercancel", clear)
            window.removeEventListener("blur", clear)
        }
    }, [lifted])

    return {
        lifted,
        lift: () => setLifted(true),
        drop: () => setLifted(false),
        /** Tailwind for a lifted row. `relative` because z-index needs it. */
        liftClass: lifted ? "relative z-10 shadow-lg" : "",
    }
}
