"use client"

import { useRef, useState, useEffect } from "react"
import { useTranslation } from "@/hooks/use-translation"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Printer, X } from "lucide-react"

/**
 * The receipt preview, over the till rather than beside it.
 *
 * This used to be `window.open`, which on a touch till means the whole app
 * disappears behind a second window the staff member then has to find and
 * close - and on a browser with popups blocked it means nothing happens at all.
 *
 * The slip inside is the real /receipt page in an iframe, not a second copy of
 * the layout. There is one receipt implementation in this codebase and this
 * keeps it that way: the same document that a direct link renders is what is
 * shown here, and printing it prints exactly that document, so the preview and
 * the paper cannot drift apart.
 */
export function ReceiptDialog({
    src,
    onClose,
}: {
    /** `/receipt?session=…` or `/receipt?id=…`; null closes the dialog. */
    src: string | null
    onClose: () => void
}) {
    const { t } = useTranslation()
    const frame = useRef<HTMLIFrameElement>(null)
    const [height, setHeight] = useState(320)

    // A fixed frame leaves a short slip floating above a band of empty white.
    // Same origin, so the real height is readable; capped so a long bill scrolls
    // inside the frame rather than pushing the buttons off the screen.
    //
    // Observed rather than measured once on load: the slip fetches its own data,
    // so at load time the document still says "generating receipt" and measuring
    // then would size the frame to a spinner.
    const observer = useRef<ResizeObserver | null>(null)
    const fit = () => {
        const doc = frame.current?.contentDocument
        if (!doc?.body) return
        // The slip itself, not the body: the embedded page still renders inside
        // the app layout, whose min-h-screen means body.scrollHeight can never
        // measure smaller than the frame it is in - so the frame would grow to
        // fit itself and never shrink back around a short bill.
        const measure = () => {
            const slip = doc.getElementById("printable-receipt") ?? doc.body
            setHeight(Math.min(slip.scrollHeight + 16, Math.round(window.innerHeight * 0.66)))
        }
        measure()
        observer.current?.disconnect()
        observer.current = new ResizeObserver(measure)
        observer.current.observe(doc.body)
    }

    useEffect(() => () => observer.current?.disconnect(), [])

    // Printing the iframe rather than the page: the till behind it never
    // reaches the paper, so no print stylesheet has to hide the whole app.
    const print = () => {
        const win = frame.current?.contentWindow
        if (!win) return
        win.focus()
        win.print()
    }

    return (
        <Dialog open={!!src} onOpenChange={(open) => { if (!open) onClose() }}>
            <DialogContent className="max-w-[92vw] sm:max-w-[360px] p-0 gap-0 overflow-hidden">
                {/* Radix needs a title for screen readers; the slip carries its
                    own heading, so this one is not shown twice. */}
                <DialogTitle className="sr-only">{t.receipt}</DialogTitle>

                {src && (
                    <iframe
                        ref={frame}
                        src={`${src}${src.includes("?") ? "&" : "?"}embed=1`}
                        title={t.receipt}
                        onLoad={fit}
                        style={{ height }}
                        className="w-full border-0 bg-white transition-[height] duration-200"
                    />
                )}

                <div className="flex gap-2 p-3 border-t bg-slate-50">
                    <Button
                        onClick={print}
                        className="flex-1 h-12 text-base font-black bg-slate-900 hover:bg-slate-800"
                    >
                        <Printer className="w-5 h-5 mr-2" />
                        {t.print}
                    </Button>
                    <Button variant="outline" onClick={onClose} className="h-12 px-5 text-base">
                        <X className="w-5 h-5 mr-2" />
                        {t.close}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
