# Flatten the menu: one price on the item, no variation or size tables

**Date:** 2026-09-14
**Branch:** `refactor/flatten-menu-price`
**Status:** Approved design, ready for implementation planning

---

## The problem

A menu item's price is three tables away from the item:

```
Menu -> MenuVariation (type) -> VariationSize (size, price)
```

That is the cafe shape it was inherited from: **Hot/Iced × Small/Medium/Large**.
Two axes, because a cafe genuinely has two. A bar has neither.

Nothing in the database has ever used the second level. Measured 2026-09-14:

| | |
|---|---|
| Menu items | 25 |
| Items with more than one variation | **0** |
| Items with more than one size | **0** |
| Distinct variation types | `STANDARD` (24) |
| Distinct size names | `Standard` (24) |

The cost of the structure is paid on every read. Pricing cannot be a field
lookup, so it is a search:

```ts
Math.min(
  ...item.variations.flatMap((v) => v.sizes.map((z) => z.price)).filter((n) => n > 0)
)
```

Every `Math.min`, `flatMap` and `Number.isFinite` guard around a price exists
only because the price might be in one of several nested rows. The till's
session route walks `items.variationSize.variation.menu` — a three-table join —
to fetch a photo and a category name for the customer display.

Availability is paid three times too: `Menu.isAvailable`, then
`MenuVariation.isEnabled`, then `VariationSize.isAvailable`, all of which must
be true, and all of which describe the same single row.

## The requirement conflict, recorded

`AAA-store-requriment.md` lists, benchmarked against SambaPOS4 Streamlined Core:

> Order & Menu | Streamlined Web Menu & Modifiers | Touch-friendly categories,
> sub-items, **portion sizes**, and custom preparation notes | **Must Have** |
> Included in Base Package | **TBD**

and `AAA-BAR-PLAN.md` records the Variation/Size structure as the thing that
satisfies it:

> Menu / Category / Variation / Size | Full CRUD | **Reuse as-is** — covers
> req #4 modifiers except prep notes

**This design removes that structure.** Portion sizes become a naming
convention on the item instead of a field — the way the seed data already does
it (`Whisky (glass)`, `Wine (bottle)`, `Beer Lao Bucket (5)`), and the way the
till already behaves, one tap per sellable thing.

This is a deliberate decision taken on 2026-09-14, with the conflict known. It
is written down here because whoever owns that requirements document should be
told that req #4's "portion sizes" is now satisfied by naming rather than by
structure, and may want to confirm that reading with the customer. A
conservative alternative was considered and rejected: deleting only
`MenuVariation` and keeping the size level (24-row migration, requirement
untouched).

## Design

### 1. Schema

```prisma
model Menu {
  // ...
  price       Float   @default(0)   // NEW. 0 means "not priced yet",
                                    // which is what filter(n => n > 0) means today.
  isAvailable Boolean @default(true) // becomes the only availability gate
  displayOrder Int    @default(0)    // becomes the only ordering
}

model OrderItem {
  menuId String?   // NEW, replaces variationSizeId
  menu   Menu?     @relation(fields: [menuId], references: [id], onDelete: SetNull)
  // name and price stay snapshotted: a past bill must survive a renamed
  // or deleted menu item, exactly as it does now.
}

model Recipe {
  menuId String    // already present
  // variationSizeId dropped
  @@unique([menuId, ingredientId])   // was ([menuId, variationSizeId, ingredientId])
}

model PackageSwapLine {
  menuId String?   // already present and already populated on all 16 rows
  // variationSizeId dropped
}

// deleted
model MenuVariation { }
model VariationSize { }
```

`OrderItem.menuId` is nullable and `SetNull`, matching what `variationSizeId`
does today — a deleted menu item must not delete sales history.

### 2. Migration — expand, move, contract

Three migrations, not one, so the application is never broken between steps and
each step is separately reversible.

**Migration 1 — expand (additive only, old columns untouched):**

```sql
ALTER TABLE "Menu" ADD COLUMN "price" REAL NOT NULL DEFAULT 0;
ALTER TABLE "OrderItem" ADD COLUMN "menuId" TEXT;

UPDATE "Menu" SET "price" = COALESCE((
  SELECT vs."price" FROM "VariationSize" vs
  JOIN "MenuVariation" v ON v."id" = vs."variationId"
  WHERE v."menuId" = "Menu"."id"
  ORDER BY vs."price" ASC LIMIT 1), 0);

UPDATE "OrderItem" SET "menuId" = (
  SELECT v."menuId" FROM "VariationSize" vs
  JOIN "MenuVariation" v ON v."id" = vs."variationId"
  WHERE vs."id" = "OrderItem"."variationSizeId")
WHERE "variationSizeId" IS NOT NULL;
```

`ORDER BY price ASC LIMIT 1` mirrors today's `Math.min`, so an item that
somehow had two sizes lands on the lower price rather than an arbitrary row.

**Step 2 — code moves over.** No schema change at all; this is not a migration.
The application stops reading the old columns and starts reading the new ones.
Both sets of columns are correct and populated throughout this step, which is
what makes it reversible: revert the code and nothing else has to change.

