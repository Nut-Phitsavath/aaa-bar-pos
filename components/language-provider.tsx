"use client"

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react"

type Lang = "en" | "lo"

interface LanguageContextType {
    lang: Lang
    setLang: (lang: Lang) => void
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined)

export function LanguageProvider({ children }: { children: ReactNode }) {
    const [lang, setLangState] = useState<Lang>("lo")

    const setLang = useCallback((next: Lang) => {
        setLangState(next)
        if (typeof document !== "undefined") {
            document.documentElement.lang = next
        }
    }, [])

    useEffect(() => {
        const fetchLang = async () => {
            try {
                const res = await fetch("/api/settings")
                if (res.ok) {
                    const settings = await res.json()
                    // Default to Lao unless English is explicitly saved
                    setLang(settings.language === "en" ? "en" : "lo")
                }
            } catch (e) { }
        }

        fetchLang()

        // Keep in sync if changed on another tab/device
        const interval = setInterval(fetchLang, 30000)
        return () => clearInterval(interval)
    }, [setLang])

    return (
        <LanguageContext.Provider value={{ lang, setLang }}>
            {children}
        </LanguageContext.Provider>
    )
}

export function useLanguage() {
    const context = useContext(LanguageContext)
    if (context === undefined) {
        throw new Error("useLanguage must be used within a LanguageProvider")
    }
    return context
}
