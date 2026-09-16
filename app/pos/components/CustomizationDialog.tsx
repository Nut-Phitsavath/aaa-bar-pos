import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
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
    ShoppingBag
} from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { flyToCart } from "./fly-to-cart"

interface CustomizationDialogProps {
    isOpen: boolean
    onClose: () => void
    onConfirm: (selection: {
        menuId: string
        name: string
        localName?: string
        price: number
        sugar: string
        shot: string
        isTakeaway: boolean
        note: string
    }) => void
    menuName: string
    localName?: string
    /** The item being added. Price is a flat property on the menu item now —
     * there is no variation/size table underneath it to look a price up in. */
    menuId: string
    price: number
    hasSugarLevel?: boolean
    hasShotType?: boolean
    imageUrl?: string
    /**
     * Editing a line already in the cart rather than adding a new one. The
     * dialog is the same; only its verb changes, and it opens holding what the
     * line already says instead of a blank form.
     */
    editing?: {
        sugar?: string
        shot?: string
        isTakeaway?: boolean
        note?: string
    } | null
}


export function CustomizationDialog({
    isOpen,
    onClose,
    onConfirm,
    menuName,
    localName,
    menuId,
    price,
    hasSugarLevel = true,
    hasShotType = true,
    imageUrl,
    editing = null
}: CustomizationDialogProps) {
    const { t } = useTranslation()
    const [sugar, setSugar] = useState("Normal Sweet")
    const [shot, setShot] = useState("Normal Shot")
    const [isTakeaway, setIsTakeaway] = useState(false)
    // Requirement #4's preparation note. OrderItem has carried the field all
    // along; nothing ever offered a way to type one, so "no ice" reached the
    // bar by being shouted across it.
    const [note, setNote] = useState("")

    // Opening on an existing line starts from what that line already says, so
    // a bartender adding "no ice" to a drink that is already takeaway does not
    // silently clear the takeaway by saving.
    useEffect(() => {
        if (!isOpen) return
        setSugar(editing?.sugar ?? "Normal Sweet")
        setShot(editing?.shot ?? "Normal Shot")
        setIsTakeaway(editing?.isTakeaway ?? false)
        setNote(editing?.note ?? "")
        // `editing` is read at open. Re-running on its identity would reset the
        // form under someone mid-type, because the parent rebuilds the object.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen])

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

    const shotPrice = shot === "Double Shot" ? 10000 : 0
    const finalPrice = price + shotPrice

    const handleConfirm = (event: React.MouseEvent<HTMLButtonElement>) => {
        // A menu item created without a price sits at 0, which means "not
        // priced yet", not "on the house". Adding it would ring the drink up
        // free, so the cart refuses it here and /api/orders refuses it again
        // at the boundary. Checked on `price`, not `finalPrice`: a double
        // shot's +10,000 would otherwise disguise an unpriced item as a
        // priced one.
        if (!(price > 0)) {
            notify.warn(t.set_price_before_selling)
            return
        }

        onConfirm({
            menuId,
            name: menuName, // Keep name as the base product name
            localName: localName,
            price: finalPrice,
            sugar: effectiveSugar,
            shot: effectiveShot,
            isTakeaway: isTakeaway,
            note: note.trim(),
        })

        // Editing a line that is already in the cart moves nothing across the
        // screen - there is no journey to show. Only a new drink flies.
        if (!editing) flyToCart(event.currentTarget.getBoundingClientRect(), imageUrl)

        onClose()
    }

    return (
        // modal={false} on purpose. Radix's modal mode locks body scroll and
        // marks the entire page aria-hidden on every open; measured at 4x CPU
        // that machinery alone costs ~257ms, against ~35ms for the same dialog
        // non-modal. It used to open for every line of every order, which made
        // that the single most repeated delay in the app; now it opens only for
        // an item with real choices, or when somebody edits a line. Kept
        // non-modal anyway - 257ms is worth avoiding whenever it does open.
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

                    {/* Preparation note. Free text on purpose: a bar's requests
                        are one-offs ("no ice", "serve last", "in a tall glass")
                        and a fixed list would only ever cover the ones we
                        thought of. It travels to the bar on the ticket. */}
                    <div className="space-y-2">
                        <Label className="text-md" htmlFor="prep-note">{t.prep_note}</Label>
                        <Input
                            id="prep-note"
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder={t.prep_note_placeholder}
                            maxLength={120}
                            className="h-11 text-md"
                        />
                    </div>

                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>{t.cancel || "Cancel"}</Button>
                    <Button onClick={handleConfirm}>
                        {editing ? t.save : `${t.add_to_cart || "Add to Cart"} - ${formatTHB(finalPrice)}`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
