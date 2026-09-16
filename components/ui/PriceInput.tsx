import * as React from "react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type PriceInputProps = {
  id?: string
  value: number
  onChange: (num: number) => void
  placeholder?: string
  className?: string
  currency?: string // new
}

export function PriceInput({
  id,
  value,
  onChange,
  placeholder,
  className,
  currency = "₭",
}: PriceInputProps) {
  const [display, setDisplay] = React.useState("")

  React.useEffect(() => {
    setDisplay(value ? Number(value).toLocaleString() : "")
  }, [value])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, "")
    setDisplay(raw === "" ? "" : Number(raw).toLocaleString())
    onChange(raw === "" ? 0 : Number(raw))
  }

  return (
    <div className="relative">
      {currency && (
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">
          {currency}
        </span>
      )}
      <Input
        id={id}
        type="text"
        inputMode="numeric"
        value={display}
        onChange={handleChange}
        placeholder={placeholder}
        className={cn(
          className,
          currency ? "pl-8" : "" // add padding if currency exists
        )}
      />
    </div>
  )
}
