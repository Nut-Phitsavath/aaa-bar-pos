"use client"

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react"
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogFooter,
    AlertDialogTitle,
    AlertDialogDescription,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { AlertTriangle } from "lucide-react"
import { useTranslation } from "@/hooks/use-translation"

/**
 * Replacement for window.confirm().
 *
 * Kept promise-based on purpose so the call sites stay one-liners and read the
 * same as the native call they replace:
 *
 *     if (!(await confirm({ title: t.delete_x }))) return
 *
 * Only for decisions that must block -- deleting a menu item, wiping sales.
 * Everything else is a toast; a modal the user has to dismiss to keep serving
 * a customer is a tax on every order.
 */

export type ConfirmOptions = {
    title: string
    description?: string
    confirmLabel?: string
    cancelLabel?: string
    /** Red confirm button, for anything that destroys data. */
    destructive?: boolean
}

const ConfirmContext = createContext<((o: ConfirmOptions) => Promise<boolean>) | null>(null)

export function ConfirmProvider({ children }: { children: ReactNode }) {
    const { t } = useTranslation()
    const [options, setOptions] = useState<ConfirmOptions | null>(null)
    const resolver = useRef<((v: boolean) => void) | null>(null)

    const confirm = useCallback((o: ConfirmOptions) => {
        setOptions(o)
        return new Promise<boolean>((resolve) => { resolver.current = resolve })
    }, [])

    // Every close path resolves, including Escape and the overlay, so an
    // awaited confirm() can never leave the caller hanging.
    const settle = useCallback((result: boolean) => {
        setOptions(null)
        resolver.current?.(result)
        resolver.current = null
    }, [])

    return (
        <ConfirmContext.Provider value={confirm}>
            {children}
            <AlertDialog open={options !== null} onOpenChange={(open) => { if (!open) settle(false) }}>
                <AlertDialogContent className="sm:max-w-md rounded-2xl">
                    <AlertDialogHeader>
                        <div className="flex items-start gap-3">
                            <div className={`mt-0.5 rounded-full p-2 ${options?.destructive ? "bg-rose-100 text-rose-600" : "bg-amber-100 text-amber-700"}`}>
                                <AlertTriangle className="h-5 w-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <AlertDialogTitle className="text-lg font-bold leading-relaxed [text-wrap:pretty]">
                                    {options?.title}
                                </AlertDialogTitle>
                                {options?.description && (
                                    <AlertDialogDescription className="mt-1 leading-relaxed [overflow-wrap:anywhere] [text-wrap:pretty]">
                                        {options.description}
                                    </AlertDialogDescription>
                                )}
                            </div>
                        </div>
                    </AlertDialogHeader>
                    {/* Not AlertDialogAction/Cancel: those close on click before the
                        promise settles. Plain buttons keep settle() in charge. */}
                    <AlertDialogFooter className="gap-2 sm:gap-2">
                        <Button
                            variant="outline"
                            className="h-12 flex-1 text-base font-bold"
                            onClick={() => settle(false)}
                        >
                            {options?.cancelLabel || t.cancel}
                        </Button>
                        <Button
                            className={`h-12 flex-1 text-base font-bold text-white ${options?.destructive
                                ? "bg-rose-600 hover:bg-rose-700"
                                : "bg-amber-600 hover:bg-amber-700"}`}
                            onClick={() => settle(true)}
                        >
                            {options?.confirmLabel || t.confirm}
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </ConfirmContext.Provider>
    )
}

export function useConfirm() {
    const ctx = useContext(ConfirmContext)
    if (!ctx) throw new Error("useConfirm must be used within a ConfirmProvider")
    return ctx
}
