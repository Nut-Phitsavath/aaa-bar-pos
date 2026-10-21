"use client"

import { Delete } from "lucide-react"
import { useTranslation } from "@/hooks/use-translation"
import { Button } from "@/components/ui/button"

/**
 * An on-screen 0-9 keypad for a field of digits.
 *
 * The till is a touch screen with no keyboard, so a plain text field - a
 * manager's PIN, the cash counted into or out of the drawer - could not be
 * filled in at all. The field beside it still takes a keyboard where there
 * is one; this only appends to and trims the same string of digits.
 */
export function NumberPad({
    value,
    onChange,
    maxLength,
    disabled,
    label,
}: {
    /** Digits only, as the field stores them. */
    value: string
    onChange: (next: string) => void
    maxLength?: number
    disabled?: boolean
    /** What is being typed, for screen readers. */
    label: string
}) {
    const { t } = useTranslation()
    const press = (d: string) => {
        const next = value + d
        onChange(maxLength ? next.slice(0, maxLength) : next)
    }
    const key = "h-12 text-xl font-semibold hover:bg-amber-100"

    return (
        <div className="grid grid-cols-3 gap-2" role="group" aria-label={label}>
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                <Button key={d} type="button" variant="outline" className={key} onClick={() => press(d)} disabled={disabled}>
                    {d}
                </Button>
            ))}
            <Button
                type="button"
                variant="outline"
                className="h-12 text-sm font-semibold text-slate-600"
                onClick={() => onChange("")}
                disabled={disabled || value.length === 0}
            >
                {t.clear}
            </Button>
            <Button type="button" variant="outline" className={key} onClick={() => press("0")} disabled={disabled}>
                0
            </Button>
            <Button
                type="button"
                variant="outline"
                className="h-12 text-slate-600"
                onClick={() => onChange(value.slice(0, -1))}
                disabled={disabled || value.length === 0}
                aria-label={t.delete}
            >
                <Delete className="w-6 h-6" />
            </Button>
        </div>
    )
}
