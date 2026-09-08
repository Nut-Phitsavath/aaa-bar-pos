"use client"

import { Label } from "@/components/ui/label"
import { FormattedTextInput } from "@/components/ui/formatted-text-input"
import { FormattedNumberInput } from "@/components/ui/formatted-number-input"
import { useTranslation } from "@/hooks/use-translation"
import { BASE_UNIT, describeConversion, type MeasureType } from "@/lib/units"

/**
 * How an ingredient is measured, bought, and converted between the two.
 *
 * Lives in its own component because two screens create ingredients - the
 * inventory page and the recipe builder's picker - and a form with a guardrail
 * in it kept in two copies is two guardrails that drift.
 *
 * The order is the point. Measure type is asked first because it decides
 * everything under it: the base unit follows from it rather than being typed,
 * which is how "bottle" came to mean EACH for a beer and VOLUME for a spirit
 * in the same column.
 */

export type UnitFormValue = {
    name: string
    measureType: MeasureType
    purchaseUnit: string
    /** Held as a string like every other field on these forms. */
    purchaseMultiplier: string
    cost: string
}

export function UnitFields({
    value,
    onChange,
    locked = false,
}: {
    value: UnitFormValue
    onChange: (next: UnitFormValue) => void
    /** Stock has already moved against this ingredient and the caller may not override. */
    locked?: boolean
}) {
    const { t } = useTranslation()
    const measureTypes: MeasureType[] = ["WEIGHT", "VOLUME", "EACH"]
    const labelFor = (mt: MeasureType) =>
        mt === "WEIGHT" ? t.measure_weight : mt === "VOLUME" ? t.measure_volume : t.measure_each

    const echo = describeConversion({
        name: value.name,
        measureType: value.measureType,
        purchaseUnit: value.purchaseUnit,
        purchaseMultiplier: Number(value.purchaseMultiplier),
        cost: Number(value.cost),
    })

    return (
        <div className="space-y-4">
            <div className="space-y-2">
                <Label className="text-xs font-black text-slate-400 uppercase tracking-widest">
                    {t.measure_type}
                </Label>
                {/* A segmented control rather than a select: three options at a
                    touch till is one tap instead of two, and all three stay
                    visible so the choice can be compared rather than recalled. */}
                <div
                    role="radiogroup"
                    aria-label={t.measure_type}
                    className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-2xl"
                >
                    {measureTypes.map((mt) => {
                        const active = value.measureType === mt
                        return (
                            <button
                                key={mt}
                                type="button"
                                role="radio"
                                aria-checked={active}
                                disabled={locked}
                                onClick={() =>
                                    onChange({
                                        ...value,
                                        measureType: mt,
                                        // A whole-unit item buys and counts in the same thing.
                                        purchaseMultiplier: mt === "EACH" ? "1" : value.purchaseMultiplier,
                                    })
                                }
                                className={`h-14 rounded-xl px-2 font-bold transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed ${
                                    active
                                        ? "bg-white shadow-sm text-amber-700"
                                        : "text-slate-500 hover:text-slate-900 hover:bg-white/60"
                                }`}
                            >
                                {labelFor(mt)}
                                <span className="block text-[10px] font-bold uppercase tracking-widest opacity-60">
                                    {BASE_UNIT[mt]}
                                </span>
                            </button>
                        )
                    })}
                </div>
                {locked ? (
                    <p className="text-xs font-semibold text-amber-700">{t.units_locked}</p>
                ) : (
                    <p className="text-xs text-slate-400">{t.measure_type_help}</p>
                )}
            </div>

            {/* The conversion, asked once here - this is the number that used to
                be smeared across every recipe row as a repeating decimal. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-2">
                    <Label className="text-xs font-black text-slate-400 uppercase tracking-widest">
                        {t.purchase_unit_label}
                    </Label>
                    <FormattedTextInput
                        value={value.purchaseUnit}
                        disabled={locked}
                        placeholder={t.purchase_unit_placeholder}
                        onChange={(v: string) => onChange({ ...value, purchaseUnit: v })}
                    />
                </div>
                {value.measureType !== "EACH" && (
                    <div className="space-y-2">
                        <Label className="text-xs font-black text-slate-400 uppercase tracking-widest">
                            {t.purchase_multiplier_label}
                        </Label>
                        <div className="relative">
                            <FormattedNumberInput
                                allowDecimals
                                value={value.purchaseMultiplier}
                                disabled={locked}
                                className="pr-14 tabular-nums"
                                onChange={(v: string) => onChange({ ...value, purchaseMultiplier: v })}
                            />
                            <span className="absolute right-4 top-1/2 -translate-y-1/2 font-black text-slate-300 pointer-events-none uppercase text-xs tracking-widest">
                                {BASE_UNIT[value.measureType]}
                            </span>
                        </div>
                    </div>
                )}
            </div>

            {/* The guardrail. Deliberately prose in the form's own flow rather
                than a boxed callout: it is a sentence to read back, not a status
                to notice. The numbers carry the weight, so the eye lands on the
                part that can be wrong - 0.64 per ml against 64.29 per ml. */}
            <p aria-live="polite" className="text-sm leading-relaxed text-slate-500">
                {echo.valid
                    ? echo.sentence.split(/([\d.,]+)/).map((part, i) =>
                          /^[\d.,]+$/.test(part) ? (
                              <strong key={i} className="font-bold text-slate-900 tabular-nums">
                                  {part}
                              </strong>
                          ) : (
                              part
                          )
                      )
                    : t.measure_type_help}
            </p>
        </div>
    )
}
