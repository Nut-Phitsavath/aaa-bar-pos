# Inventory Base Units — UI (Plan 2 of 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the base-unit model on screen — an ingredient form built around measure type with a live plain-language conversion echo, a recipe builder showing live cost and margin, inline ingredient creation, a no-recipe flag, and the variance report that reads the stock counts already being collected.

**Architecture:** No schema changes. Every screen consumes what Plan 1 built: `lib/units.ts` for conversion and display, `GET /api/recipes/:productId/cost` for costing. New pure functions go in `lib/units.ts` and a new `lib/ingredient-form.ts` so the guardrails are testable without a DOM.

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind, shadcn/ui, `motion` v13 (already installed), `node --test` with `--experimental-strip-types`.

**Spec:** `docs/superpowers/specs/2026-09-08-inventory-base-units-design.md`
**Predecessor:** `docs/superpowers/plans/2026-09-08-inventory-base-units-foundation.md` (landed: 6 commits, 236 tests)

## Global Constraints

- **No new dependencies.** `motion` v13 is installed and already used in `app/tables/manage/page.tsx`; use it for state transitions only.
- **Preserve the existing design system.** Slate neutrals, `amber-600` primary, `amber-50/100` tints, `emerald-700` positive, `rose-600` danger. `rounded-xl` compact / `rounded-2xl` inputs and dialogs. `font-black tracking-tight` headings, `font-bold` labels, tiny uppercase labels at `tracking-widest`. **`tabular-nums` on every number** — already the convention, and non-negotiable for columns of money.
- **Touch-first sizing.** Inputs `h-14`/`h-16`, focus rings `focus:ring-4 focus:ring-amber-500/10 focus:border-amber-500`. Staff use this at 2am on a till, not a laptop.
- **Every interactive control ships all states**: default, hover, focus, active, disabled, loading, error. A disabled control must say *why* it is disabled.
- **Motion 150–250ms, state-conveying only.** No page-load choreography. Every animation needs a `prefers-reduced-motion` alternative.
- **No modal-on-modal.** Progressive disclosure inside one dialog instead.
- **Bilingual.** Every user-facing string goes in `lib/translations.ts` under both `en` and `lo`. Never hardcode.
- **Tests are `lib/*.test.ts`**, run by `npm test`. Imports inside `lib/` use the `.ts` extension — the suite runs under `--experimental-strip-types`, which resolves value imports at runtime.
- **Commit messages** end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

### Task 1: The conversion echo, as a tested pure function

The echo line is the guardrail on the single field that can silently corrupt
every future stock number. Typing `7` instead of `700` must read back as
obviously wrong *before* anyone saves. Building it as a pure function first
means the guardrail has a test, not just a rendering.

**Files:**
- Modify: `lib/units.ts`
- Test: `lib/units.test.ts`

**Interfaces:**
- Consumes: `MeasureType`, `BASE_UNIT` from `lib/units.ts`
- Produces: `describeConversion(input): { valid: boolean; reason?: string; sentence: string; costPerBase: number | null }`

- [ ] **Step 1: Write the failing test**

Append to `lib/units.test.ts`:

```ts
import { describeConversion } from './units.ts'

test('the echo reads back what was entered, in words', () => {
    const d = describeConversion({
        name: 'Hongthong', measureType: 'VOLUME',
        purchaseUnit: 'bottle', purchaseMultiplier: 700, cost: 450,
    })
    assert.equal(d.valid, true)
    assert.equal(d.costPerBase, 0.64)
    assert.match(d.sentence, /bottle/)
    assert.match(d.sentence, /700 ml/)
    assert.match(d.sentence, /0\.64/)
})

test('a fat-fingered multiplier produces an obviously wrong number', () => {
    // 7 instead of 700. The point of the echo: this reads as 64.29 per ml,
    // which nobody would accept, instead of failing silently months later.
    const d = describeConversion({
        name: 'Hongthong', measureType: 'VOLUME',
        purchaseUnit: 'bottle', purchaseMultiplier: 7, cost: 450,
    })
    assert.equal(d.valid, true)
    assert.equal(d.costPerBase, 64.29)
})

test('a zero or negative multiplier is refused, not rendered', () => {
    for (const m of [0, -700]) {
        const d = describeConversion({
            name: 'X', measureType: 'VOLUME', purchaseUnit: 'bottle',
            purchaseMultiplier: m, cost: 450,
        })
        assert.equal(d.valid, false)
        assert.equal(d.reason, 'MULTIPLIER_MUST_BE_POSITIVE')
    }
})

test('an EACH item says nothing about conversion, because there is none', () => {
    const d = describeConversion({
        name: 'Heineken', measureType: 'EACH',
        purchaseUnit: 'bottle', purchaseMultiplier: 1, cost: 18,
    })
    assert.equal(d.valid, true)
    assert.doesNotMatch(d.sentence, /=/, 'no "1 x = y" clause when they are the same thing')
    assert.equal(d.costPerBase, 18)
})

test('a missing purchase unit is refused before it reaches the sentence', () => {
    const d = describeConversion({
        name: 'X', measureType: 'VOLUME', purchaseUnit: '  ',
        purchaseMultiplier: 700, cost: 450,
    })
    assert.equal(d.valid, false)
    assert.equal(d.reason, 'PURCHASE_UNIT_REQUIRED')
})

test('a zero cost is allowed - not everything has a price yet', () => {
    const d = describeConversion({
        name: 'X', measureType: 'WEIGHT', purchaseUnit: 'kg',
        purchaseMultiplier: 1000, cost: 0,
    })
    assert.equal(d.valid, true)
    assert.equal(d.costPerBase, 0)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --experimental-strip-types --test lib/units.test.ts`