**Migration 2 — contract:**

```sql
-- Recipe: drop the column, retighten the unique
-- PackageSwapLine: drop the column
DROP TABLE "VariationSize";
DROP TABLE "MenuVariation";
```

`DROP COLUMN` needs SQLite 3.35+; below that Prisma emits a create-copy-rename
table rebuild instead. Either is fine, but the generated SQL must be read before
it runs — a rebuild silently redefines every constraint on the table.

**Row counts to assert before and after** (measured 2026-09-14):

| Table | Rows | After |
|---|---|---|
| Menu | 25 | 25, of which 24 priced > 0 |
| OrderItem | 1,027 | 1,022 with `menuId`, 5 null (already null today) |
| Recipe | 47 | 47, all `variationSizeId` null today |
| PackageSwapLine | 16 | 16, all already carry `menuId` |
| MenuVariation | 24 | gone |
| VariationSize | 24 | gone |

### 3. Code changes

32 files reference the structure. Four carry most of it:

| File | Refs |
|---|---|
| `app/api/orders/route.ts` | 28 |
| `app/pos/page.tsx` | 20 |
| `app/api/order-items/[id]/swap/route.ts` | 20 |
| `app/menu/recipes/page.tsx` | 15 |

Three mechanical patterns cover the bulk:

```ts
Math.min(...item.variations.flatMap(v => v.sizes.map(z => z.price)).filter(n => n > 0))
  -> item.price

include: { items: { include: { variationSize: { include: { variation: { include: { menu: … } } } } } } }
  -> include: { items: { include: { menu: … } } }

{ variationSizeId: x }   ->   { menuId: x }
```

**API contract.** `GET /api/menu` stops returning `variations[]` and returns
`price` on the item. `POST` and `PUT` accept `price` instead of a `variations`
array. The `availableOnly=true` filter collapses from three nested `where`
clauses to `{ isAvailable: true }`.

**Cart.** Cart lines are keyed on `variationSizeId` and persisted to
`localStorage`. The storage key must be bumped so a stale cart is discarded
rather than deserialised into a broken line.

### 4. Dead code this deletes

Two things that are already unused and go away as a consequence:

1. **The two-tier recipe lookup** in `app/api/orders/route.ts:414-415` — a
   "base" recipe (`variationSizeId: null`) and a "size-specific override"
   (`variationSizeId: <id>`). All 47 recipe rows are base; **zero overrides
   exist**. With one price per item, tier 2 has nothing to mean.

2. Every `Math.min` / `filter(n => n > 0)` / `Number.isFinite` guard around a
   price, and the `flatMap` that feeds them.

### 5. Two report sections are removed

This is the only user-visible removal in the work, and it is a consequence
rather than a goal.

`app/api/reports/analytics/route.ts:238-261` groups sales by size and by
variation type into `sizeStats` and `variationStats`. `app/reports/page.tsx`
renders both; `app/monitor/page.tsx` renders the variation one. With a single
price per item there is nothing left to group by, so the computation and both
rendered sections go.

They are not losing anything today: every row in the database is `Standard` /
`STANDARD`, so each section currently displays exactly one row saying so.

The best-seller grouping in the same file is a different thing and stays. It
currently builds keys like `Latte (COLD)` by appending the variation type; it
reduces to the menu name, which is what every key already looks like here.

### 6. Litter cleared in passing

`test gin` (Sets, no price, zero variations) is leftover test data and the only
item that would otherwise migrate to `price = 0`. Delete the row.

## Testing

- `npm test` (252 tests) after every step. `lib/packages.test.ts` and
  `lib/returns.test.ts` both exercise this area and fail loudly on a wrong shape.
- Row-count assertions from the table above, run before and after migration 1.
- **Receipt equivalence:** capture the rendered receipt for one closed bill
  before migration 1 and compare after migration 2. It must be identical —
  including the VAT line, which is now stamped per bill.
- `next build` clean.
- Manual pass, which no automated check in this repo can replace: `/menu` edit
  and create, `/pos` add to cart and settle, `/menu/recipes`, and one package
  swap through `components/pos/exchange-dialog.tsx`.

## Order of work

1. Migration 1 (expand) + row assertions. Take the receipt snapshot first.
2. `lib/` and API routes onto `Menu.price` / `OrderItem.menuId`.
3. Screens: `/pos`, `/menu`, `/menu/recipes`, exchange and returns dialogs.
4. Menu editor: single price field, accordion gone.
5. Delete `test gin`.
6. Migration 2 (contract), remove the Prisma models.
7. Full verification pass.

## Out of scope

- `sugarLevel`, `shotType`, `cupSize` on `OrderItem`, and the
  `hasSugarLevel` / `hasShotType` toggles on categories. Same cafe origin,
  separate job.
- Custom preparation notes ("No MSG, Extra Spicy"), the other half of req #4
  that `AAA-BAR-PLAN.md` records as missing.
- Any change to how packages, swaps or recipes behave. They change shape here,
  not behaviour.
