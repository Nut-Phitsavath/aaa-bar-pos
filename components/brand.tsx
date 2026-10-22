"use client"

import { useEffect, useState } from "react"
import { brandOf, VENDOR, type Brand } from "@/lib/brand"
import { cn } from "@/lib/utils"

/** Fired by Settings after a save, so the name and logo change without a reload. */
export const SETTINGS_SAVED = "pos:settings-saved"

/**
 * The shop's name and logo for the till's own screens - CaniSoftware's until
 * the owner sets theirs (lib/brand.ts). /api/settings is readable before
 * sign-in, so the PIN screen can show it too.
 */
export function useBrand(): Brand {
    const [brand, setBrand] = useState<Brand>(() => brandOf(null))
    useEffect(() => {
        let live = true
        const load = () =>
            fetch("/api/settings")
                .then((r) => (r.ok ? r.json() : null))
                .then((s) => { if (live) setBrand(brandOf(s)) })
                .catch(() => {})
        load()
        window.addEventListener(SETTINGS_SAVED, load)
        return () => { live = false; window.removeEventListener(SETTINGS_SAVED, load) }
    }, [])
    return brand
}

/** The logo, or the name's letters in gold when there is no logo. */
export function BrandMark({ brand, className }: { brand: Brand; className?: string }) {
    if (brand.logo) {
        return (
            <div className={cn("rounded-xl bg-white flex items-center justify-center overflow-hidden shrink-0", className)}>
                <img src={brand.logo} alt="" className="w-full h-full object-contain" />
            </div>
        )
    }
    return (
        <div className={cn("rounded-xl border-[1.5px] border-amber-500 text-amber-500 flex items-center justify-center shrink-0 font-brand font-bold tracking-wide", className)}>
            {brand.mark}
        </div>
    )
}

/** The name: CANISOFTWARE in its own two-tone, or the bar's in the logo's serif. */
export function BrandName({ brand, tone = "dark" }: { brand: Brand; tone?: "dark" | "light" }) {
    const ink = tone === "dark" ? "text-stone-100" : "text-stone-900"
    const sub = tone === "dark" ? "text-stone-400" : "text-stone-500"
    if (!brand.custom || brand.title === VENDOR.name) {
        return (
            <div className="flex flex-col leading-none min-w-0">
                <div className="text-lg font-black tracking-tight whitespace-nowrap">
                    <span className="text-amber-500">CANI</span>
                    <span className={ink}>SOFTWARE</span>
                </div>
                <span className={cn("text-[10px] font-bold uppercase tracking-widest mt-1", sub)}>{brand.subtitle || VENDOR.tagline}</span>
            </div>
        )
    }
    return (
        <div className="flex flex-col leading-none min-w-0">
            <span className={cn("font-brand text-xl font-bold tracking-[0.06em] truncate", ink)}>{brand.title}</span>
            {brand.subtitle && (
                <span className={cn("text-[10px] font-bold uppercase tracking-[0.18em] mt-1 truncate", sub)}>{brand.subtitle}</span>
            )}
        </div>
    )
}

/** CaniSoftware's signature once the bar's own name is showing. */
export function PoweredBy({ brand, className }: { brand: Brand; className?: string }) {
    if (!brand.custom) return null
    return (
        <p className={cn("text-[10px] tracking-[0.08em] text-stone-400 text-center", className)}>
            Powered by <b className="font-extrabold tracking-[0.04em] text-stone-300">{VENDOR.name}</b>
        </p>
    )
}
