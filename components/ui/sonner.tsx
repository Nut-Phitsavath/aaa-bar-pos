'use client'

import type { CSSProperties } from 'react'
import { Toaster as Sonner, toast, type ToasterProps } from 'sonner'
import { CheckCircle2, AlertTriangle, CircleAlert, Info } from 'lucide-react'

/**
 * Toasts for the till.
 *
 * Sized and placed for the physical situation: a cashier standing at a touch
 * screen, glancing while their hands are on the numpad. Top-center keeps
 * messages clear of the cart panel on the right and the keypad at the bottom,
 * and in the same place every time so the eye learns where to look.
 *
 * Lao needs more room than the sonner default: sentences run long, and Noto
 * Sans Lao stacks vowels and tone marks above and below the baseline, so the
 * text needs generous line-height or the marks collide with the line above.
 */

const ICON = "h-5 w-5 shrink-0"

// Semantic colours, taken from the vocabulary already used across the app
// (emerald for done, rose for failed, amber for "fix this first") rather than
// sonner's generic set, so a toast looks like it belongs to this POS.
const toastOptions: ToasterProps["toastOptions"] = {
    classNames: {
        toast: [
            "group w-full items-start gap-3 rounded-2xl border !p-4 shadow-lg",
            // Radix sets pointer-events:none on <body> while a dialog is open,
            // and the toast inherits it -- the close button then can't be
            // clicked at all, because hit-testing falls straight through to the
            // dialog overlay underneath. Re-enable it per toast (not on the
            // container, which must stay click-through so it doesn't block the
            // UI behind it). Many of these toasts fire from inside a dialog.
            "!pointer-events-auto",
            // Reserves the lane the close button sits in -- without it a long
            // Lao line runs under the ×. Needs !important: sonner ships
            // unlayered CSS, which outranks Tailwind's @layer utilities.
            "!pr-14",
            // Lao diacritics need the vertical room; 15px is the floor for a
            // screen read at arm's length.
            "font-sans text-[15px] leading-relaxed",
        ].join(" "),
        title: "font-bold [text-wrap:pretty]",
        // Long messages wrap instead of truncating -- a clipped error is worse
        // than no error, and the Lao strings are full sentences.
        description: "mt-0.5 text-[14px] opacity-90 [overflow-wrap:anywhere] [text-wrap:pretty]",
        // 44px hit area: this is a touch screen, not a mouse.
        // Sonner parks this half-outside the top-LEFT corner by default, which
        // reads as a stray bubble rather than a dismiss control. Sit it on the
        // right instead, vertically centred, so it lines up with the text
        // whether the message runs to one line or three.
        // 36px round: a finger target on a touch screen, not a mouse target.
        // transform-none first: sonner ships transform:translate(-35%,-35%) to
        // hang this off the corner, and that keeps applying on top of any
        // re-positioning, which pushes the button outside the toast entirely.
        // z-10: the transform sonner sets also gave this its own stacking
        // context. Dropping the transform drops that too, and the title div
        // then paints over the button and swallows the click.
        closeButton:
            "!transform-none !z-10 !left-auto !right-3 !top-1/2 !-translate-y-1/2 " +
            "!h-9 !w-9 !rounded-full !border-transparent !bg-black/5 !text-current " +
            "hover:!bg-black/10 focus-visible:!ring-2 !transition-colors",
        success: "!bg-emerald-50 !text-emerald-900 !border-emerald-200",
        error: "!bg-rose-50 !text-rose-900 !border-rose-200",
        warning: "!bg-amber-50 !text-amber-900 !border-amber-200",
        info: "!bg-slate-50 !text-slate-900 !border-slate-200",
    },
}

export function Toaster(props: ToasterProps) {
    return (
        <Sonner
            position="top-center"
            expand
            closeButton
            // z-index: above dialogs (Radix uses z-50) so an error raised from
            // inside a dialog is never hidden behind it.
            // --width: sonner sizes each toast from this var, not from the
            // container; its 356px default wraps these Lao sentences to three
            // cramped lines.
            style={{ zIndex: 60, "--width": "440px" } as CSSProperties}
            icons={{
                success: <CheckCircle2 className={ICON} />,
                // CircleAlert, not XCircle: an ✗-in-a-circle reads as a second close
                // button sitting next to the real one.
                error: <CircleAlert className={ICON} />,
                warning: <AlertTriangle className={ICON} />,
                info: <Info className={ICON} />,
            }}
            toastOptions={toastOptions}
            {...props}
        />
    )
}

// Only errors stay until dismissed. A timed error is a message you can miss by
// looking down at the counter, and the cost of missing "payment failed" is
// handing over goods unpaid.
//
// Everything else clears itself. Warnings are self-correcting -- "enter a
// quantity", "reason is required" -- so the cashier fixes the field and moves
// on; a warning that had to be tapped away would add a tap to every mistyped
// entry and leave a stale message about a field they already fixed. 6s rather
// than the usual 5 because Lao takes a moment longer to read.
const FOREVER = Number.POSITIVE_INFINITY
const DURATION = { success: 3500, info: 4000, warning: 6000, error: FOREVER }

type Opts = { description?: string }

/**
 * The one way this app talks back to the user. Replaces window.alert, which
 * blocked the whole tab, could not be styled, and rendered in the browser's
 * language rather than the shop's.
 *
 * HOW THESE MESSAGES ARE WRITTEN
 *
 * The Lao strings set the pattern and English follows it, not the other way
 * round - Lao was already consistent when English had drifted into four
 * different shapes for the same idea.
 *
 *   success  X ສຳເລັດ        "Settings saved"        name what happened
 *   failure  X ບໍ່ສຳເລັດ      "Could not save X"      one frame, always
 *
 * 1. Never write "successfully". The green tick and the past tense already
 *    say it; the word is pure padding on a screen read at a glance.
 * 2. Never write "Error <doing something>". That is how a developer describes
 *    a stack trace, not how a cashier describes their morning. "Could not
 *    process the order" tells them the same thing in their own words.
 * 3. A warning names the fix, not the fault. "Reason is required" tells the
 *    cashier what to do; "Invalid points" leaves them guessing.
 * 4. The title stands on its own. Specifics go in the description or in a
 *    {n} placeholder - never split one sentence across the two fields, or a
 *    missing description leaves a dangling colon on screen.
 * 5. No full stop on a single-sentence toast.
 */
export const notify = {
    /** A thing the user asked for finished. */
    success: (message: string, o?: Opts) =>
        toast.success(message, { ...o, duration: DURATION.success }),

    /** Something failed and the sale cannot continue as-is. */
    error: (message: string, o?: Opts) =>
        toast.error(message, { ...o, duration: DURATION.error }),

    /** The user must fix an input before this will work. */
    warn: (message: string, o?: Opts) =>
        toast.warning(message, { ...o, duration: DURATION.warning }),

    info: (message: string, o?: Opts) =>
        toast.info(message, { ...o, duration: DURATION.info }),
}