Expected: FAIL — `describeConversion` is not exported.

- [ ] **Step 3: Implement it**

Append to `lib/units.ts`:

```ts
export type ConversionInput = {
    name: string
    measureType: MeasureType
    purchaseUnit: string
    purchaseMultiplier: number
    cost: number
}

export type ConversionEcho = {
    valid: boolean
    reason?: 'MULTIPLIER_MUST_BE_POSITIVE' | 'PURCHASE_UNIT_REQUIRED'
    /** Plain language, for a person to check against what they meant. */
    sentence: string
    /** What one base unit costs, derived and never stored. */
    costPerBase: number | null
}

/**
 * The guardrail on the one field that can silently corrupt every future number.
 *
 * A multiplier is not a value anyone can sanity-check on its own - 700 and 7
 * look equally plausible in a box. Read back as "450 THB/bottle = 0.64 per ml"
 * versus "= 64.29 per ml", the mistake is obvious to anyone who has ever bought
 * a bottle. That is the whole design: make the wrong entry look wrong at the
 * moment it is made, because after the first delivery it is invisible.
 *
 * Pure, so the guardrail is tested rather than merely rendered.
 */
export function describeConversion(input: ConversionInput): ConversionEcho {
    const { name, measureType, purchaseUnit, purchaseMultiplier, cost } = input
    const unit = (purchaseUnit ?? '').trim()
    const baseUnit = BASE_UNIT[measureType]
    const label = name?.trim() || 'This item'

    if (!unit) {
        return { valid: false, reason: 'PURCHASE_UNIT_REQUIRED', sentence: '', costPerBase: null }
    }
    if (!Number.isFinite(purchaseMultiplier) || purchaseMultiplier <= 0) {
        return { valid: false, reason: 'MULTIPLIER_MUST_BE_POSITIVE', sentence: '', costPerBase: null }
    }

    const safeCost = Number.isFinite(cost) && cost > 0 ? cost : 0
    const costPerBase = Math.round((safeCost / purchaseMultiplier) * 100) / 100

    // An EACH item buys and counts in the same thing, so a "1 bottle = 1 each"
    // clause would be noise pretending to be information.
    const conversion = measureType === 'EACH'
        ? ''
        : ` (${purchaseMultiplier} ${baseUnit})`

    const counted = measureType === 'EACH'
        ? `Stock is counted in whole ${unit}s.`
        : `Stock is counted in ${baseUnit}.`

    const priced = safeCost > 0
        ? ` ${safeCost}/${unit} = ${costPerBase} per ${measureType === 'EACH' ? unit : baseUnit}.`
        : ''

    return {
        valid: true,
        sentence: `You buy ${label} by the ${unit}${conversion}. ${counted}${priced}`,
        costPerBase,
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --experimental-strip-types --test lib/units.test.ts`
Expected: PASS, 16 tests (10 existing + 6 new).

- [ ] **Step 5: Commit**

```bash
git add lib/units.ts lib/units.test.ts
git commit -m "feat: the conversion echo is a tested function, not a rendering

A multiplier cannot be sanity-checked on its own: 700 and 7 look equally
plausible in a box. Read back as '0.64 per ml' against '64.29 per ml',
the mistake is obvious to anyone who has bought a bottle.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Whether the units may still be edited

"Immutable once stock has moved" is a rule, and a rule with a `disabled`
attribute but no test is a rule until someone refactors the form.

**Files:**
- Create: `lib/ingredient-form.ts`
- Test: `lib/ingredient-form.test.ts`
- Modify: `app/api/inventory/[id]/route.ts` (enforce server-side)

**Interfaces:**
- Produces: `canEditUnits({ hasMovements, role }): { ok: true } | { ok: false; reason: string }`

- [ ] **Step 1: Write the failing test**

Create `lib/ingredient-form.test.ts`:

```ts
// Run: node --experimental-strip-types --test lib/ingredient-form.test.ts
//
// Changing a multiplier after stock has moved silently rewrites history: every
// past deduction was computed with the old number and none of them get
// recalculated. The guard is here rather than only on the form because a form
// is one client and the route is the boundary.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canEditUnits } from './ingredient-form.ts'

test('a brand new ingredient is fully editable by anyone who can reach the form', () => {
    assert.deepEqual(canEditUnits({ hasMovements: false, role: 'STAFF' }), { ok: true })
})

test('once stock has moved, staff can no longer change the conversion', () => {
    assert.deepEqual(
        canEditUnits({ hasMovements: true, role: 'STAFF' }),
        { ok: false, reason: 'UNITS_LOCKED_AFTER_MOVEMENT' },
    )
})

test('a manager may override, because sometimes the first entry was wrong', () => {
    assert.deepEqual(canEditUnits({ hasMovements: true, role: 'MANAGER' }), { ok: true })
    assert.deepEqual(canEditUnits({ hasMovements: true, role: 'ADMIN' }), { ok: true })
})

