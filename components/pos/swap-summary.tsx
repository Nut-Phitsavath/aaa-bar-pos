"use client"

import { summariseSwaps } from "@/lib/packages"

/**
 * What a package actually delivered, under the line that sold it.
 *
 * One component for the ticket and the bill history so they cannot drift into
 * describing the same swap differently. The printed slip renders the same two
 * lists, in its own type, in components/bill-receipt.tsx.
 *
 * Shown even when the swap cost nothing. A free trade is exactly the case a
 * customer queries at the end of the night - "we never ordered water" - and the
 * bill is the answer.
 */
export function SwapSummary({
    swaps,
    struck,
}: {
    swaps?: { lines: { direction: string; name: string; quantity: number }[] }[]
    struck?: boolean
}) {
    if (!swaps || swaps.length === 0) return null
    const { out, in: added } = summariseSwaps(swaps)
    if (out.length === 0 && added.length === 0) return null

    const line = (prefix: string, lines: typeof out, tone: string) =>
        lines.length > 0 && (
            <p className={`text-[13px] leading-snug ${struck ? "text-slate-400 line-through" : tone}`}>
                {prefix} {lines.map((l) => `${l.quantity} × ${l.name}`).join(", ")}
            </p>
        )

    return (
        <div className="mt-0.5">
            {line("−", out, "text-rose-600")}
            {line("+", added, "text-emerald-700")}
        </div>
    )
}
