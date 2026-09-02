"use client"

import { translations } from "@/lib/translations"
import { useLanguage } from "@/components/language-provider"

export function useTranslation() {
    const { lang } = useLanguage()

    const dict = translations[lang] as Record<string, string>

    const t = new Proxy(dict, {
        get(target, prop: string) {
            return target[prop] ?? `⚠️ ${prop}`
        },
    })

    return { t, lang }
}
