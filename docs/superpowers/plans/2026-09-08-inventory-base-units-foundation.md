# Inventory Base Units — Foundation (Plan 1 of 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every stock movement an audit row, move all stock and recipe quantities onto real base units, and lift the existing pour-cost logic into a library the UI can call.

**Architecture:** Additive schema change on `Ingredient` (measure type, base unit, purchase unit, multiplier). A single reversible migration converts existing stock and recipe quantities into base units. `decrementStock` gains a required movement descriptor and writes a `StockTransaction` row inside the same database transaction as the balance update, so a sale can no longer move stock silently. Pure conversion arithmetic lives in a new `lib/units.ts` with no Prisma import, so it is testable without a database.

**Tech Stack:** Next.js 15 App Router, Prisma 5 + SQLite, TypeScript, `node --test` with `--experimental-strip-types`.

**Spec:** `docs/superpowers/specs/2026-09-08-inventory-base-units-design.md`

## Scope note — this is Plan 1 of 2

The spec covers two separable halves. This plan is the data foundation
(spec sections "The stock ledger", "Schema", "Migration", "Code changes",
and the `lib/pour-cost.ts` row of the code table). It ships working,
testable software on its own: it fixes the silent-sale audit gap and the
float drift without changing a single screen.

**Plan 2 (the UI — ingredient form, recipe builder cost/margin, inline
ingredient creation, no-recipe flag, variance report) is written after
Plan 1 lands**, so it is built against a model that is already correct.

## Global Constraints

- **No new dependencies.** Everything here uses Prisma, `node:test`, and what is already installed.
- **Additive schema only.** No column is dropped and no existing column changes meaning. `Ingredient.unit` is kept and becomes display-only legacy.
- **Every stock movement writes a ledger row.** After Task 1 it is a type error to call `decrementStock` without saying why.
- **Tests are `lib/*.test.ts`**, run by `npm test` which is `node --experimental-strip-types --test lib/*.test.ts`. Imports inside test files use the `.ts` extension (e.g. `from './units.ts'`).
- **Money is THB. Stock is base units** (`g`, `ml`, `each`) after migration.
- **The migration must be dry-runnable and reversible**, and must report any row it cannot convert rather than guessing.
- **Commit messages** end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

### Task 1: Every stock movement writes a ledger row

Today `decrementStock` does a bare `UPDATE "Ingredient" SET "subStock" = ...`
with no audit trail. Measured on the live database: 553 orders placed, 0 ledger
rows written by them. Deposits, withdrawals, adjustments and returns all write
a row; the largest consumer of stock does not.

This task makes the movement descriptor a **required** argument, so the compiler
finds every call site.

**Files:**
- Modify: `lib/stock.ts`
- Modify: `lib/swap-charge.ts:44-56` (`reverseSwap` forwards the descriptor)
- Modify: `app/api/orders/route.ts:421`, `app/api/orders/route.ts:483`
- Modify: `app/api/orders/[id]/void/route.ts:95`, `app/api/orders/[id]/void/route.ts:110`
- Modify: `app/api/order-items/[id]/swap/route.ts:220`, `:226`
- Modify: `app/api/package-swaps/[id]/reverse/route.ts:56`
- Modify: `app/api/table-sessions/[id]/returns/route.ts:194`
- Test: `lib/stock.test.ts` (create)

**Interfaces:**
- Produces: `type StockMovement = { type: StockMovementType; userId?: string | null; notes?: string | null; reason?: string | null }`
- Produces: `decrementStock(tx, ingredientId: string, quantity: number, movement: StockMovement): Promise<void>` — a fourth, required parameter
- Consumes: nothing from earlier tasks

- [ ] **Step 1: Write the failing test**

Create `lib/stock.test.ts`:

```ts
// Run: node --experimental-strip-types --test lib/stock.test.ts
//
// A sale that moves stock without leaving a row is the gap this file exists to
// close: when the audit sheet says six bottles are missing, "what sold?" has to
// be answerable from the ledger rather than by diffing two balances.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decrementStock, type StockMovement } from './stock.ts'

/** A tx that records what it was asked to do, so no database is needed. */
function fakeTx() {
    const calls = { updates: [] as unknown[][], rows: [] as Record<string, unknown>[] }
    return {
        calls,
        $executeRaw: async (_q: TemplateStringsArray, ...v: unknown[]) => {
            calls.updates.push(v)
            return 1
        },
        stockTransaction: {
            create: async ({ data }: { data: Record<string, unknown> }) => {
                calls.rows.push(data)
                return data
            },
        },
    }
}

const SALE: StockMovement = { type: 'SALE', userId: 'u1', notes: 'order-1', reason: 'menu-1' }

test('a movement writes exactly one ledger row', async () => {
    const tx = fakeTx()
    await decrementStock(tx, 'i-heineken', 5, SALE)
    assert.equal(tx.calls.rows.length, 1)
    assert.equal(tx.calls.updates.length, 1)
})

test('the row carries who, why and against what', async () => {
    const tx = fakeTx()
    await decrementStock(tx, 'i-heineken', 5, SALE)
    const row = tx.calls.rows[0]
    assert.equal(row.ingredientId, 'i-heineken')
    assert.equal(row.type, 'SALE')
    assert.equal(row.userId, 'u1')
    assert.equal(row.notes, 'order-1')
    assert.equal(row.reason, 'menu-1')
})

test('stock leaving the shop is recorded as leaving SUB', async () => {
    const tx = fakeTx()
    await decrementStock(tx, 'i-heineken', 5, SALE)
    const row = tx.calls.rows[0]
    assert.equal(row.quantity, 5, 'quantity is always positive; direction is in the store fields')
    assert.equal(row.fromStore, 'SUB')
    assert.equal(row.toStore, null)
})

test('stock coming back is recorded as arriving at SUB, still positive', async () => {
    const tx = fakeTx()
    await decrementStock(tx, 'i-heineken', -5, { type: 'SALE_VOID' })
    const row = tx.calls.rows[0]
    assert.equal(row.quantity, 5)
    assert.equal(row.fromStore, null)
    assert.equal(row.toStore, 'SUB')
})

test('a zero or non-finite movement touches nothing at all', async () => {
    const tx = fakeTx()
    await decrementStock(tx, 'i-heineken', 0, SALE)
    await decrementStock(tx, 'i-heineken', Number.NaN, SALE)
    assert.equal(tx.calls.updates.length, 0)
    assert.equal(tx.calls.rows.length, 0, 'a no-op must not leave a row claiming something happened')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test lib/stock.test.ts`
