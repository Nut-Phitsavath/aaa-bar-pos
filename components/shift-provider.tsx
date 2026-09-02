"use client"

import { createContext, useContext, useState, useEffect, ReactNode } from "react"

// Types
export type ShiftStatus = "OPEN" | "CLOSED" | "LOADING"

interface ShiftState {
    status: ShiftStatus
    activeShiftId: string | null
    startCash: number | null
    cashPayments: number | null
    onePayPayments: number | null
    onePayCount: number | null
    transferPayments: number | null
    transferCount: number | null
    checkShiftStatus: () => Promise<void>
}

const ShiftContext = createContext<ShiftState | undefined>(undefined)

export function ShiftProvider({ children }: { children: ReactNode }) {
    const [status, setStatus] = useState<ShiftStatus>("LOADING")
    const [activeShiftId, setActiveShiftId] = useState<string | null>(null)
    const [startCash, setStartCash] = useState<number | null>(null)
    const [cashPayments, setCashPayments] = useState<number | null>(null)
    const [onePayPayments, setOnePayPayments] = useState<number | null>(null)
    const [onePayCount, setOnePayCount] = useState<number | null>(null)
    const [transferPayments, setTransferPayments] = useState<number | null>(null)
    const [transferCount, setTransferCount] = useState<number | null>(null)

    const checkShiftStatus = async () => {
        try {
            const res = await fetch('/api/shifts/status')
            if (res.ok) {
                const data = await res.json()
                if (data.activeShift) {
                    setStatus("OPEN")
                    setActiveShiftId(data.activeShift.id)
                    setStartCash(data.activeShift.startCash)
                    setCashPayments(data.activeShift.cashPayments)
                    setOnePayPayments(data.activeShift.onePayPayments || 0)
                    setOnePayCount(data.activeShift.onePayCount || 0)
                    setTransferPayments(data.activeShift.transferPayments || 0)
                    setTransferCount(data.activeShift.transferCount || 0)
                } else {
                    setStatus("CLOSED")
                    setActiveShiftId(null)
                    setStartCash(null)
                    setCashPayments(null)
                    setOnePayPayments(null)
                    setOnePayCount(null)
                    setTransferPayments(null)
                    setTransferCount(null)
                }
            } else {
                setStatus("CLOSED")
                setActiveShiftId(null)
            }
        } catch (e) {
            console.error("Failed to check shift status", e)
            setStatus("CLOSED")
        }
    }

    useEffect(() => {
        checkShiftStatus()

        // Listen for payments on the unified channel to update shift data in real-time
        const channel = new BroadcastChannel("pos_channel")
        channel.onmessage = (event) => {
            if (event.data.type === "PAYMENT_COMPLETE" || event.data.type === "PAYMENT_SUCCESS") {
                checkShiftStatus()
            }
        }

        return () => {
            channel.close()
        }
    }, [])

    return (
        <ShiftContext.Provider value={{
            status, activeShiftId, startCash, cashPayments,
            onePayPayments, onePayCount, transferPayments, transferCount,
            checkShiftStatus
        }}>
            {children}
        </ShiftContext.Provider>
    )
}

export function useShift() {
    const context = useContext(ShiftContext)
    if (context === undefined) {
        throw new Error("useShift must be used within a ShiftProvider")
    }
    return context
}
