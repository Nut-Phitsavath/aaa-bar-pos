import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { useState, useEffect } from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "@/hooks/use-translation"
import { notify } from "@/components/ui/sonner"
import { formatTHB } from "@/lib/currency"
import {
    Droplet,
    Droplets,
    CandyOff,
    Candy,
    Coffee,
    Minus,
    Trash2,
    ShoppingBag
} from "lucide-react"
import { Switch } from "@/components/ui/switch"

interface MenuVariation {
    id: string
    type: string
    displayOrder?: number
    sizes: {
        id: string
        size: string
        price: number
        displayOrder?: number
    }[]
}

interface CustomizationDialogProps {
    isOpen: boolean
    onClose: () => void
    onConfirm: (selection: {
        variationSizeId: string
        name: string
        localName?: string
        price: number
        sugar: string
        shot: string
        variation: string
        size: string
        isTakeaway: boolean
    }) => void
    menuName: string
    localName?: string
    variations: MenuVariation[]
    hasSugarLevel?: boolean
    hasShotType?: boolean
    imageUrl?: string
}


export function CustomizationDialog({
    isOpen,
    onClose,
    onConfirm,
    menuName,
    localName,
    variations,
    hasSugarLevel = true,
    hasShotType = true,
    imageUrl
}: CustomizationDialogProps) {
    const { t } = useTranslation()
    const [sugar, setSugar] = useState("Normal Sweet")
    const [shot, setShot] = useState("Normal Shot")
    const [selectedVariation, setSelectedVariation] = useState<string>("")
    const [selectedSize, setSelectedSize] = useState<string>("")
    const [isTakeaway, setIsTakeaway] = useState(false)

    // Reset defaults when opening
    useEffect(() => {
        if (isOpen && variations.length > 0) {
            setSugar("Normal Sweet")
            setShot("Normal Shot")

            // Set default variation (first available)
            const defaultVar = variations[0]
            setSelectedVariation(defaultVar.type)

            // Set default size (M if available, otherwise first)
            const mSize = defaultVar.sizes.find(s => s.size === "M")
            setSelectedSize(mSize ? mSize.id : defaultVar.sizes[0]?.id || "")
            setIsTakeaway(false)
        }
    }, [isOpen, variations])

    const sugarOptions = [
        { label: "No Sweet", icon: CandyOff, key: "no_sweet" },
        { label: "Less Sweet", icon: Droplet, key: "less_sweet" },
        { label: "Normal Sweet", icon: Droplets, key: "normal_sweet" },
        { label: "Extra Sweet", icon: Candy, key: "extra_sweet" }

    ]
    const shotOptions = [
        { label: "Reduced Shot", level: 0.5, key: "reduced_shot" },
        { label: "Normal Shot", level: 1, key: "normal_shot" },
        { label: "Double Shot", level: 2, key: "double_shot", priceHint: "+10,000" }
    ]

    const effectiveSugar = hasSugarLevel ? sugar : "Normal Sweet"
    const effectiveShot = hasShotType ? shot : "Normal Shot"

    // Get current variation object
    const currentVariation = variations.find(v => v.type === selectedVariation)

    // Get selected size details
    const selectedSizeObj = currentVariation?.sizes.find(s => s.id === selectedSize)
    const basePrice = selectedSizeObj?.price || 0
    const shotPrice = shot === "Double Shot" ? 10000 : 0
    const finalPrice = basePrice + shotPrice

    const handleVariationChange = (varType: string) => {
        setSelectedVariation(varType)
        const newVar = variations.find(v => v.type === varType)
        if (newVar) {
            // Try to keep same size if available
            const sameSize = newVar.sizes.find(s => s.size === selectedSizeObj?.size)
            if (sameSize) {
                setSelectedSize(sameSize.id)
            } else {
                // Default to first size
                setSelectedSize(newVar.sizes[0]?.id || "")
            }
        }
    }

    const handleConfirm = (event: React.MouseEvent<HTMLButtonElement>) => {
        if (!selectedSize || !selectedSizeObj) {
            notify.warn(t.please_select_customization)
            return
        }

        onConfirm({
            variationSizeId: selectedSize,
            name: menuName, // Keep name as the base product name
            localName: localName,
            price: finalPrice,
            sugar: effectiveSugar,
            shot: effectiveShot,
            variation: selectedVariation,
            size: selectedSizeObj.size,
            isTakeaway: isTakeaway
        })

        // Flying animation
        const btn = event.currentTarget
        const rect = btn.getBoundingClientRect()
        const cartIcon = document.getElementById('cart-icon-header')
        let targetX = window.innerWidth - 100
        let targetY = 100

        if (cartIcon) {
            const cartRect = cartIcon.getBoundingClientRect()
            targetX = cartRect.left
            targetY = cartRect.top
        }

        const flyingImg = document.createElement('img')
        flyingImg.src = imageUrl && imageUrl !== "/placeholder.svg" ? imageUrl : "/placeholder-logo.png"
        flyingImg.className = 'fixed z-[10000] rounded-md shadow-2xl object-cover pointer-events-none transition-all duration-700 ease-in-out'
        flyingImg.style.width = `100px`
        flyingImg.style.height = `100px`
        flyingImg.style.top = `${rect.top - 50}px`
        flyingImg.style.left = `${rect.left + rect.width / 2 - 50}px`
        document.body.appendChild(flyingImg)

        requestAnimationFrame(() => {
            flyingImg.style.top = `${targetY}px`
            flyingImg.style.left = `${targetX}px`
            flyingImg.style.width = '20px'
            flyingImg.style.height = '20px'
            flyingImg.style.opacity = '0.2'
            flyingImg.style.transform = 'scale(0.1) rotate(180deg)'
        })

        setTimeout(() => {
            flyingImg.remove()
            if (cartIcon) {
                cartIcon.classList.add('scale-125', 'text-amber-500')
                setTimeout(() => cartIcon.classList.remove('scale-125', 'text-amber-500'), 200)
            }
        }, 700)

        onClose()
    }

    return (
        // modal={false} on purpose. Radix's modal mode locks body scroll and
        // marks the entire page aria-hidden on every open; measured at 4x CPU
        // that machinery alone costs ~257ms, against ~35ms for the same dialog
        // non-modal. This dialog opens for every line of every order, so that
        // is the single most repeated delay in the app.
        //
        // The cost of turning it off is that Radix stops rendering its overlay
        // (Dialog.Overlay returns null when non-modal) and the menu grid behind
        // stays tappable -- a cashier could tap another product mid-selection
        // and swap the item under themselves. The backdrop below replaces it:
        // same dimming, and it swallows pointer events so the grid cannot be
        // reached. onPointerDownOutside is still prevented, so tapping the
        // backdrop does not close the dialog, exactly as before.
        <Dialog open={isOpen} onOpenChange={onClose} modal={false}>
            {isOpen && createPortal(
                <div
                    // z-50, not z-40: the sidebar is also z-50, and this is
                    // portalled to the end of <body>, so at equal z-index it
                    // paints above it -- exactly how the Radix overlay it
                    // replaces used to dim the sidebar too. At z-40 the sidebar
                    // stayed bright while the rest of the page dimmed.
                    // DialogContent is z-50 as well but portals after this one,
                    // so it still sits on top.
                    className="fixed inset-0 z-50 bg-black/50 animate-in fade-in-0"
                    // Not a control -- the close button and Escape are the ways out.
                    aria-hidden="true"
                />,
                document.body
            )}
            <DialogContent className="sm:max-w-[500px]" onPointerDownOutside={(e) => e.preventDefault()}>
                <DialogHeader>
                    <DialogTitle className="text-xl">{menuName} - {formatTHB(finalPrice)}</DialogTitle>
                    <DialogDescription className="text-md">
                        {t.customization}
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-0">

                    {/* Variation Type */}
                    <div className="space-y-2">
                        <Label className="text-md">{t.variation || "Variation"}</Label>
                        <div className="flex flex-wrap gap-2">
                            {[...variations]
                                .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0))
                                .map((variation) => (
                                    <Button
                                        key={variation.type}
                                        variant={selectedVariation === variation.type ? "default" : "outline"}
                                        onClick={() => handleVariationChange(variation.type)}
                                        className="flex-1"
                                    >
                                        {variation.type === 'HOT' ? t.hot : variation.type === 'ICE' ? t.ice : variation.type === 'BLEND' ? t.blend : variation.type}
                                    </Button>
                                ))}
                        </div>
                    </div>

                    {/* Size Selection */}
                    <div className="space-y-2">
                        <Label className="text-md">{t.choice || "Choice"}</Label>
                        <div className="flex flex-wrap gap-2">
                            {[...(currentVariation?.sizes || [])]
                                .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0))
                                .map((size) => (
                                    <Button
                                        key={size.id}
                                        variant={selectedSize === size.id ? "default" : "outline"}
                                        onClick={() => setSelectedSize(size.id)}
                                        className="flex-1 h-12"
                                    >
                                        <div className="flex flex-col items-center">
                                            <span className="text-lg font-bold">{size.size === 'S' ? t.s_size : size.size === 'M' ? t.m_size : size.size === 'L' ? t.l_size : size.size}</span>
                                            <span className="text-xs">{formatTHB(size.price)}</span>
                                        </div>
                                    </Button>
                                ))}
                        </div>
                    </div>

                    {/* Sugar Level */}
                    {hasSugarLevel && (
                        <div className="space-y-2">
                            <Label className="text-md">{t.sugar_level || "Sugar Level"}</Label>
                            <div className="grid grid-cols-4 gap-2">
                                {sugarOptions.map(({ label, icon: Icon, key }) => (
                                    <Button
                                        key={label}
                                        variant={sugar === label ? "default" : "outline"}
                                        onClick={() => setSugar(label)}
                                        className="h-14 flex flex-col items-center justify-center gap-1"
                                    >
                                        <Icon className="h-5 w-5" />
                                        <span className="text-sm">{(t as any)[key] || label}</span>
                                    </Button>
                                ))}
                            </div>
                        </div>
                    )}


                    {/* Shot Type */}
                    {hasShotType && (
                        <div className="space-y-2">
                            <Label className="text-md">{t.shot_type || "Shot Type"}</Label>
                            <div className="grid grid-cols-3 gap-2">
                                {shotOptions.map(({ label, level, key }) => (
                                    <Button
                                        key={label}
                                        variant={shot === label ? "default" : "outline"}
                                        onClick={() => setShot(label)}
                                        className="h-14 flex flex-col items-center justify-center gap-1"
                                    >
                                        <div className="flex gap-1 items-center">
                                            {level === 0.5 && <div className="flex gap-1 items-center"><Minus className="h-4 w-4" /> <Coffee className="h-4 w-4" /></div>}

                                            {level >= 1 &&
                                                Array.from({ length: Math.floor(level) }).map((_, i) => (
                                                    <Coffee key={i} className="h-4 w-4" />
                                                ))}
                                        </div>
                                        <span className="text-sm">{(t as any)[key] || label}                                         {key === "double_shot" && <span className="text-[10px] font-bold text-amber-600">(+10,000)</span>}</span>
                                    </Button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Take Away Toggle */}
                    <div className="flex items-center justify-between px-4 py-2 bg-slate-50 rounded-xl border border-slate-100">
                        <div className="flex items-center gap-3">
                            <div className="bg-amber-100 p-2 rounded-lg">
                                <ShoppingBag className="h-5 w-5 text-amber-600" />
                            </div>
                            <div>
                                <p className="font-bold text-md">{t.takeaway || "Take Away"}</p>
                                <p className="text-sm text-muted-foreground">{t.takeaway_desc || "Check this if customer wants to take home"}</p>
                            </div>
                        </div>
                        <Switch
                            checked={isTakeaway}
                            onCheckedChange={setIsTakeaway}
                        />
                    </div>

                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>{t.cancel || "Cancel"}</Button>
                    <Button onClick={handleConfirm}>
                        {t.add_to_cart || "Add to Cart"} - {formatTHB(finalPrice)}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
