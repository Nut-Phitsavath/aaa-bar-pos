"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Delete, UserCircle } from "lucide-react"
import { useTranslation } from "@/hooks/use-translation"
import { useBrand, BrandMark, PoweredBy } from "@/components/brand"
import { VENDOR } from "@/lib/brand"

interface User {
    username: string;
    name: string;
    role: string;
}

export default function PinLoginPage() {
    const brand = useBrand()
    const [pin, setPin] = useState("")
    const [error, setError] = useState("")
    const [isLoading, setIsLoading] = useState(false)
    const [isNavigating, setIsNavigating] = useState(false)
    const [users, setUsers] = useState<User[]>([])
    const [selectedUsername, setSelectedUsername] = useState<string>("")
    const router = useRouter()
    const { t } = useTranslation()

    // Fetch users on mount
    useEffect(() => {
        const fetchUsers = async () => {
            try {
                const res = await fetch("/api/auth/users")
                const data = await res.json()
                if (data.users) {
                    setUsers(data.users)
                }
            } catch (err) {
                console.error("Failed to fetch users", err)
            }
        }
        fetchUsers()
    }, [])

    const handleNumberClick = (num: string) => {
        if (!selectedUsername) {
            setError(t.please_select_user_first)
            return
        }
        if (pin.length < 4 && !isNavigating) {
            const newPin = pin + num
            setPin(newPin)
            setError("")
            if (newPin.length === 4 && !isNavigating) {
                // Use a small timeout to allow UI to update before submitting
                setTimeout(() => {
                    if (!isNavigating) {
                        document.getElementById('pin-submit-btn')?.click()
                    }
                }, 100)
            }
        }
    }

    const handleDelete = () => {
        setPin(pin.slice(0, -1))
        setError("")
    }

    const handleSubmit = async () => {
        if (!selectedUsername) {
            setError(t.please_select_user_first)
            return
        }

        if (pin.length < 4) {
            setError("PIN must be at least 4 digits")
            return
        }

        setIsLoading(true)
        setIsNavigating(true)
        setError("")

        try {
            const res = await fetch('/api/auth/pin-login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin, username: selectedUsername })
            })

            const data = await res.json()

            if (res.ok) {
                // Store user data
                localStorage.setItem('user', JSON.stringify(data.user))

                // Redirect based on role - force full reload to clear stale context states
                if (data.user.role === 'ADMIN') {
                    window.location.href = '/dashboard'
                } else {
                    // Floor plan is the working centre of a bar shift; the
                    // table-less counter POS is one tap away from there.
                    window.location.href = '/tables'
                }
                // Don't reset isNavigating or isLoading here
            } else {
                setError(data.error || 'Invalid PIN')
                setPin("")
                setIsNavigating(false)
                setIsLoading(false)
            }
        } catch (err) {
            setError('Login failed. Please try again.')
            setPin("")
            setIsNavigating(false)
            setIsLoading(false)
        }
    }

    const numbers = [
        ['1', '2', '3'],
        ['4', '5', '6'],
        ['7', '8', '9']
    ]

    return (
        // The logo's near-black behind the card, and the shop's own name on it
        // (CaniSoftware's until Settings has one) - this was the cafe's
        // orange gradient and a coffee cup.
        <div className="min-h-screen bg-stone-800 flex flex-col items-center justify-center gap-6 p-4">
            {/* One column on a tall screen; on a landscape till (till-wide, see
                globals.css) the name and PIN on the left and the keypad on the
                right, because stacked it ran 200px off a 768px-high screen and
                hid the Enter button. */}
            <Card className="w-full max-w-md p-8 till-wide:max-w-3xl till-wide:grid till-wide:grid-cols-2 till-wide:gap-10 till-wide:items-center">
                <div>
                <div className="text-center mb-8">
                    <div className="flex justify-center mb-4">
                        <BrandMark brand={brand} className="w-16 h-16 text-[18px]" />
                    </div>
                    {brand.custom && brand.title !== VENDOR.name ? (
                        <h1 className="font-brand text-3xl font-bold tracking-[0.06em] text-stone-900 mb-2">
                            {brand.title}{brand.subtitle && <span className="block text-xs font-bold tracking-[0.2em] uppercase text-stone-600 mt-1.5 font-sans">{brand.subtitle}</span>}
                        </h1>
                    ) : (
                        <h1 className="text-3xl font-black tracking-tight mb-2">
                            <span className="text-amber-800">CANI</span><span className="text-stone-900">SOFTWARE</span>
                        </h1>
                    )}
                    <p className="text-muted-foreground">{t.select_user_enter_pin}</p>
                </div>

                {/* User Selection */}
                <div className="mb-6 relative">
                    <UserCircle className="absolute left-3 top-1/2 -translate-y-1/2 w-6 h-6 text-amber-800 pointer-events-none" />
                    <select
                        className="w-full p-4 pl-12 rounded-xl border-2 border-amber-200 bg-white text-lg font-bold text-slate-800 focus:outline-none focus:border-amber-500 appearance-none shadow-sm cursor-pointer"
                        value={selectedUsername}
                        onChange={(e) => {
                            setSelectedUsername(e.target.value)
                            setPin("")
                            setError("")
                        }}
                        disabled={isLoading || isNavigating}
                    >
                        <option value="" disabled>{t.select_user}</option>
                        {users.map(u => (
                            <option key={u.username} value={u.username}>{u.name} ({u.role})</option>
                        ))}
                    </select>
                </div>

                {/* PIN Display */}
                <div className="mb-8">
                    <div className="flex justify-center gap-3 mb-2">
                        {[0, 1, 2, 3].map((i) => (
                            <div
                                key={i}
                                className={`w-12 h-12 rounded-lg border-2 flex items-center justify-center text-2xl font-bold ${i < pin.length
                                    ? 'bg-amber-600 border-amber-600 text-amber-950'
                                    : 'bg-white border-gray-300'
                                    }`}
                            >
                                {i < pin.length ? '•' : ''}
                            </div>
                        ))}
                    </div>
                    {error && (
                        <p className="text-center text-red-600 text-sm mt-2 font-medium">{error}</p>
                    )}
                </div>

                </div>

                <div>
                {/* Number Pad */}
                <div className="space-y-3 mb-4">
                    {numbers.map((row, rowIndex) => (
                        <div key={rowIndex} className="grid grid-cols-3 gap-3">
                            {row.map((num) => (
                                <Button
                                    key={num}
                                    variant="outline"
                                    className="h-16 text-2xl font-semibold hover:bg-amber-100 disabled:opacity-50"
                                    onClick={() => handleNumberClick(num)}
                                    disabled={isLoading || isNavigating || !selectedUsername}
                                >
                                    {num}
                                </Button>
                            ))}
                        </div>
                    ))}
                    {/* Bottom row with 0 in the middle */}
                    <div className="grid grid-cols-3 gap-3">
                        <div></div>
                        <Button
                            variant="outline"
                            className="h-16 text-2xl font-semibold hover:bg-amber-100 disabled:opacity-50"
                            onClick={() => handleNumberClick('0')}
                            disabled={isLoading || isNavigating || !selectedUsername}
                        >
                            0
                        </Button>
                        <div></div>
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="grid grid-cols-2 gap-3">
                    <Button
                        variant="outline"
                        className="h-12 border-amber-200 text-amber-800 hover:bg-amber-50 hover:text-amber-800"
                        onClick={handleDelete}
                        disabled={isLoading || isNavigating || pin.length === 0}
                    >
                        <Delete className="w-5 h-5 mr-2" />
                        {t.delete}
                    </Button>
                    <Button
                        id="pin-submit-btn"
                        className="h-12 bg-amber-600 hover:bg-amber-700 text-amber-950 shadow-md relative"
                        onClick={handleSubmit}
                        disabled={isLoading || isNavigating || pin.length < 4}
                    >
                        {isLoading || isNavigating ? t.logging_in : t.enter_login}
                    </Button>
                </div>
                </div>
            </Card>
            <PoweredBy brand={brand} className="text-[11px]" />
        </div>
    )
}