Expected: FAIL — `decrementStock` currently takes 3 parameters and `StockMovement` is not exported.

- [ ] **Step 3: Rewrite `lib/stock.ts`**

Replace the whole file with:

```ts
/**
 * Moving stock, and recording why it moved.
 *
 * Two things happen on every movement and they belong in one place. The
 * balance changes, and a row is written saying who moved it and what for.
 * Splitting them is how the ledger ended up with deposits and withdrawals in
 * it but not sales - 553 orders that changed the shelf and left nothing to
 * read afterwards.
 *
 * Rounding happens in SQL rather than by reading, rounding and writing back,
 * so two tills serving the same bottle at once still add up.
 */

/**
 * Enough to hold a millilitre out of a bottle; short enough to stay legible.
 *
 * Kept at 3 while quantities are still fractions of a purchase unit. Task 4
 * replaces this with a per-measure-type figure once stock is in base units.
 */
export const STOCK_DP = 3

/**
 * Why stock moved.
 *
 * SALE and SALE_VOID come from the till. EXCHANGE covers a package swap in
 * either direction, EXCHANGE_REVERSE its undo. RETURN_UNOPENED_STOCK is the
 * per-ingredient half of a cleanup count - deliberately NOT `RETURN_UNOPENED`,
 * which the returns route writes once per returned line and reads back to cap
 * the next count. One row per ingredient under that type would make a
 * two-ingredient drink look twice returned and silently halve the cap.
 */
export type StockMovementType =
    | 'SALE'
    | 'SALE_VOID'
    | 'EXCHANGE'
    | 'EXCHANGE_REVERSE'
    | 'RETURN_UNOPENED_STOCK'

export type StockMovement = {
    type: StockMovementType
    /** Who did it. Null only where no user is attached to the path. */
    userId?: string | null
    /** Which bill, table or order this came from - what an audit reads first. */
    notes?: string | null
    /** A menuId or orderId, so a report can group without parsing notes. */
    reason?: string | null
}

type Executor = {
    $executeRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<number>
    stockTransaction: {
        create: (args: { data: Record<string, unknown> }) => Promise<unknown>
    }
}

/**
 * Take `quantity` off an ingredient's shop stock and record why. A negative
 * quantity puts it back, which is what a voided round does.
 *
 * `movement` is required rather than optional on purpose: an optional audit
 * trail is one that stops being written the first time somebody is in a hurry.
 *
 * Deliberately allows the result to go negative. Stock below zero means more
 * was sold than was ever booked in - a delivery nobody entered, or a recipe
 * that is wrong - and hiding that behind a clamp at zero turns a discrepancy
 * the manager needs to see into a silent one. The bar is never blocked from
 * serving; the variance is simply visible afterwards.
 */
export async function decrementStock(
    tx: Executor,
    ingredientId: string,
    quantity: number,
    movement: StockMovement
): Promise<void> {
    if (!Number.isFinite(quantity) || quantity === 0) return

    await tx.$executeRaw`
        UPDATE "Ingredient"
        SET "subStock" = ROUND("subStock" - ${quantity}, ${STOCK_DP})
        WHERE "id" = ${ingredientId}
    `

    // Direction lives in fromStore/toStore and the quantity stays positive,
    // which is the convention the deposit and withdraw paths already use - so
    // one report can read every row without special-casing where it came from.
    await tx.stockTransaction.create({
        data: {
            ingredientId,
            type: movement.type,
            quantity: Math.abs(quantity),
            fromStore: quantity > 0 ? 'SUB' : null,
            toStore: quantity < 0 ? 'SUB' : null,
            userId: movement.userId ?? null,
            notes: movement.notes ?? null,
            reason: movement.reason ?? null,
        },
    })
}

/**
 * How to show a stock figure. Trailing zeros are noise on a count sheet -
 * "300 bottles" not "300.000" - but a part-bottle still has to be readable.
 */
export function formatStock(value: number | null | undefined): string {
    const n = Number(value) || 0
    return Number(n.toFixed(STOCK_DP)).toLocaleString("en-US", { maximumFractionDigits: STOCK_DP })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test lib/stock.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Forward the descriptor through `reverseSwap`**

In `lib/swap-charge.ts`, change the `reverseSwap` signature and its inner call.

First add the type-only import at the top of the file. It is not circular —
`lib/stock.ts` does not import `lib/swap-charge.ts`:

```ts
import type { StockMovement } from './stock'
```

Using the real `StockMovement` here rather than a looser inline
`{ type: string; ... }` matters: under `strictFunctionTypes` a function whose
parameter is the narrow union is **not** assignable to one declaring `string`,
so the inline version would fail to typecheck at every call site that passes
`decrementStock` in.

Then replace the `decrementStock` parameter type and the loop body:

```ts
export async function reverseSwap(
    tx: any,
    swap: { id: string; chargeItemId: string | null; lines: any[] },
    userId: string,
    decrementStock: (
        tx: any,
        ingredientId: string,
        quantity: number,
        movement: StockMovement,
    ) => Promise<void>,
): Promise<void> {
    for (const line of swap.lines) {
        if (!line.variationSizeId) continue
        const sign = line.direction === 'OUT' ? 1 : -1
        for (const r of await recipeFor(tx, line.variationSizeId)) {
            await decrementStock(tx, r.ingredientId, sign * r.quantity * line.quantity, {
                type: 'EXCHANGE_REVERSE',
                userId,
                notes: `swap ${swap.id}`,
                reason: line.menuId ?? null,
            })
        }
    }
```

The rest of the function (striking the charge line, marking the swap reversed)
is unchanged.

- [ ] **Step 6: Update the six direct call sites**

Each is a one-line change adding the fourth argument. Exact edits below.

**Check what is in scope first.** `reason` uses `vs.variation.menu.id`, which is
guaranteed available inside the `if (vs?.variation?.menu)` block both order-route
call sites already sit in. `notes` uses an order id — if `order` is not yet
bound at that point in the transaction, pass `notes: item.name` instead and do
not invent a variable. The row is valid either way; `type` and `reason` are the
fields reports group by.

`app/api/orders/route.ts:421` — stock leaving on a sent round:
```ts
await decrementStock(tx, recipe.ingredientId, recipe.quantity * item.quantity, {
    type: 'SALE', userId, notes: `order ${order.id}`, reason: vs.variation.menu.id,
})
```

`app/api/orders/route.ts:483` — stock returning when a round is cancelled:
```ts
await decrementStock(tx, recipe.ingredientId, -(recipe.quantity * item.quantity), {
    type: 'SALE_VOID', userId, notes: `order ${order.id}`, reason: vs.variation.menu.id,
})
```

`app/api/orders/[id]/void/route.ts:95`:
```ts
await decrementStock(tx, recipe.ingredientId, -(recipe.quantity * item.quantity), {
    type: 'SALE_VOID', userId: user.id, notes: `void order ${id}`, reason: menu.id,
})
```

`app/api/order-items/[id]/swap/route.ts:220` — what left the package coming back:
```ts
await decrementStock(tx, r.ingredientId, -(r.quantity * line.quantity), {
    type: 'EXCHANGE', userId: user.id, notes: `swap out, item ${item.id}`, reason: line.menuId,
})
```

`app/api/order-items/[id]/swap/route.ts:226` — the replacement leaving the shelf:
```ts
await decrementStock(tx, r.ingredientId, r.quantity * line.quantity, {
    type: 'EXCHANGE', userId: user.id, notes: `swap in, item ${item.id}`, reason: line.menuId,
})
```

`app/api/table-sessions/[id]/returns/route.ts:194` — note the distinct type:
```ts
await decrementStock(tx, recipe.ingredientId, -(recipe.quantity * line.quantity), {
    type: 'RETURN_UNOPENED_STOCK', userId: user.id, notes: `${id} · ${item.name}`, reason: line.menuId,
})
```

**Do not remove** the `stockTransaction.create` with `type: RETURN_TYPE` that
already follows in that route. It is the one row per returned line that
`alreadyReturned` counts to cap the next count, and it must stay exactly one.

`app/api/package-swaps/[id]/reverse/route.ts:56` and
`app/api/orders/[id]/void/route.ts:110` pass `decrementStock` into
`reverseSwap` and need no change — `reverseSwap` now supplies the descriptor.

- [ ] **Step 7: Typecheck and run the full suite**

Run: `npx tsc --noEmit`
Expected: no errors. If any call site was missed, this is where it surfaces.

Run: `npm test`
Expected: PASS, 216 tests (211 existing + 5 new).

- [ ] **Step 8: Verify against the running app**

Start the dev server, then re-run the batch-1 and batch-2 API test scripts from
the testing session. Then confirm sales now reach the ledger:

```bash
NODE_PATH=$PWD/node_modules node -e "
const { PrismaClient } = require('@prisma/client'); const p = new PrismaClient()
;(async () => {
  const g = await p.stockTransaction.groupBy({ by: ['type'], _count: true })
  console.log(g.map(x => x.type + ': ' + x._count).join('\n'))
  await p.\$disconnect()
})()"
```

Expected: a `SALE` count greater than zero, which was 0 before this task.

- [ ] **Step 9: Commit**

```bash
git add lib/stock.ts lib/stock.test.ts lib/swap-charge.ts app/api
git commit -m "feat: every stock movement leaves a row saying why

A sale changed the shelf and recorded nothing - 553 orders, no ledger
rows - so 'six bottles are missing, what sold?' had no answer but
diffing two balances. The movement descriptor is required rather than
optional: an optional audit trail stops being written the first time
somebody is in a hurry.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The unit conversion library

Pure arithmetic, no Prisma import, so the conversion table can be tested
without a database and the migration and the UI can share one source of truth.

**Files:**
- Create: `lib/units.ts`
- Test: `lib/units.test.ts`

**Interfaces:**
- Produces: `type MeasureType = 'WEIGHT' | 'VOLUME' | 'EACH'`
- Produces: `BASE_UNIT: Record<MeasureType, string>`, `DECIMALS: Record<MeasureType, number>`
- Produces: `LEGACY_UNITS: Record<string, { measureType: MeasureType; multiplier: number | null }>`
- Produces: `toBase(qty, multiplier)`, `fromBase(base, multiplier)`, `roundFor(measureType, value)`, `formatDual(base, opts)`
- Consumes: nothing

- [ ] **Step 1: Write the failing test**

Create `lib/units.test.ts`:

```ts
// Run: node --experimental-strip-types --test lib/units.test.ts
//
// The conversion table is the whole point of the base-unit work: get a
// multiplier wrong here and every stock figure and every pour cost downstream
// is wrong in a way nobody can see.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    BASE_UNIT, DECIMALS, LEGACY_UNITS, toBase, fromBase, roundFor, formatDual,
} from './units.ts'

test('base unit follows from measure type, it is never typed', () => {
    assert.equal(BASE_UNIT.WEIGHT, 'g')
    assert.equal(BASE_UNIT.VOLUME, 'ml')
    assert.equal(BASE_UNIT.EACH, 'each')
})

test('EACH is the type that keeps decimals, not the one that loses them', () => {
    // Easy to get backwards. Grams and millilitres are fine-grained enough to
    // always be whole; a quarter lime is the only fraction left after migration.
    assert.equal(DECIMALS.WEIGHT, 0)
    assert.equal(DECIMALS.VOLUME, 0)
    assert.equal(DECIMALS.EACH, 2)
})

test('a 30ml pour out of a 700ml bottle is 30, not 0.042857', () => {
    assert.equal(toBase(0.04285714285714286, 700), 30)
    assert.equal(toBase(0.06428571428571428, 700), 45)
})

test('legacy kg and litre convert by a thousand', () => {
    assert.equal(toBase(0.15, LEGACY_UNITS.kg.multiplier!), 150)
    assert.equal(toBase(0.02, LEGACY_UNITS.litre.multiplier!), 20)
    assert.equal(toBase(2, LEGACY_UNITS.kg.multiplier!), 2000)
})

test('a spirit bottle has no fixed multiplier - it is asked for per ingredient', () => {
    // 'bottle' means EACH for a beer and VOLUME for a spirit. The migration
    // resolves it per ingredient rather than from this table.
    assert.equal(LEGACY_UNITS.bottle.multiplier, null)
})

test('fromBase inverts toBase to within float tolerance', () => {
    // Deliberately not assert.equal on the raw division: 30/700 is a repeating
    // decimal and asserting an exact literal here would be testing the printer,
    // not the arithmetic. Round-tripping is the property that matters.
    assert.ok(Math.abs(fromBase(30, 700) - 30 / 700) < 1e-12)
    assert.equal(fromBase(toBase(0.25, 1000), 1000), 0.25)
    assert.ok(Math.abs(toBase(fromBase(45, 700), 700) - 45) < 1e-6)
})

test('rounding respects the measure type', () => {
    assert.equal(roundFor('VOLUME', 30.4), 30)
    assert.equal(roundFor('WEIGHT', 149.6), 150)
    assert.equal(roundFor('EACH', 0.25), 0.25, 'a quarter lime must survive')
    assert.equal(roundFor('EACH', 0.156), 0.16)
})

test('a part-used bottle reads as something a person can count', () => {
    const opts = { measureType: 'VOLUME' as const, purchaseUnit: 'bottle', multiplier: 700 }
    assert.equal(formatDual(2350, opts), '3 bottles + 250 ml')
    assert.equal(formatDual(2100, opts), '3 bottles')
    assert.equal(formatDual(250, opts), '250 ml')
    assert.equal(formatDual(0, opts), '0 ml')
})

test('whole-unit stock reads as a plain count', () => {
    const opts = { measureType: 'EACH' as const, purchaseUnit: 'bottle', multiplier: 1 }
    assert.equal(formatDual(47, opts), '47 bottles')
    assert.equal(formatDual(1, opts), '1 bottle')
})

test('negative stock still reads correctly rather than inverting', () => {
    // Stock below zero is a discrepancy the manager must see, so it has to
    // print as a number, not as nonsense from a floor() on a negative.
    const opts = { measureType: 'VOLUME' as const, purchaseUnit: 'bottle', multiplier: 700 }
    assert.equal(formatDual(-2350, opts), '-3 bottles + 250 ml')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test lib/units.test.ts`
Expected: FAIL — `Cannot find module './units.ts'`.

- [ ] **Step 3: Write `lib/units.ts`**

```ts
/**
 * The three unit worlds every ingredient lives in.
 *
 * You buy it in one unit, you count it in another, a recipe consumes it in a
 * third. The trade's answer - SambaPOS calls them Base Unit, Transaction Unit
 * and Multiplier - is to resolve all three back to one base unit and store
 * only that.
 *
 * Before this existed the conversion had nowhere to live, so it went into
 * every recipe row as a repeating decimal: a 30ml pour recorded as
 * 0.04285714285714286 of a bottle. That is what `STOCK_DP` was absorbing.
 *
 * Pure arithmetic, no Prisma: the migration, the API and the screens all have
 * to agree about what a multiplier means, and the cheapest way to guarantee
 * that is one tested module none of them can disagree with.
 */

export type MeasureType = 'WEIGHT' | 'VOLUME' | 'EACH'

/** Derived from the measure type, never typed by a person. */
export const BASE_UNIT: Record<MeasureType, string> = {
    WEIGHT: 'g',
    VOLUME: 'ml',
    EACH: 'each',
}

/**
 * How many decimals a stored quantity keeps.
 *
 * The counter-intuitive one is EACH. Whole-unit items look like the case that
 * needs no decimals, but they are the only case that still has fractional
 * recipe quantities after migration - a quarter lime, 0.15 of a bunch of mint.
 * Grams and millilitres are fine-grained enough to always land on integers.
 */
export const DECIMALS: Record<MeasureType, number> = {
    WEIGHT: 0,
    VOLUME: 0,
    EACH: 2,
}

/**
 * The free-text units in use today, and how to read each one.
 *
 * `bottle` is deliberately null: it means EACH for a Heineken and VOLUME for a
 * bottle of Hongthong you pour 30ml out of. Same string, incompatible maths -
 * which is exactly the ambiguity `measureType` exists to remove. The migration
 * resolves it per ingredient.
 */
export const LEGACY_UNITS: Record<string, { measureType: MeasureType; multiplier: number | null }> = {
    kg: { measureType: 'WEIGHT', multiplier: 1000 },
    litre: { measureType: 'VOLUME', multiplier: 1000 },
    can: { measureType: 'EACH', multiplier: 1 },
    piece: { measureType: 'EACH', multiplier: 1 },
    bunch: { measureType: 'EACH', multiplier: 1 },
    bottle: { measureType: 'EACH', multiplier: null },
}

/** A quantity expressed in purchase units, as a count of base units. */
export function toBase(quantity: number, multiplier: number): number {
    if (!Number.isFinite(quantity) || !Number.isFinite(multiplier)) return 0
    // Rounded to 6 places before the caller rounds again for its measure type:
    // 0.04285714285714286 * 700 is 29.999999999999996 in binary, and a pour
    // that reads as 29 rather than 30 would drift the shelf a millilitre at a
    // time in exactly the way this module exists to stop.
    return Math.round(quantity * multiplier * 1e6) / 1e6
}

/** The inverse, for showing a base quantity in the unit a person buys. */
export function fromBase(base: number, multiplier: number): number {
    if (!Number.isFinite(base) || !Number.isFinite(multiplier) || multiplier === 0) return 0
    return base / multiplier
}

/** Round a value the way its measure type stores it. */
export function roundFor(measureType: MeasureType, value: number): number {
    if (!Number.isFinite(value)) return 0
    const dp = DECIMALS[measureType]
    const factor = 10 ** dp
    return Math.round(value * factor) / factor
}

/**
 * A stock figure as something a person holding a clipboard can act on.
 *
 * "3 bottles + 250 ml", not "3.357". The audit sheet is a piece of paper
 * someone counts against at 2am, and a repeating decimal on it is a number
 * nobody can check.
 */
export function formatDual(
    base: number,
    opts: { measureType: MeasureType; purchaseUnit: string; multiplier: number },
): string {
    const { measureType, purchaseUnit, multiplier } = opts
    const baseUnit = BASE_UNIT[measureType]
    const value = roundFor(measureType, Number(base) || 0)

    const plural = (n: number, unit: string) => `${n} ${unit}${Math.abs(n) === 1 ? '' : 's'}`

    // Whole-unit stock, or a purchase unit that IS the base unit: one figure.
    if (measureType === 'EACH' || multiplier <= 1) {
        return measureType === 'EACH' ? plural(value, purchaseUnit) : `${value} ${baseUnit}`
    }

    // Sign handled explicitly: Math.floor(-2350 / 700) is -4, which would
    // print "-4 bottles + 450 ml" for what is really minus three and a bit.
    const sign = value < 0 ? -1 : 1
    const abs = Math.abs(value)
    const whole = Math.floor(abs / multiplier)
    const rest = roundFor(measureType, abs - whole * multiplier)

    if (whole === 0) return `${sign * rest} ${baseUnit}`
    if (rest === 0) return plural(sign * whole, purchaseUnit)
    return `${plural(sign * whole, purchaseUnit)} + ${rest} ${baseUnit}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test lib/units.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/units.ts lib/units.test.ts
git commit -m "feat: one place that knows what a unit means

Buy by the bottle, pour by the millilitre. With nowhere to record the
conversion it went into every recipe row as 0.04285714285714286, which
is what the rounding in stock.ts was absorbing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Schema fields and the migration

**Files:**
- Modify: `prisma/schema.prisma:117-135` (the `Ingredient` model)
- Create: `prisma/migrateToBaseUnits.js`
- Modify: `package.json` (add the `db:migrate-units` script)

**Interfaces:**
- Consumes: `LEGACY_UNITS`, `toBase`, `BASE_UNIT` from `lib/units.ts` (Task 2)
- Produces: `Ingredient.measureType`, `.baseUnit`, `.purchaseUnit`, `.purchaseMultiplier`

- [ ] **Step 1: Add the fields to the schema**

In `prisma/schema.prisma`, inside `model Ingredient`, after the `unit` line:

```prisma
model Ingredient {
  id           String              @id @default(uuid())
  name         String
  /// Legacy free-text unit. Kept for display and for the migration's audit
  /// trail; nothing computes from it any more.
  unit         String
  /// WEIGHT | VOLUME | EACH. Immutable once any StockTransaction references
  /// this ingredient - changing it would rewrite what every past deduction
  /// meant.
  measureType  String              @default("EACH")
  /// g | ml | each. Derived from measureType, never entered by hand.
  baseUnit     String              @default("each")
  /// What the delivery note says: "bottle", "case", "kg".
  purchaseUnit String              @default("each")
  /// Base units per purchase unit. 700 for a 700ml bottle, 1000 for a kg.
  purchaseMultiplier Float         @default(1)
  ...
```

Leave every other field untouched.

- [ ] **Step 2: Push the schema and regenerate the client**

Run: `npx prisma db push && npx prisma generate`
Expected: the four columns are added with their defaults; no data is lost
because every one has a default.

- [ ] **Step 3: Write the migration script**

Create `prisma/migrateToBaseUnits.js`:

```js
/**
 * One-off: move stock and recipe quantities onto real base units.
 *
 * Run a dry run first. It reports what it would change and, more importantly,
 * every row it cannot convert - the script never guesses.
 *
 *   node prisma/migrateToBaseUnits.js            # dry run, writes nothing
 *   node prisma/migrateToBaseUnits.js --commit   # applies it
 *
 * Reversible: the pre-migration values are written into a StockTransaction row
 * per ingredient, so the conversion is itself auditable.
 */
const { PrismaClient } = require("@prisma/client")

const prisma = new PrismaClient()
const COMMIT = process.argv.includes("--commit")

/**
 * Spirit bottles, in ml.
 *
 * CONFIRM AGAINST THE OWNER'S ACTUAL BOTTLES BEFORE RUNNING WITH --commit.
 * 700 is used because it makes the existing pours land on exactly 30ml and
 * 45ml, which is what a jigger measures - but it is four rows of real stock
 * and worth a look at the shelf.
 */
const BOTTLE_ML = {
    "Hongthong (bottle)": 700,
    "Vodka (bottle)": 700,
    "White Rum (bottle)": 700,
    "Gin (bottle)": 700,
    "Chivas 12 (bottle)": 700,
    "Johnnie Walker Black (bottle)": 700,
}

const LEGACY = {
    kg: { measureType: "WEIGHT", baseUnit: "g", multiplier: 1000 },
    litre: { measureType: "VOLUME", baseUnit: "ml", multiplier: 1000 },
    can: { measureType: "EACH", baseUnit: "each", multiplier: 1 },
    piece: { measureType: "EACH", baseUnit: "each", multiplier: 1 },
    bunch: { measureType: "EACH", baseUnit: "each", multiplier: 1 },
}

/** How one ingredient should be read after the migration. */
function planFor(ingredient) {
    const ml = BOTTLE_ML[ingredient.name]
    if (ml) {
        // A spirit: bought by the bottle, poured by the millilitre.
        return { measureType: "VOLUME", baseUnit: "ml", purchaseUnit: "bottle", purchaseMultiplier: ml }
    }
    if (ingredient.unit === "bottle") {
        // A beer or a mixer: the bottle IS the unit, you never pour half.
        return { measureType: "EACH", baseUnit: "each", purchaseUnit: "bottle", purchaseMultiplier: 1 }
    }
    const legacy = LEGACY[ingredient.unit]
    if (!legacy) return null
    return {
        measureType: legacy.measureType,
        baseUnit: legacy.baseUnit,
        purchaseUnit: ingredient.unit,
        purchaseMultiplier: legacy.multiplier,
    }
}

function toBase(quantity, multiplier) {
    return Math.round(quantity * multiplier * 1e6) / 1e6
}

async function main() {
    const ingredients = await prisma.ingredient.findMany()
    const recipes = await prisma.recipe.findMany({ include: { ingredient: true, menu: true } })

    const plans = new Map()
    const unconvertible = []

    for (const ing of ingredients) {
        const plan = planFor(ing)
        if (!plan) { unconvertible.push(`ingredient "${ing.name}" has unit "${ing.unit}" — no rule`); continue }
        plans.set(ing.id, plan)
    }

    console.log(COMMIT ? "APPLYING\n" : "DRY RUN — nothing will be written\n")
    console.log("INGREDIENTS")
    for (const ing of ingredients) {
        const p = plans.get(ing.id)
        if (!p) continue
        console.log(
            `  ${ing.name.padEnd(32)} ${ing.unit.padEnd(7)} -> ${p.measureType.padEnd(6)} ` +
            `1 ${p.purchaseUnit} = ${p.purchaseMultiplier} ${p.baseUnit} | ` +
            `stock ${ing.mainStock}/${ing.subStock} -> ${toBase(ing.mainStock, p.purchaseMultiplier)}/${toBase(ing.subStock, p.purchaseMultiplier)}`
        )
    }

    console.log("\nRECIPES")
    for (const r of recipes) {
        const p = plans.get(r.ingredientId)
        if (!p) { unconvertible.push(`recipe "${r.menu.name} / ${r.ingredient.name}" — ingredient has no rule`); continue }
        console.log(`  ${(r.menu.name + " / " + r.ingredient.name).padEnd(46)} ${String(r.quantity).padEnd(22)} -> ${toBase(r.quantity, p.purchaseMultiplier)} ${p.baseUnit}`)
    }

    if (unconvertible.length) {
        console.log("\nCANNOT CONVERT — fix these before committing:")
        for (const u of unconvertible) console.log("  " + u)
        if (COMMIT) { console.log("\nRefusing to write a partial migration."); process.exit(1) }
    }

    if (!COMMIT) {
        console.log("\nRe-run with --commit to apply.")
        return
    }

    await prisma.$transaction(async (tx) => {
        for (const ing of ingredients) {
            const p = plans.get(ing.id)
            if (!p) continue
            await tx.stockTransaction.create({
                data: {
                    ingredientId: ing.id,
                    type: "UNIT_MIGRATION",
                    quantity: 0,
                    reason: ing.unit,
                    notes: `pre-migration main=${ing.mainStock} sub=${ing.subStock} unit=${ing.unit}`,
                },
            })
            await tx.ingredient.update({
                where: { id: ing.id },
                data: {
                    ...p,
                    mainStock: toBase(ing.mainStock, p.purchaseMultiplier),
                    subStock: toBase(ing.subStock, p.purchaseMultiplier),
                    minStock: toBase(ing.minStock, p.purchaseMultiplier),
                    maxStock: toBase(ing.maxStock, p.purchaseMultiplier),
                    minStockSub: toBase(ing.minStockSub, p.purchaseMultiplier),
                    maxStockSub: toBase(ing.maxStockSub, p.purchaseMultiplier),
                    // Cost stays per purchase unit, which is what the invoice says.
                },
            })
        }
        for (const r of recipes) {
            const p = plans.get(r.ingredientId)
            if (!p) continue
            await tx.recipe.update({
                where: { id: r.id },
                data: { quantity: toBase(r.quantity, p.purchaseMultiplier) },
            })
        }
    })

    console.log("\nDone.")
}

main()
    .catch((e) => { console.error(e); process.exit(1) })
    .finally(() => prisma.$disconnect())
```

- [ ] **Step 4: Add the script to package.json**

In `package.json`, in `"scripts"`, after `"db:demo"`:

```json
"db:migrate-units": "node prisma/migrateToBaseUnits.js",
```

- [ ] **Step 5: Back up, then dry-run**

```bash
cp prisma/dev.db prisma/dev.db.pre-base-units
npm run db:migrate-units
```

Expected: 41 recipe rows shown converting mechanically, the 4 spirit rows
showing `30 ml` and `45 ml`, an empty "CANNOT CONVERT" section. If anything is
listed there, stop and fix the rule rather than committing.

- [ ] **Step 6: Capture the before-state, then apply**

```bash
NODE_PATH=$PWD/node_modules node -e "
const { PrismaClient } = require('@prisma/client'); const p = new PrismaClient()
;(async () => {
  const i = await p.ingredient.findMany({ select: { name: true, subStock: true, unit: true }, orderBy: { name: 'asc' } })
  require('fs').writeFileSync('before-stock.json', JSON.stringify(i, null, 2))
  console.log('captured ' + i.length + ' ingredients')
  await p.\$disconnect()
})()"

npm run db:migrate-units -- --commit
```

- [ ] **Step 7: Verify the conversion is exact**

```bash
NODE_PATH=$PWD/node_modules node -e "
const { PrismaClient } = require('@prisma/client'); const p = new PrismaClient()
const before = require('./before-stock.json')
;(async () => {
  const after = await p.ingredient.findMany({ select: { name: true, subStock: true, purchaseMultiplier: true }, orderBy: { name: 'asc' } })
  let bad = 0
  for (const a of after) {
    const b = before.find(x => x.name === a.name)
    const expected = Math.round(b.subStock * a.purchaseMultiplier * 1e6) / 1e6
    if (Math.abs(a.subStock - expected) > 1e-6) { console.log('MISMATCH ' + a.name + ': ' + a.subStock + ' vs ' + expected); bad++ }
  }
  console.log(bad === 0 ? 'all ' + after.length + ' ingredients converted exactly' : bad + ' MISMATCHES')
  await p.\$disconnect()
})()"
```

Expected: `all N ingredients converted exactly`.

- [ ] **Step 8: Commit**

```bash
rm before-stock.json
git add prisma/schema.prisma prisma/migrateToBaseUnits.js package.json
git commit -m "feat: ingredients carry a measure type and a purchase multiplier

Buy by the bottle, count in millilitres. The migration is dry-run first
and refuses to write a partial conversion; pre-migration values go into
a UNIT_MIGRATION ledger row so the conversion is itself auditable.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Stock paths read base units

**Files:**
- Modify: `lib/stock.ts` (rounding per measure type, dual formatting)
- Modify: `lib/packages.ts:22-33` (`componentIndex`)
- Test: `lib/stock.test.ts`, `lib/packages.test.ts`

**Interfaces:**
- Consumes: `MeasureType`, `DECIMALS`, `roundFor`, `formatDual` from `lib/units.ts`
- Consumes: `decrementStock` from Task 1
- Produces: `componentIndex(menus)` unchanged in signature; its rule now reads `measureType`

- [ ] **Step 1: Write the failing test for the componentIndex rule**

Append to `lib/packages.test.ts`:

```ts
test('an EACH ingredient at quantity 1 is exchangeable', () => {
    const menus: SellableMenu[] = [
        { menuId: 'm-heineken', variationSizeId: 'v', name: 'Heineken', unitPrice: 60,
          recipe: [{ ingredientId: 'i-heineken', quantity: 1, measureType: 'EACH' }] },
    ]
    assert.equal(componentIndex(menus).get('i-heineken')?.name, 'Heineken')
})

test('a WEIGHT ingredient is never exchangeable, whatever its quantity', () => {
    // Ice at 1000g would have passed the old "quantity === 1" proxy the moment
    // somebody defined a 1kg ice bag. The rule now says what it means.
    const menus: SellableMenu[] = [
        { menuId: 'm-ice', variationSizeId: 'v', name: 'Ice 1kg', unitPrice: 20,
          recipe: [{ ingredientId: 'i-ice', quantity: 1, measureType: 'WEIGHT' }] },
    ]
    assert.equal(componentIndex(menus).get('i-ice'), undefined)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --experimental-strip-types --test lib/packages.test.ts`
Expected: FAIL — `measureType` is not on the recipe line type.

- [ ] **Step 3: Widen the type and change the rule**

In `lib/packages.ts`, add `measureType` to the recipe line in `SellableMenu`:

```ts
export type SellableMenu = {
    menuId: string
    variationSizeId: string | null
    name: string
    localName?: string | null
    unitPrice: number
    recipe: { ingredientId: string; quantity: number; measureType?: MeasureType }[]
}
```

Then replace the body of `componentIndex`:

```ts
export function componentIndex(menus: SellableMenu[]): Map<string, SellableMenu> {
    const index = new Map<string, SellableMenu>()
    for (const menu of menus) {
        if (menu.recipe.length !== 1) continue
        const [only] = menu.recipe
        // Only a whole-unit ingredient can be exchanged: you can hand back a
        // bottle, not 150 grams of ice. This used to be inferred from
        // "quantity === 1", which was standing in for a measure type that did
        // not exist yet.
        if (only.measureType && only.measureType !== 'EACH') continue
        if (only.quantity !== 1) continue
        if (!index.has(only.ingredientId)) index.set(only.ingredientId, menu)
    }
    return index
}
```

Add `import type { MeasureType } from './units.ts'` at the top (use
`'@/lib/units'` in app code; `lib/packages.ts` is imported both ways, so match
the existing import style in that file).

- [ ] **Step 4: Include measureType in `sellableMenus`**

In `lib/packages-db.ts`, add the field to the recipe select and map:

```ts
recipes: { select: { ingredientId: true, quantity: true, ingredient: { select: { measureType: true } } } },
```

and in the return map:

```ts
recipe: m.recipes.map((r) => ({
    ingredientId: r.ingredientId,
    quantity: r.quantity,
    measureType: r.ingredient.measureType as MeasureType,
})),
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: PASS. The two new package tests pass and all existing ones still do —
the seeded singles are all EACH at quantity 1, so behaviour is unchanged.

- [ ] **Step 6: Make `formatStock` measure-type aware**

In `lib/stock.ts`, replace `formatStock` and re-export the dual form:

```ts
import { DECIMALS, formatDual, roundFor, type MeasureType } from './units.ts'

/**
 * A stock figure for a screen. Trailing zeros are noise on a count sheet -
 * "300 bottles" not "300.000" - but a part-bottle still has to be readable.
 *
 * `measureType` is optional so the call sites that have not been given one yet
 * keep working; pass it wherever the ingredient is to hand.
 */
export function formatStock(value: number | null | undefined, measureType?: MeasureType): string {
    const n = Number(value) || 0
    const dp = measureType ? DECIMALS[measureType] : STOCK_DP
    return Number(n.toFixed(dp)).toLocaleString("en-US", { maximumFractionDigits: dp })
}

/** Re-exported so screens have one import for stock display. */
export { formatDual, roundFor }
```

- [ ] **Step 7: Point the audit sheet at the dual form**

In `app/inventory/audit-sheet/page.tsx`, replace the `formatStock(...)` call in
the system-figure column with:

```tsx
{formatDual(item.subStock, {
    measureType: item.measureType,
    purchaseUnit: item.purchaseUnit,
    multiplier: item.purchaseMultiplier,
})}
```

and add `measureType`, `purchaseUnit`, `purchaseMultiplier` to the type the
page fetches and to the `select` in `app/api/inventory/route.ts`.

- [ ] **Step 8: Run the full suite and the app checks**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, no type errors.

Then re-run the batch-1 and batch-2 API scripts and confirm the stock
assertions still hold — the numbers will now be in base units, so update the
expected values in those scripts to match (Heineken moves by 1 each, not 1
bottle-as-float).

- [ ] **Step 9: Commit**

```bash
git add lib/stock.ts lib/packages.ts lib/packages-db.ts lib/packages.test.ts app/inventory app/api/inventory
git commit -m "feat: stock reads in base units, and the audit sheet reads like a shelf

'3 bottles + 250 ml' instead of '3.357'. The exchange rule now says what
it means - only a whole-unit ingredient can be handed back - rather than
inferring it from quantity == 1.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Pour cost as a library

The costing logic already exists and is careful — it values a recipe at
ingredient cost and checks it against real trade bands (spirits 18-22%, beer
20-25%, soft drinks 12-18%, food 28-35%, with local beer allowed to run higher
because it is priced against the bar next door). It lives in
`prisma/checkPourCost.js` and runs from a terminal, so nobody at the bar will
ever see it. This lifts it into `lib/` so Plan 2's recipe footer can call it.

**Files:**
- Create: `lib/pour-cost.ts`
- Create: `lib/pour-cost.test.ts`
- Create: `app/api/recipes/[productId]/cost/route.ts`
- Modify: `prisma/checkPourCost.js` (import the shared logic rather than duplicating it)

**Interfaces:**
- Consumes: `fromBase` from `lib/units.ts`
- Produces: `recipeCost(lines): number`, `pourCost(cost, price): number`, `BANDS`, `bandFor(category)`, `verdictFor(category, pourCostPct)`
- Produces: `GET /api/recipes/:productId/cost` returning `{ cost, price, pourCostPct, band, verdict }`

- [ ] **Step 1: Write the failing test**

Create `lib/pour-cost.test.ts`:

```ts
// Run: node --experimental-strip-types --test lib/pour-cost.test.ts
//
// A bar that prices a drink below what it costs to pour finds out at
// stocktake, not at the till. This is the arithmetic that puts it on screen
// while the recipe is still being typed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recipeCost, pourCost, bandFor, verdictFor } from './pour-cost.ts'

test('a recipe costs the sum of its lines at base-unit cost', () => {
    // 30ml out of a 700ml bottle costing 450 THB is 19.29 THB.
    const lines = [
        { quantity: 30, costPerPurchaseUnit: 450, purchaseMultiplier: 700 },
        { quantity: 1, costPerPurchaseUnit: 12, purchaseMultiplier: 1 },
    ]
    assert.equal(recipeCost(lines), 31.29)
})

test('an empty recipe costs nothing rather than throwing', () => {
    assert.equal(recipeCost([]), 0)
})

test('pour cost is cost as a percentage of price', () => {
    assert.equal(pourCost(31.29, 180), 17.4)
})

test('a free item is not an infinite pour cost', () => {
    assert.equal(pourCost(31.29, 0), 0)
})

test('every category has a band, and an unknown one falls back to a wide default', () => {
    assert.deepEqual(bandFor('Spirits'), [18, 22])
    assert.deepEqual(bandFor('Cocktails'), [18, 22])
    assert.ok(bandFor('Something New')[1] > bandFor('Something New')[0])
})

test('selling below cost is called out, not merely flagged as high', () => {
    assert.equal(verdictFor('Spirits', 140), 'BELOW_COST')
    assert.equal(verdictFor('Spirits', 30), 'HIGH')
    assert.equal(verdictFor('Spirits', 20), 'OK')
    assert.equal(verdictFor('Spirits', 5), 'LOW')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --experimental-strip-types --test lib/pour-cost.test.ts`
Expected: FAIL — `Cannot find module './pour-cost.ts'`.

- [ ] **Step 3: Write `lib/pour-cost.ts`**

```ts
/**
 * What a drink costs to pour, and whether that is a sane number.
 *
 * Lifted out of prisma/checkPourCost.js, which has been doing this correctly
 * from a terminal where nobody at the bar could see it. The bands are the
 * trade's, not invented here.
 *
 * Pure arithmetic, no Prisma, so the recipe screen and the CLI check give the
 * same answer.
 */

/** [floor, ceiling] as a percentage of the selling price. */
export const BANDS: Record<string, [number, number]> = {
    Spirits: [18, 22],
    Cocktails: [18, 22],
    Beer: [20, 25],
    Sets: [20, 30],
    Mixers: [12, 18],
    Soft: [12, 18],
    Snacks: [28, 35],
    Food: [28, 35],
}

/** Wide enough not to cry wolf on a category nobody has banded yet. */
const DEFAULT_BAND: [number, number] = [10, 40]

export function bandFor(category: string | null | undefined): [number, number] {
    if (!category) return DEFAULT_BAND
    return BANDS[category] ?? DEFAULT_BAND
}

export type CostLine = {
    /** In base units, as Recipe.quantity now stores it. */
    quantity: number
    /** Ingredient.cost, which is per purchase unit - what the invoice says. */
    costPerPurchaseUnit: number
    purchaseMultiplier: number
}

/** What the ingredients in one serving are worth, to the satang. */
export function recipeCost(lines: CostLine[]): number {
    const total = lines.reduce((sum, l) => {
        if (!Number.isFinite(l.quantity) || !Number.isFinite(l.costPerPurchaseUnit)) return sum
        if (!Number.isFinite(l.purchaseMultiplier) || l.purchaseMultiplier === 0) return sum
        return sum + l.quantity * (l.costPerPurchaseUnit / l.purchaseMultiplier)
    }, 0)
    return Math.round(total * 100) / 100
}

/** Cost as a percentage of price. A free item is 0, not infinity. */
export function pourCost(cost: number, price: number): number {
    if (!Number.isFinite(price) || price <= 0) return 0
    return Math.round((cost / price) * 1000) / 10
}

export type Verdict = 'BELOW_COST' | 'HIGH' | 'OK' | 'LOW'

/**
 * Selling below cost is its own verdict rather than "very high".
 * A manager reading a list needs the one that loses money to stand out.
 */
export function verdictFor(category: string | null | undefined, pourCostPct: number): Verdict {
    if (pourCostPct >= 100) return 'BELOW_COST'
    const [floor, ceiling] = bandFor(category)
    if (pourCostPct > ceiling) return 'HIGH'
    if (pourCostPct < floor) return 'LOW'
    return 'OK'
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --experimental-strip-types --test lib/pour-cost.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Add the API endpoint**

Create `app/api/recipes/[productId]/cost/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth'
import { recipeCost, pourCost, bandFor, verdictFor } from '@/lib/pour-cost'

export const dynamic = 'force-dynamic'

/**
 * What one serving costs and whether the price makes sense (req: recipe
 * screen footer). Computed per request rather than stored, so a change to an
 * ingredient's cost is reflected the next time anyone opens the recipe.
 */
export async function GET(
    request: Request,
    { params }: { params: Promise<{ productId: string }> }
) {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    try {
        const { productId } = await params
        const { searchParams } = new URL(request.url)
        const variationSizeId = searchParams.get('variationSizeId')

        const menu = await prisma.menu.findUnique({
            where: { id: productId },
            include: {
                category: { select: { name: true } },
                variations: { include: { sizes: true } },
            },
        })
        if (!menu) return NextResponse.json({ error: 'Not found' }, { status: 404 })

        // The same base-plus-size rule the order path deducts by, so the cost
        // shown is the cost of what actually leaves the shelf.
        const recipes = await prisma.recipe.findMany({
            where: {
                OR: [
                    { menuId: productId, variationSizeId: null },
                    ...(variationSizeId ? [{ variationSizeId }] : []),
                ],
            },
            include: { ingredient: { select: { cost: true, purchaseMultiplier: true } } },
        })

        const cost = recipeCost(recipes.map((r) => ({
            quantity: r.quantity,
            costPerPurchaseUnit: r.ingredient.cost,
            purchaseMultiplier: r.ingredient.purchaseMultiplier,
        })))

        const sizes = menu.variations.flatMap((v) => v.sizes)
        const price = (variationSizeId ? sizes.find((s) => s.id === variationSizeId) : sizes[0])?.price ?? 0
        const pct = pourCost(cost, price)

        return NextResponse.json({
            cost,
            price,
            margin: Math.round((price - cost) * 100) / 100,
            pourCostPct: pct,
            band: bandFor(menu.category?.name),
            verdict: verdictFor(menu.category?.name, pct),
        })
    } catch (error) {
        console.error('[recipe cost] GET failed', error)
        return NextResponse.json({ error: 'Failed to compute cost' }, { status: 500 })
    }
}
```

- [ ] **Step 6: Verify the endpoint against the running app**

With the dev server up and a manager session cookie, request the cost of a
seeded cocktail and confirm the numbers are sane (a Mojito at 150 THB should
land in the 18-22% band or be flagged, not return 0 or NaN).

- [ ] **Step 7: Run everything**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add lib/pour-cost.ts lib/pour-cost.test.ts app/api/recipes
git commit -m "feat: pour cost is something a screen can ask for

The arithmetic and the trade bands were already right; they lived in a
CLI script nobody at the bar will ever run. Same answer, now reachable
from the recipe editor.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review notes

**Spec coverage.** "The stock ledger" → Task 1. "Schema" and "Migration" →
Task 3. "Code changes" (`lib/stock.ts`, `lib/packages.ts`, rounding table,
audit sheet) → Tasks 1 and 4. `lib/pour-cost.ts` row → Task 5. The conversion
table the migration and UI share → Task 2. Spec sections "UI", "Permissions"
and the variance report are **Plan 2** and deliberately absent here.

**Two spec items carried forward as open questions**, both flagged in the spec
and neither blocking this plan:
1. Spirit bottle sizes — encoded as `BOTTLE_ML` at the top of the migration
   script with a comment demanding confirmation before `--commit`.
2. Whether staff may set the multiplier — a Plan 2 permissions question; nothing
   in Plan 1 depends on it.

**Ordering constraint.** Task 1 must land before Task 3, because the
"immutable once stock has moved" rule the schema comment describes is defined
as "a `StockTransaction` row exists", which only becomes true for sales after
Task 1.
