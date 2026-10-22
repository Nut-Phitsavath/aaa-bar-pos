"use client"

import Image from "next/image"
import { Beer, CupSoda, Martini, Package, Utensils, Wine, type LucideIcon } from "lucide-react"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { formatTHB } from "@/lib/currency"

// One card, both screens. The till and the menu manager show the same products,
// so a person who learns the grid on /pos should recognise it on /menu and know
// that this is where that gets changed. Two copies of "a product" drifted into
// two different shapes; this is the copy.

// Colour and glyph per category, so a row is identifiable before it is read.
// This is an information channel, not decoration: staff reach for "a beer" or
// "a cocktail" long before they read which one, and every tile carrying the
// same grey box was what made the list scan as a spreadsheet. A real photo,
// when the owner supplies one, replaces the glyph and keeps the tint.
const CATEGORY_STYLE: Record<string, { bg: string; fg: string; Icon: LucideIcon }> = {
  Beer: { bg: "bg-amber-100", fg: "text-amber-800", Icon: Beer },
  Sets: { bg: "bg-violet-100", fg: "text-violet-700", Icon: Package },
  Spirits: { bg: "bg-rose-100", fg: "text-rose-700", Icon: Wine },
  Cocktails: { bg: "bg-sky-100", fg: "text-sky-700", Icon: Martini },
  Mixers: { bg: "bg-teal-100", fg: "text-teal-700", Icon: CupSoda },
  Snacks: { bg: "bg-emerald-100", fg: "text-emerald-700", Icon: Utensils },
}
const FALLBACK_STYLE = { bg: "bg-slate-100", fg: "text-slate-400", Icon: Package }

/** The shape both pages already have; neither had to change its fetch. */
export type MenuCardItem = {
  name: string
  localName?: string
  category: string
  image?: string
  price: number
}

type Props = {
  item: MenuCardItem
  /** Grid position: the first screenful of photos is worth fetching eagerly. */
  index?: number
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void
  /** Right-hand slot. The menu manager hangs edit/delete here, the till nothing. */
  trailing?: React.ReactNode
  /** Sits beside the price: flags about the item, not about the page. */
  children?: React.ReactNode
} & Omit<React.ComponentProps<"div">, "onClick" | "children">

export function MenuItemCard({ item, index = 0, onClick, trailing, children, className, ...rest }: Props) {
  const price = item.price
  const style = CATEGORY_STYLE[item.category] ?? FALLBACK_STYLE

  return (
    <Card
      onClick={onClick}
      className={cn(
        "p-2 bg-white border-slate-200 shadow-none transition-colors duration-150 hover:bg-amber-50 hover:border-amber-300",
        onClick && "cursor-pointer",
        className,
      )}
      {...rest}
    >
      {/* A row, not a tile. A full-bleed square image ties cell height to column
          width, which is what capped the grid at two visible rows; as a fixed
          thumbnail the photo stays - staff recognise a bottle faster than they
          read one - while row height follows the type instead.

          Amber is the hover state, not the resting one: a grid where every tile
          is already the accent colour has nowhere left to go when you touch it,
          and reads as one flat wall. */}
      <div className="flex items-center gap-3">
        <div className={`relative w-16 h-16 shrink-0 rounded-lg overflow-hidden ${style.bg}`}>
          {item.image && item.image !== "/placeholder.svg" ? (
            <Image
              src={item.image}
              alt={item.name}
              fill
              className="object-cover"
              sizes="64px"
              priority={index < 12}
            />
          ) : (
            <div className={`w-full h-full flex items-center justify-center ${style.fg}`}>
              <style.Icon className="w-7 h-7" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-base leading-tight text-slate-800 truncate">
            {item.localName || item.name}
          </h3>
          {item.localName && (
            <p className="text-xs leading-tight text-slate-500 font-medium truncate mt-0.5">{item.name}</p>
          )}
          {((Number.isFinite(price) && price > 0) || children) && (
            <div className="flex items-center gap-1.5 mt-1 min-w-0">
              {Number.isFinite(price) && price > 0 && (
                <span className="text-[15px] font-bold text-slate-900 tabular-nums">
                  {formatTHB(price)}
                </span>
              )}
              {children}
            </div>
          )}
        </div>
        {trailing && <div className="flex items-center shrink-0">{trailing}</div>}
      </div>
    </Card>
  )
}
