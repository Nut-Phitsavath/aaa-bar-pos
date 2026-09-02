"use client"

import React, { createContext, useContext, useState, useEffect } from "react"

interface SidebarContextType {
    isCollapsed: boolean
    toggleSidebar: () => void
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined)

export function SidebarProvider({ children }: { children: React.ReactNode }) {
    const [isCollapsed, setIsCollapsed] = useState(false)

    // Persist state
    useEffect(() => {
        const saved = localStorage.getItem("sidebar_collapsed")
        if (saved === "true") setIsCollapsed(true)
    }, [])

    const toggleSidebar = () => {
        setIsCollapsed(prev => {
            const next = !prev
            localStorage.setItem("sidebar_collapsed", String(next))
            return next
        })
    }

    return (
        <SidebarContext.Provider value={{ isCollapsed, toggleSidebar }}>
            {children}
        </SidebarContext.Provider>
    )
}

export function useSidebar() {
    const context = useContext(SidebarContext)
    if (context === undefined) {
        throw new Error("useSidebar must be used within a SidebarProvider")
    }
    return context
}