test('an unknown role is refused rather than assumed harmless', () => {
    assert.deepEqual(
        canEditUnits({ hasMovements: true, role: 'SOMETHING_NEW' }),
        { ok: false, reason: 'UNITS_LOCKED_AFTER_MOVEMENT' },
    )
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --experimental-strip-types --test lib/ingredient-form.test.ts`
Expected: FAIL — `Cannot find module './ingredient-form.ts'`.

- [ ] **Step 3: Implement**

Create `lib/ingredient-form.ts`:

```ts
/**
 * What may still be changed about an ingredient, and by whom.
 *
 * "Stock has moved" means at least one StockTransaction row references this
 * ingredient - not that stock is non-zero. An ingredient received and fully
 * consumed is back at zero and must stay locked, because the rows recording
 * that consumption were computed with the old multiplier.
 *
 * Pure: the form greys the control and the route refuses the write, and both
 * have to agree about when.
 */

export type EditCheck = { ok: true } | { ok: false; reason: string }

const OVERRIDE_ROLES = ['MANAGER', 'ADMIN']

export function canEditUnits(input: { hasMovements: boolean; role: string }): EditCheck {
    if (!input.hasMovements) return { ok: true }
    // A manager can still fix a genuinely wrong first entry. It is logged by
    // the ordinary update path; what it must not be is quiet and universal.
    if (OVERRIDE_ROLES.includes(input.role)) return { ok: true }
    return { ok: false, reason: 'UNITS_LOCKED_AFTER_MOVEMENT' }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --experimental-strip-types --test lib/ingredient-form.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Enforce it on the route**

In `app/api/inventory/[id]/route.ts`, inside the PUT handler, before writing —
add the guard. It must run whenever any of the four unit fields is being
changed, and be skipped when they are not:

```ts
import { getSessionUser } from '@/lib/auth'
import { canEditUnits } from '@/lib/ingredient-form'

// ...inside PUT, after reading the body and loading `existing`:
const changingUnits =
    (body.measureType !== undefined && body.measureType !== existing.measureType) ||
    (body.baseUnit !== undefined && body.baseUnit !== existing.baseUnit) ||
    (body.purchaseUnit !== undefined && body.purchaseUnit !== existing.purchaseUnit) ||
    (body.purchaseMultiplier !== undefined && body.purchaseMultiplier !== existing.purchaseMultiplier)

if (changingUnits) {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const hasMovements = (await prisma.stockTransaction.count({
        where: { ingredientId: id },
    })) > 0
    const check = canEditUnits({ hasMovements, role: user.role })
    if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 409 })
}
```

- [ ] **Step 6: Verify against the running app**

Start the dev server. As a STAFF user, PUT a changed `purchaseMultiplier` to an
ingredient that has ledger rows (every seeded ingredient has a
`UNIT_MIGRATION` row, so all of them qualify). Expect `409
UNITS_LOCKED_AFTER_MOVEMENT`. Repeat as `manager` / PIN `2468`; expect `200`.
Then PUT only a changed `name` as STAFF and expect `200` — the guard must not
fire when the units are untouched.

- [ ] **Step 7: Commit**

```bash
git add lib/ingredient-form.ts lib/ingredient-form.test.ts "app/api/inventory/[id]/route.ts"
git commit -m "feat: the conversion locks once stock has moved

Changing a multiplier afterwards rewrites history silently - every past
deduction used the old number and none of them get recalculated. A
manager can still fix a genuinely wrong first entry; what it must not be
is quiet and universal.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The ingredient form, rebuilt around measure type

**Files:**
- Modify: `app/inventory/page.tsx` (the add/edit dialog, currently around lines 466-560)
- Modify: `app/api/inventory/route.ts` (accept and validate the four fields on POST)
- Modify: `lib/translations.ts` (new keys, `en` and `lo`)

**Interfaces:**
- Consumes: `describeConversion` (Task 1), `canEditUnits` (Task 2), `BASE_UNIT` from `lib/units.ts`

- [ ] **Step 1: Add the translation keys**

In `lib/translations.ts`, add to **both** the `en` and `lo` objects:

```ts
// en
measure_type: "How is it measured?",
measure_weight: "Weight",
measure_volume: "Volume",
measure_each: "Whole units",
measure_type_help: "Decides how stock is counted. Cannot be changed once stock has moved.",
purchase_unit_label: "How do you buy it?",
purchase_unit_placeholder: "bottle, case, kg",
purchase_multiplier_label: "One contains",
base_unit_derived: "Counted in",
units_locked: "Locked — this ingredient already has stock movements",
units_locked_manager: "You are changing a conversion that past stock movements used.",
cost_per_purchase_unit: "Cost per",
```

```ts
// lo
measure_type: "ວັດແທກແນວໃດ?",
measure_weight: "ນ້ຳໜັກ",
measure_volume: "ປະລິມາດ",
measure_each: "ຫົວໜ່ວຍ",
measure_type_help: "ກຳນົດວິທີນັບສະຕັອກ. ປ່ຽນບໍ່ໄດ້ຫຼັງຈາກສະຕັອກເຄື່ອນໄຫວແລ້ວ.",
purchase_unit_label: "ຊື້ເປັນຫົວໜ່ວຍໃດ?",
purchase_unit_placeholder: "ຂວດ, ແກັດ, ກິໂລ",
purchase_multiplier_label: "ໜຶ່ງຫົວໜ່ວຍມີ",
base_unit_derived: "ນັບເປັນ",
units_locked: "ລັອກແລ້ວ — ວັດຖຸດິບນີ້ມີການເຄື່ອນໄຫວສະຕັອກແລ້ວ",
units_locked_manager: "ທ່ານກຳລັງປ່ຽນການແປງຫົວໜ່ວຍທີ່ການເຄື່ອນໄຫວເກົ່າໄດ້ໃຊ້.",
cost_per_purchase_unit: "ຕົ້ນທຶນຕໍ່",
```

- [ ] **Step 2: Replace the unit block in the form**

In `app/inventory/page.tsx`, replace the single free-text `unit` input with the
measure-type control, the purchase unit pair, and the echo. The segmented
control reuses the size-tab vocabulary already on the recipes screen, so the
two screens speak the same language:

```tsx
{/* Measure type decides everything under it, so it is asked first. A
    segmented control rather than a select: three options at a touch till
    is one tap instead of two, and all three stay visible so the choice
    can be compared rather than remembered. */}
<div className="space-y-2">
    <Label className="text-xs font-black text-slate-400 uppercase tracking-widest">
        {t.measure_type}
    </Label>
    <div
        role="radiogroup"
        aria-label={t.measure_type}
        className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-2xl"
    >
        {(['WEIGHT', 'VOLUME', 'EACH'] as const).map((mt) => {
            const active = formData.measureType === mt
            const label = mt === 'WEIGHT' ? t.measure_weight : mt === 'VOLUME' ? t.measure_volume : t.measure_each
            return (
                <button
                    key={mt}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={unitsLocked}
                    onClick={() => setFormData({
                        ...formData,
                        measureType: mt,
                        baseUnit: BASE_UNIT[mt],
                        // An EACH item buys and counts in the same thing.
                        purchaseMultiplier: mt === 'EACH' ? 1 : formData.purchaseMultiplier,
                    })}
                    className={`h-14 rounded-xl px-4 font-bold transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed
                        ${active
                            ? 'bg-white shadow-sm text-amber-700'
                            : 'text-slate-500 hover:text-slate-900 hover:bg-white/60'}`}
                >
                    {label}
                    <span className="block text-[10px] font-bold uppercase tracking-widest opacity-60">
                        {BASE_UNIT[mt]}
                    </span>
                </button>
            )
        })}
    </div>
    {unitsLocked ? (
        <p className="text-xs text-amber-700 font-semibold">{t.units_locked}</p>
    ) : (
        <p className="text-xs text-slate-400">{t.measure_type_help}</p>
    )}
</div>

{/* How you buy it. Asked once, here - this is the number that used to be
    smeared across every recipe row as a repeating decimal. */}
<div className="grid grid-cols-2 gap-3">
    <div className="space-y-2">
        <Label className="text-xs font-black text-slate-400 uppercase tracking-widest">
            {t.purchase_unit_label}
        </Label>
        <Input
            className="h-14 rounded-2xl bg-slate-50 border-slate-200 focus:ring-4 focus:ring-amber-500/10 focus:border-amber-500"
            placeholder={t.purchase_unit_placeholder}
            value={formData.purchaseUnit}
            disabled={unitsLocked}
            onChange={(e) => setFormData({ ...formData, purchaseUnit: e.target.value })}
        />
    </div>
    {formData.measureType !== 'EACH' && (
        <div className="space-y-2">
            <Label className="text-xs font-black text-slate-400 uppercase tracking-widest">
                {t.purchase_multiplier_label}
            </Label>
            <div className="relative">
                <FormattedNumberInput
                    allowDecimals
                    className="h-14 rounded-2xl bg-slate-50 border-slate-200 pr-16 tabular-nums focus:ring-4 focus:ring-amber-500/10 focus:border-amber-500"
                    value={formData.purchaseMultiplier}
                    disabled={unitsLocked}
                    onChange={(v) => setFormData({ ...formData, purchaseMultiplier: v })}
                />
                <span className="absolute right-5 top-1/2 -translate-y-1/2 font-black text-slate-300 pointer-events-none uppercase text-xs tracking-widest">
                    {BASE_UNIT[formData.measureType as MeasureType]}
                </span>
            </div>
        </div>
    )}
</div>

{/* The guardrail. Deliberately prose in the form's own flow rather than a
    boxed callout: it is a sentence to read back, not a status to notice.
    Numbers carry the weight so the eye lands on the part that can be wrong. */}
{(() => {
    const echo = describeConversion({
        name: formData.name,
        measureType: formData.measureType as MeasureType,
        purchaseUnit: formData.purchaseUnit,
        purchaseMultiplier: Number(formData.purchaseMultiplier),
        cost: Number(formData.cost),
    })
    if (!echo.valid) {
        return (
            <p className="text-sm text-slate-400" aria-live="polite">
                {t.measure_type_help}
            </p>
        )
    }
    return (
        <p
            aria-live="polite"
            className="text-sm text-slate-500 leading-relaxed [&_strong]:text-slate-900 [&_strong]:font-bold [&_strong]:tabular-nums"
            dangerouslySetInnerHTML={{
                __html: echo.sentence.replace(/([\d.,]+)/g, '<strong>$1</strong>'),
            }}
        />
    )
})()}
```

**On the `dangerouslySetInnerHTML`:** the only interpolation is a regex that
wraps digit runs in `<strong>`, over a string this module built itself from
validated numbers plus `name` and `purchaseUnit`. Escape those two before
substituting, or build the sentence as an array of React nodes instead — the
latter is preferable and is the change to make if the sentence ever carries
user text beyond these two fields.

- [ ] **Step 3: Derive `unitsLocked` in the component**

Near the other form state in `app/inventory/page.tsx`:

```tsx
import { canEditUnits } from '@/lib/ingredient-form'

// A movement row, not a non-zero balance: an ingredient received and fully
// consumed is back at zero and must stay locked.
const [unitsLocked, setUnitsLocked] = useState(false)

useEffect(() => {
    if (!editingItem) { setUnitsLocked(false); return }
    fetch(`/api/stock-transactions?ingredientId=${editingItem.id}&limit=1`)
        .then((r) => (r.ok ? r.json() : []))
        .then((rows) => {
            const hasMovements = Array.isArray(rows) ? rows.length > 0 : false
            // Same function the route enforces with. Re-implementing the role
            // list here is how a form and its endpoint start disagreeing.
            setUnitsLocked(!canEditUnits({ hasMovements, role: currentUserRole }).ok)
        })
        .catch(() => setUnitsLocked(false))
}, [editingItem, currentUserRole])
```

Task 3 also needs these imports in `app/inventory/page.tsx`:

```tsx
import { BASE_UNIT, describeConversion, type MeasureType } from '@/lib/units'
import { canEditUnits } from '@/lib/ingredient-form'
```

If `/api/stock-transactions` does not already accept `ingredientId` and
`limit`, add both as optional filters to its `GET` — a `where` clause and a
`take`, nothing more.

- [ ] **Step 4: Accept the fields on POST**

In `app/api/inventory/route.ts`, add the four fields to the destructure and the
`create`, validating the multiplier:

```ts
const { name, unit, measureType, purchaseUnit, purchaseMultiplier, mainStock,
        minStock, maxStock, minStockSub, maxStockSub, cost } = body

if (!name || !purchaseUnit) {
    return NextResponse.json({ error: 'Name and purchase unit are required' }, { status: 400 })
}
const mt = ['WEIGHT', 'VOLUME', 'EACH'].includes(measureType) ? measureType : 'EACH'
const multiplier = mt === 'EACH' ? 1 : Number(purchaseMultiplier)
if (!Number.isFinite(multiplier) || multiplier <= 0) {
    return NextResponse.json({ error: 'MULTIPLIER_MUST_BE_POSITIVE' }, { status: 400 })
}
```

then in `data`: `measureType: mt, baseUnit: BASE_UNIT[mt], purchaseUnit, purchaseMultiplier: multiplier,`
and keep `unit: unit || purchaseUnit` so the legacy column stays populated for
display.

- [ ] **Step 5: Verify in the browser**

Run the app. Create an ingredient: `Bombay Sapphire`, Volume, `bottle`, `700`,
cost `450`. Confirm the echo reads *"You buy Bombay Sapphire by the bottle (700
ml). Stock is counted in ml. 450/bottle = 0.64 per ml."* with the numbers
bolded. Change 700 to 7 and confirm it reads `64.29 per ml`. Save, reopen as
staff, confirm the unit controls are disabled and the amber lock line shows.

Check the layout holds at phone, tablet and desktop widths — the `grid-cols-2`
pair and the `grid-cols-3` segmented control both need to stay legible on a
narrow till screen; drop to `grid-cols-1` under `sm` if they crowd.

- [ ] **Step 6: Commit**

```bash
git add app/inventory/page.tsx app/api/inventory lib/translations.ts
git commit -m "feat: an ingredient form built around how it is measured

Measure type is asked first because it decides everything under it, and
the base unit follows from it rather than being typed - which is how
'bottle' came to mean EACH for a beer and VOLUME for a spirit in the
same column.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Cost and margin on the recipe screen

The endpoint already exists and is verified (`GET /api/recipes/:id/cost`,
returning `cost`, `price`, `margin`, `pourCostPct`, `band`, `verdict`, and a
per-row `lines[]`). This puts it on screen.

**Files:**
- Modify: `app/menu/recipes/page.tsx`
- Modify: `lib/translations.ts`

**Interfaces:**
- Consumes: `GET /api/recipes/[productId]/cost?variationSizeId=` from Plan 1

- [ ] **Step 1: Add translation keys**

`en`: `recipe_cost: "Cost"`, `recipe_margin: "Margin"`, `pour_cost: "Pour cost"`,
`verdict_below_cost: "Sells below cost"`, `verdict_high: "Above band"`,
`verdict_low: "Below band"`, `verdict_ok: "In band"`, `cost_unavailable: "Cost unavailable"`.
`lo`: `recipe_cost: "ຕົ້ນທຶນ"`, `recipe_margin: "ກຳໄລ"`, `pour_cost: "ຕົ້ນທຶນຕໍ່ຈອກ"`,
`verdict_below_cost: "ຂາຍຕ່ຳກວ່າຕົ້ນທຶນ"`, `verdict_high: "ສູງກວ່າເກນ"`,
`verdict_low: "ຕ່ຳກວ່າເກນ"`, `verdict_ok: "ຢູ່ໃນເກນ"`, `cost_unavailable: "ບໍ່ມີຂໍ້ມູນຕົ້ນທຶນ"`.

- [ ] **Step 2: Fetch the cost when the product or size changes**

```tsx
type CostLine = { name: string; quantity: number; baseUnit: string; cost: number }
type CostInfo = {
    cost: number; price: number; margin: number; pourCostPct: number
    band: [number, number]; verdict: 'BELOW_COST' | 'HIGH' | 'OK' | 'LOW'
    lines: CostLine[]
}

const [costInfo, setCostInfo] = useState<CostInfo | null>(null)
const [costLoading, setCostLoading] = useState(false)

useEffect(() => {
    if (!selectedProduct) { setCostInfo(null); return }
    setCostLoading(true)
    const qs = activeScopeId ? `?variationSizeId=${activeScopeId}` : ''
    fetch(`/api/recipes/${selectedProduct.id}/cost${qs}`)
        .then((r) => (r.ok ? r.json() : null))
        .then(setCostInfo)
        .catch(() => setCostInfo(null))
        .finally(() => setCostLoading(false))
    // Refetches after every recipe edit, so the footer can never disagree
    // with the rows above it.
}, [selectedProduct, activeScopeId, recipe])
```

`activeScopeId` is the currently selected size tab (`null` on the base tab) —
it already exists on this screen as the `Tabs` value; reuse that state rather
than adding another.

- [ ] **Step 3: Per-row cost**

In `RecipeSection`, in the right-hand block of each row, above the existing
quantity display:

```tsx
<div className="text-right">
    <p className="text-xs text-muted-foreground">{t.quantity_used}</p>
    <p className="font-bold text-lg text-slate-900 tabular-nums">
        {item.quantity} {item.unit}
    </p>
    {(() => {
        const line = costInfo?.lines.find((l) => l.name === item.ingredientName)
        if (!line) return null
        return (
            <p className="text-xs text-slate-400 tabular-nums">{formatTHB(line.cost)}</p>
        )
    })()}
</div>
```

- [ ] **Step 4: The footer**

Extend the existing contents-value strip rather than adding a second bar — it
already sits in the right place, already uses `tabular-nums`, and already
colours a good number emerald and a bad one amber. Render this immediately
after it, in the same shell:

```tsx
{/* What it costs against what it sells for. Without this a recipe that
    loses money looks identical to one that does not, and the bar finds
    out at stocktake. This is also where a wrong multiplier finally shows
    itself: gin entered as 7ml per bottle reads as a 1,500% loss. */}
{costLoading ? (
    <div className="h-11 rounded-xl bg-slate-100 animate-pulse" aria-hidden />
) : costInfo && costInfo.lines.length > 0 ? (
    <div className="flex items-center gap-4 flex-wrap px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm">
        <span className="text-slate-600">
            {t.recipe_cost}{' '}
            <strong className="text-slate-900 tabular-nums">{formatTHB(costInfo.cost)}</strong>
        </span>
        <span className="text-slate-300" aria-hidden>·</span>
        <span className="text-slate-600">
            {t.recipe_margin}{' '}
            <strong className="text-slate-900 tabular-nums">{formatTHB(costInfo.margin)}</strong>
        </span>
        <span
            className={`ms-auto font-bold tabular-nums px-2.5 py-1 rounded-lg ${
                costInfo.verdict === 'BELOW_COST' ? 'bg-rose-50 text-rose-700'
                : costInfo.verdict === 'OK' ? 'bg-emerald-50 text-emerald-700'
                : 'bg-amber-50 text-amber-700'
            }`}
        >
            {t.pour_cost} {costInfo.pourCostPct}%
            <span className="font-semibold opacity-70">
                {' '}· {costInfo.verdict === 'BELOW_COST' ? t.verdict_below_cost
                    : costInfo.verdict === 'HIGH' ? t.verdict_high
                    : costInfo.verdict === 'LOW' ? t.verdict_low
                    : t.verdict_ok}
            </span>
        </span>
    </div>
) : null}
```

Note the colour rule: `BELOW_COST` is rose because it loses money, `OK` is
emerald, and both `HIGH` and `LOW` are amber — out of band in either direction
is a question, not a failure.

- [ ] **Step 5: Verify in the browser**

Open `Whisky (glass)`: expect cost ฿10.74, pour 15.3%, emerald *In band*.
Open `Mojito`: ฿47.46, 31.6%, emerald. Temporarily set a menu price below cost
and confirm the chip turns rose and reads *Sells below cost*; put the price back.
Confirm the skeleton shows while loading rather than a spinner, and that the
strip is absent (not empty) for an item with no recipe.

- [ ] **Step 6: Commit**

```bash
git add app/menu/recipes/page.tsx lib/translations.ts
git commit -m "feat: a recipe says what it costs while you build it

A recipe that loses money looked identical to one that did not, and the
bar found out at stocktake. Extends the contents-value strip rather than
adding a second bar - same shell, same vocabulary.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Create an ingredient without leaving the recipe

The three-screen problem: create the ingredient in `/inventory`, the menu item
in `/menu`, then link them in `/menu/recipes`. This collapses it to one screen
for the common case of a recipe needing an ingredient nobody has added yet.

**Files:**
- Modify: `app/menu/recipes/page.tsx`
- Modify: `lib/translations.ts`

- [ ] **Step 1: Add keys**

`en`: `new_ingredient: "New ingredient"`, `back_to_search: "Back to search"`,
`create_and_add: "Create and add"`.
`lo`: `new_ingredient: "ວັດຖຸດິບໃໝ່"`, `back_to_search: "ກັບໄປຄົ້ນຫາ"`,
`create_and_add: "ສ້າງ ແລະ ເພີ່ມ"`.

- [ ] **Step 2: Swap the dialog body rather than stacking a modal**

Add `const [creatingIngredient, setCreatingIngredient] = useState(false)` and
render the create form **in place of** the search list inside the existing
`Dialog`, keeping the same shell:

```tsx
{creatingIngredient ? (
    <div className="p-8 space-y-5">
        <button
            type="button"
            onClick={() => setCreatingIngredient(false)}
            className="flex items-center gap-2 text-sm font-bold text-slate-400 hover:text-slate-900 transition-colors"
        >
            <ChevronLeft className="w-4 h-4" /> {t.back_to_search}
        </button>
        {/* Same fields, same order and same echo as the inventory form, so
            the two places that create an ingredient teach one thing. Extract
            the block from app/inventory/page.tsx into
            components/inventory/ingredient-fields.tsx and use it in both
            rather than keeping two copies that drift. */}
        <IngredientFields value={draft} onChange={setDraft} locked={false} />
        <Button
            className="w-full h-16 rounded-2xl bg-amber-600 hover:bg-amber-700 text-lg font-bold"
            disabled={!draft.name || !draft.purchaseUnit || savingIngredient}
            onClick={handleCreateAndAdd}
        >
            {savingIngredient ? <Spinner className="w-5 h-5" /> : t.create_and_add}
        </Button>
    </div>
) : (
    <>
        {/* the existing search + category filter + result list, unchanged */}
    </>
)}
```

**Extract `IngredientFields` first** (Task 3's block, lifted verbatim into
`components/inventory/ingredient-fields.tsx` taking `value`, `onChange`,
`locked`), then use it in both `app/inventory/page.tsx` and here. Two copies of
a form with a guardrail in it is two guardrails that drift.

- [ ] **Step 3: Wire the handler**

The state it needs, declared alongside `creatingIngredient`:

```tsx
/** A blank ingredient, seeded with whatever was typed into the search. */
const emptyDraft = (name = '') => ({
    name,
    categoryId: '',
    measureType: 'EACH' as MeasureType,
    baseUnit: BASE_UNIT.EACH,
    purchaseUnit: '',
    purchaseMultiplier: 1,
    cost: 0,
    mainStock: 0,
    minStock: 0,
    maxStock: 0,
    minStockSub: 0,
    maxStockSub: 0,
})

const [draft, setDraft] = useState(emptyDraft())
const [savingIngredient, setSavingIngredient] = useState(false)
```

```tsx
const handleCreateAndAdd = async () => {
    setSavingIngredient(true)
    try {
        const res = await fetch('/api/inventory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(draft),
        })
        if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            notify.error(err.error || 'Failed to create ingredient')
            return
        }
        const created = await res.json()
        // Straight into the recipe, which is the whole point of being here.
        setIngredients((prev) => [...prev, created])
        setNewRecipeItem({ ...newRecipeItem, ingredientId: created.id })
        setCreatingIngredient(false)
    } finally {
        setSavingIngredient(false)
    }
}
```

- [ ] **Step 4: Add the entry point**

At the foot of the ingredient result list, always visible (not only on an empty
search), so it is discoverable before someone gives up:

```tsx
<button
    type="button"
    onClick={() => { setDraft(emptyDraft(ingredientSearch)); setCreatingIngredient(true) }}
    className="w-full h-14 rounded-2xl border-2 border-dashed border-slate-200 text-slate-500 font-bold hover:border-amber-500 hover:text-amber-700 transition-colors flex items-center justify-center gap-2"
>
    <Plus className="w-4 h-4" /> {t.new_ingredient}
</button>
```

`emptyDraft(ingredientSearch)` seeds `name` with whatever was typed, so
searching for a missing ingredient and then creating it does not ask for the
name twice.

- [ ] **Step 5: Verify**

From a recipe, open the picker, search a name that does not exist, click **New
ingredient**, confirm the name is pre-filled, create it, and confirm it lands
in the recipe without the dialog ever closing. Confirm the back link returns to
the search with the query intact.

- [ ] **Step 6: Commit**

```bash
git add app/menu/recipes/page.tsx components/inventory/ingredient-fields.tsx app/inventory/page.tsx lib/translations.ts
git commit -m "feat: add a missing ingredient without leaving the recipe

Three screens in the right order became one. The dialog swaps its body
rather than stacking a second modal, and both places that create an
ingredient now share one field block so the guardrail cannot drift.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Flag a menu item that deducts no stock

A sellable item with no recipe moves no stock and is invisible until stocktake.
Flagged, not blocked — a corkage fee legitimately has no recipe.

**Files:**
- Modify: `app/menu/page.tsx`
- Modify: `app/menu/recipes/page.tsx` (sort them first)
- Modify: `app/api/menu/route.ts` (return a recipe count)
- Modify: `lib/translations.ts`

- [ ] **Step 1: Return the count**

In `app/api/menu/route.ts`, add to the `findMany`:

```ts
_count: { select: { recipes: true } },
```

- [ ] **Step 2: The chip**

`en`: `no_recipe: "No recipe"`, `no_recipe_help: "Sells, but moves no stock"`.
`lo`: `no_recipe: "ບໍ່ມີສູດ"`, `no_recipe_help: "ຂາຍໄດ້ ແຕ່ບໍ່ຕັດສະຕັອກ"`.

In the menu list row:

```tsx
{item._count?.recipes === 0 && (
    <Badge
        variant="outline"
        className="bg-amber-50 text-amber-700 border-amber-200 font-bold uppercase text-[10px] tracking-wider"
        title={t.no_recipe_help}
    >
        {t.no_recipe}
    </Badge>
)}
```

- [ ] **Step 3: Sort them to the top of the recipe screen**

In `app/menu/recipes/page.tsx`, where the product list is built:

```tsx
// Items that deduct nothing are the ones somebody came here to fix.
const sorted = [...products].sort((a, b) => {
    const an = (a._count?.recipes ?? 0) === 0 ? 0 : 1
    const bn = (b._count?.recipes ?? 0) === 0 ? 0 : 1
    return an - bn || a.name.localeCompare(b.name)
})
```

- [ ] **Step 4: Verify**

Create a menu item with no recipe; confirm the amber chip appears in the menu
list and the item sorts to the top of the recipe screen. Confirm items that do
have recipes carry no chip.

- [ ] **Step 5: Commit**

```bash
git add app/menu/page.tsx app/menu/recipes/page.tsx app/api/menu/route.ts lib/translations.ts
git commit -m "feat: say when a menu item deducts no stock

Sellable and invisible until stocktake. Flagged rather than blocked - a
corkage fee legitimately has no recipe.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: The variance report

`StockCount` has been faithfully storing `theoreticalStock`, `actualStock` and
`difference`, and nothing anywhere reads it. Now that counts actually save
(Plan 1's `shopStock` fix), the data will start arriving.

**Files:**
- Create: `app/api/reports/variance/route.ts`
- Create: `components/reports/variance.tsx`
- Modify: `app/reports/page.tsx` (add the tab)
- Modify: `lib/translations.ts`

**Interfaces:**
- Consumes: `formatDual` from `lib/stock.ts`, `Ingredient.cost` / `purchaseMultiplier`
- Produces: `GET /api/reports/variance?startDate=&endDate=`

- [ ] **Step 1: The endpoint**

```ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * What the shelf said against what the till thought (req #22's other half).
 *
 * The count sheet has been collected and dropped on the floor: StockCount has
 * stored theoretical, actual and difference all along and nothing read it
 * back. Valued at cost, because "six bottles short" and "6,000 baht short" are
 * the same fact told to two different people.
 */
export async function GET(request: Request) {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    try {
        const { searchParams } = new URL(request.url)
        const start = new Date(`${searchParams.get('startDate') || new Date().toISOString().split('T')[0]}T00:00:00.000Z`)
        const end = new Date(`${searchParams.get('endDate') || new Date().toISOString().split('T')[0]}T23:59:59.999Z`)

        const counts = await prisma.stockCount.findMany({
            where: { createdAt: { gte: start, lte: end } },
            include: {
                ingredient: { select: { name: true, measureType: true, purchaseUnit: true, purchaseMultiplier: true, cost: true } },
                user: { select: { name: true } },
            },
            orderBy: { createdAt: 'desc' },
        })

        const rows = counts.map((c) => ({
            id: c.id,
            countedAt: c.createdAt,
            countedBy: c.user?.name ?? '—',
            ingredient: c.ingredient.name,
            measureType: c.ingredient.measureType,
            purchaseUnit: c.ingredient.purchaseUnit,
            purchaseMultiplier: c.ingredient.purchaseMultiplier,
            theoretical: c.theoreticalStock,
            actual: c.actualStock,
            difference: c.difference,
            // Cost is per purchase unit; difference is in base units.
            valueAtCost: Math.round(c.difference * (c.ingredient.cost / (c.ingredient.purchaseMultiplier || 1)) * 100) / 100,
            notes: c.notes,
        }))

        return NextResponse.json({
            rows,
            shrinkage: Math.round(rows.filter((r) => r.valueAtCost < 0).reduce((s, r) => s + r.valueAtCost, 0) * 100) / 100,
            overage: Math.round(rows.filter((r) => r.valueAtCost > 0).reduce((s, r) => s + r.valueAtCost, 0) * 100) / 100,
        })
    } catch (error) {
        console.error('[variance] GET failed', error)
        return NextResponse.json({ error: 'Failed to load variance' }, { status: 500 })
    }
}
```

- [ ] **Step 2: The component**

`components/reports/variance.tsx`, following the shape of the existing
`components/reports/void-audit.tsx` (same date props, same table vocabulary,
same empty state). Columns: counted at, ingredient, theoretical, actual,
difference, value at cost, who. Use `formatDual` for the three quantity columns
so they read like the audit sheet, `tabular-nums` throughout, and colour a
negative difference `rose-600` and a positive one `emerald-700`.

An empty state that teaches rather than says nothing:

> *No counts in this range. Print the audit sheet from Inventory, count the shelf, and enter what you find.*

- [ ] **Step 3: Add the tab**

In `app/reports/page.tsx`, add `<TabsTrigger value="variance">{t.variance}</TabsTrigger>`
beside the existing `voids` and `exchanges` triggers, and the matching
`<TabsContent value="variance">` rendering the component with the page's
existing `startDate` / `endDate`.

`en`: `variance: "Stock variance"`, `shrinkage: "Shrinkage"`, `overage: "Overage"`,
`counted_by: "Counted by"`, `no_counts_yet: "No counts in this range. Print the audit sheet from Inventory, count the shelf, and enter what you find."`
`lo`: `variance: "ຜົນຕ່າງສະຕັອກ"`, `shrinkage: "ສະຕັອກຂາດ"`, `overage: "ສະຕັອກເກີນ"`,
`counted_by: "ຜູ້ນັບ"`, `no_counts_yet: "ບໍ່ມີການນັບໃນຊ່ວງນີ້. ພິມໃບກວດສະຕັອກຈາກສາງ, ນັບເຄື່ອງ, ແລ້ວປ້ອນຜົນ."`

- [ ] **Step 4: Verify**

Submit a stock count with a discrepancy (this works now — Plan 1 fixed it), then
open Reports → Stock variance and confirm the row appears with the right sign,
the right value at cost, and the counter's name. Confirm the empty state shows
for a date range with no counts.

- [ ] **Step 5: Commit**

```bash
git add app/api/reports/variance components/reports/variance.tsx app/reports/page.tsx lib/translations.ts
git commit -m "feat: the count sheet is read, not just collected

StockCount has stored theoretical, actual and difference all along and
nothing anywhere read it back. Valued at cost, because 'six bottles
short' and '6,000 baht short' are the same fact told to two people.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review notes

**Spec coverage.** Spec section "UI" → Tasks 3 (ingredient form + echo), 4
(recipe cost/margin), 5 (inline creation), 6 (no-recipe flag). "Permissions" →
Task 2, enforced on the route as well as the form. "Variance report" from the
cross-check → Task 7. Tasks 1 and 2 exist so the two guardrails in this plan —
the conversion echo and the units lock — are tested functions rather than
untested renderings.

**Deliberately deferred, and why.**
- **Par levels entered in purchase units.** The spec asks for it; it is a
  display conversion on four existing fields and adds nothing the echo does
  not already teach. Do it when someone finds the base-unit figures confusing
  in practice.
- **The `dangerouslySetInnerHTML` in Task 3** is flagged inline with the
  condition under which it must become React nodes. Left as-is because the
  only interpolated values are a validated number and two fields this form
  owns, and the node version is materially more code for no behaviour change
  today.

**Known ordering constraint.** Task 5 extracts `IngredientFields` from the
block Task 3 writes, so Task 3 must land first. Tasks 4, 6 and 7 are
independent of each other and of 1–3.

**Open question still not decided** (carried from the spec, and Task 3 assumes
the permissive answer): whether staff should set the multiplier at all, or only
create the ingredient and have a manager confirm the conversion before it goes
live. Task 3 lets staff set it and relies on the echo; Task 2 locks it
afterwards. If you want the stricter flow, it is a change to `canEditUnits` and
one extra state on the ingredient, not a redesign.
