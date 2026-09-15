# Flatten Menu Price Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move a menu item's price onto the item itself and delete the `MenuVariation` / `VariationSize` tables, so pricing is a field lookup instead of a two-level search.

**Architecture:** Expand-migrate-contract. Migration 1 adds `Menu.price` and `OrderItem.menuId` and backfills them while the old columns stay populated and readable. The code then moves over with no schema change, so reverting the code is the entire rollback. Migration 2 drops the old tables once nothing reads them.

**Tech Stack:** Next.js 15 App Router, Prisma 5.22 over SQLite, `node --test` with `--experimental-strip-types` for unit tests.

**Spec:** `docs/superpowers/specs/2026-09-14-flatten-menu-price-design.md`

## Global Constraints

- **Stop the dev server before any `prisma migrate` or `prisma generate`.** A running `next dev` holds the SQLite file (`database is locked`) and the query-engine DLL (`EPERM` on rename). This has already bitten this project twice.
- **`prisma migrate dev` fails in a non-interactive shell.** Hand-write `prisma/migrations/<timestamp>_<name>/migration.sql` following the existing folders, then run `npx prisma migrate deploy` followed by `npx prisma generate`.
- **`npm run build` does NOT type-check.** `next.config.mjs` sets `typescript: { ignoreBuildErrors: true }`, so a green build proves only that the bundler ran. The type gate is `npx tsc --noEmit`. At Task 6 the count was 12 errors, all in files later tasks own (10 in `table-sessions/[id]/returns`, 2 in `order-items/[id]/swap`) plus an unrelated `prisma.config.ts` resolution error that is not ours and never goes away. Each task must report the count before and after its change and account for every difference.
- **Test command is `npm test`** — that is `node --experimental-strip-types --test lib/*.test.ts`. Only files matching `lib/*.test.ts` run. There is no DOM, jsdom, or browser harness in this repo: UI changes cannot be tested automatically and must be verified by a human.
- **The suite must never lose a test and never end red.** The baseline was 252 at Task 2; tasks that add tests raise the total (Task 3 took it to 253). The rule is: 0 failing, and the count never drops below what the previous task left. Each task states its own expected total.
- **New translation keys go in both `en` and `lo`** in `lib/translations.ts`. `lib/translations.test.ts` fails on a key present in one language only, and on duplicates.
- **`price = 0` means "not priced yet"**, matching today's `filter((n) => n > 0)`. It is not a free item.
- **Commit your own task, on this branch only.** The repo owner authorised commits on `refactor/flatten-menu-price` for this execution (2026-09-14). Run the commit step as written. NEVER `git push`, never merge, never commit on another branch.
- **Branch:** `refactor/flatten-menu-price`, cut from `fix/historical-integrity` — NOT from main. dev.db has two migrations applied (add_session_tax_rate, backfill_session_tax_rate) whose folders exist only on that branch; branching from main leaves Prisma history ahead of the filesystem and migrate deploy hits drift. The branch is already created; Task 1 does not create it.

---

### Task 1: Branch and baseline capture

Nothing in this plan is verifiable without a before-picture. This task produces it.

**Files:**
- Create: `scripts/flatten-baseline.mjs`
- Create: `.superpowers/sdd/2026-09-14-flatten-menu-price/flatten-baseline.json` (git-ignored)

**Interfaces:**
- Produces: `flatten-baseline.json` containing row counts and one rendered closed bill, used by Task 14 to prove nothing changed.

- [ ] **Step 1: Confirm the branch**

The controller already cut `refactor/flatten-menu-price` from `fix/historical-integrity` (see Global Constraints for why not main). Confirm and verify there is no migration drift:

```bash
git branch --show-current
npx prisma migrate status
```

Expected: `refactor/flatten-menu-price` and `Database schema is up to date!`. If it reports drift, stop.

- [ ] **Step 2: Start the dev server**

```bash
npm run dev
```

Leave it running for this task only. Steps in Task 2 require it stopped.

- [ ] **Step 3: Capture row counts and one closed bill**

Save as `scripts/flatten-baseline.mjs` (delete before the final commit, or keep it — Task 14 reuses it):

```js
import { PrismaClient } from '@prisma/client'
import { writeFileSync } from 'node:fs'

const p = new PrismaClient()
const counts = {
  menu: await p.menu.count(),
  menuPricedAboveZero: await p.menu.count({ where: { price: { gt: 0 } } }).catch(() => null),
  orderItem: await p.orderItem.count(),
  orderItemLinked: await p.orderItem.count({ where: { variationSizeId: { not: null } } }),
  recipe: await p.recipe.count(),
  packageSwapLine: await p.packageSwapLine.count(),
}
const bill = await p.tableSession.findFirst({
  where: { status: 'CLOSED' }, orderBy: { closedAt: 'desc' }, select: { id: true },
})
const rendered = await (await fetch(`http://localhost:3000/api/table-sessions/${bill.id}`)).json()
writeFileSync('.superpowers/sdd/2026-09-14-flatten-menu-price/flatten-baseline.json', JSON.stringify({ counts, billId: bill.id, rendered }, null, 2))
console.log(counts)
await p.$disconnect()
```

Run: `node scripts/flatten-baseline.mjs`

- [ ] **Step 4: Confirm the numbers match the spec**

Expected exactly:

```
menu: 25   orderItem: 1027   orderItemLinked: 1022   recipe: 47   packageSwapLine: 16
```

If any number differs, **stop** — the database is not the one the spec was measured against, and the migration SQL may be wrong for it.

- [ ] **Step 5: Stop the dev server**

Every later task assumes it is stopped.

---

### Task 2: Migration 1 — expand

Adds the new columns and fills them. Drops nothing. The application still runs entirely on the old columns after this task.

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260914090000_add_menu_price_and_orderitem_menu/migration.sql`

**Interfaces:**
- Produces: `Menu.price: Float` and `OrderItem.menuId: String?` with `menu` relation. Every later task reads these.

- [ ] **Step 1: Add the fields to the schema**

In `model Menu`, beside `isAvailable`:

```prisma
  /// What this item sells for. One item, one price: the bar names the serving
  /// in the item itself ("Whisky (glass)", "Beer Lao Bucket (5)") rather than
  /// carrying a size axis. 0 means not priced yet, which is what the old
  /// filter(n => n > 0) meant when the price lived two tables away.
  price        Float   @default(0)
```

In `model OrderItem`, beside `variationSizeId`:

```prisma
  /// The menu item this line sold. Nullable and SetNull for the same reason
  /// variationSizeId was: deleting a drink must not delete the night it sold.
  /// name and price stay snapshotted on this row regardless.
  menuId          String?
  menu            Menu?          @relation(fields: [menuId], references: [id], onDelete: SetNull)
```

In `model Menu`, add the back-relation:

```prisma
  orderItems   OrderItem[]
```

- [ ] **Step 2: Write the migration SQL**

`prisma/migrations/20260914090000_add_menu_price_and_orderitem_menu/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "Menu" ADD COLUMN "price" REAL NOT NULL DEFAULT 0;
ALTER TABLE "OrderItem" ADD COLUMN "menuId" TEXT;

-- Backfill the price from each item's single size. ORDER BY price ASC mirrors
-- the Math.min the screens used, so an item that somehow carried two sizes
-- lands on the lower one rather than an arbitrary row.
UPDATE "Menu" SET "price" = COALESCE((
    SELECT vs."price" FROM "VariationSize" vs
    JOIN "MenuVariation" v ON v."id" = vs."variationId"
    WHERE v."menuId" = "Menu"."id"
    ORDER BY vs."price" ASC LIMIT 1
), 0);

-- Backfill the order line's menu item through the two tables being retired.
UPDATE "OrderItem" SET "menuId" = (
    SELECT v."menuId" FROM "VariationSize" vs
    JOIN "MenuVariation" v ON v."id" = vs."variationId"
    WHERE vs."id" = "OrderItem"."variationSizeId"
)
WHERE "variationSizeId" IS NOT NULL;

CREATE INDEX "OrderItem_menuId_idx" ON "OrderItem"("menuId");
```

- [ ] **Step 3: Apply it**

```bash
npx prisma migrate deploy
npx prisma generate
```

If either reports `database is locked` or `EPERM`, the dev server is still running. Stop it and retry.

- [ ] **Step 4: Assert the backfill landed**

```bash
node -e "
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  console.log('priced > 0:', await p.menu.count({where:{price:{gt:0}}}), 'expect 24');
  console.log('orderItem with menuId:', await p.orderItem.count({where:{menuId:{not:null}}}), 'expect 1022');
  console.log('mismatch (menuId set but wrong):', await p.orderItem.count({where:{AND:[{variationSizeId:{not:null}},{menuId:null}]}}), 'expect 0');
  await p.\$disconnect();
})();"
```

Expected: `24`, `1022`, `0`. A non-zero mismatch means the join is wrong — **stop and fix the SQL**, do not proceed.

- [ ] **Step 5: Tests still pass**

Run: `npm test`
Expected: 252 passing. The schema grew; nothing read it yet.

- [ ] **Step 6: Propose the commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260914090000_add_menu_price_and_orderitem_menu
git commit -m "refactor: add Menu.price and OrderItem.menuId, backfilled"
```

---

### Task 3: lib/packages.ts — drop variationSizeId from the pure types

`lib/packages.ts` is pure arithmetic with a real test file. It is the safest place to start moving code, and its tests catch a wrong shape immediately.

**Files:**
- Modify: `lib/packages.ts`
- Modify: `lib/packages-db.ts`
- Test: `lib/packages.test.ts`

**Interfaces:**
- Consumes: `Menu.price` from Task 2.
- Produces: `Component` and `SellableMenu` without `variationSizeId`. `componentIndex`, `contentsOf`, `canSwap`, `remainingContents` keep their existing names and parameter order.

- [ ] **Step 1: Change the tests first**

In `lib/packages.test.ts`, delete every `variationSizeId:` line from the object literals that build `Component` and `SellableMenu` values. Add this test, which is the one that would catch the field coming back:

```ts
test('a package component carries the menu item, not a size row', () => {
    // The size level is gone: a component is priced and re-stocked by menu
    // item alone. A stray variationSizeId here means a caller is still
    // threading the old shape through.
    const index = componentIndex([
        { menuId: 'm1', name: 'Heineken', unitPrice: 60,
          recipe: [{ ingredientId: 'i1', quantity: 1, measureType: 'EACH' }] },
    ])
    const [component] = contentsOf([{ ingredientId: 'i1', quantity: 2 }], index)
    assert.deepEqual(component, {
        menuId: 'm1', name: 'Heineken', localName: null, unitPrice: 60, quantity: 2,
    })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test`
Expected: FAIL on the new test with an `AssertionError` showing `variationSizeId: null` present in the actual object. Other tests in the file may also fail on the removed literals — that is fine and expected.

- [ ] **Step 3: Remove the field from the two types**

In `lib/packages.ts`, delete `variationSizeId: string | null` from both `Component` and `SellableMenu`, and delete the `variationSizeId: sellable.variationSizeId,` line from the object `contentsOf` pushes.

- [ ] **Step 4: Point `sellableMenus` at the new column**

Replace the body of `lib/packages-db.ts`'s map and query. The `variations`/`sizes` include goes away entirely:

```ts
export async function sellableMenus(): Promise<SellableMenu[]> {
    const menus = await prisma.menu.findMany({
        where: { isAvailable: true },
        include: {
            recipes: {
                select: {
                    ingredientId: true,
                    quantity: true,
                    ingredient: { select: { measureType: true } },
                },
            },
        },
        orderBy: { name: 'asc' },
    })

    return menus.map((m) => ({
        menuId: m.id,
        name: m.name,
        localName: m.localName,
        unitPrice: m.price,
        recipe: m.recipes.map((r) => ({
            ingredientId: r.ingredientId,
            quantity: r.quantity,
            measureType: r.ingredient.measureType as MeasureType,
        })),
    }))
}
```

Note the availability filter lost two of its three clauses: `VariationSize.isAvailable` and `MenuVariation.isEnabled` no longer exist as gates, `Menu.isAvailable` is the only one.

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: 252 passing, including the new test. If a `packages.test.ts` case still fails, it is holding a stale literal — fix the test, not the source.

- [ ] **Step 6: Propose the commit**

```bash
git add lib/packages.ts lib/packages-db.ts lib/packages.test.ts
git commit -m "refactor: package components are priced by menu item"
```

---

### Task 4: lib/swap-charge.ts and lib/returns.ts

**Files:**
- Modify: `lib/swap-charge.ts`
- Modify: `lib/returns.ts`
- Test: `lib/returns.test.ts`

**Interfaces:**
- Consumes: `Component` without `variationSizeId` from Task 3.
- Produces: both modules keyed on `menuId` only.

- [ ] **Step 1: Find every reference**

Run: `grep -n "variationSize" lib/swap-charge.ts lib/returns.ts lib/returns.test.ts`

- [ ] **Step 2: Update `lib/returns.test.ts` first**

Delete `variationSizeId` from the fixture literals. Where a test identifies a line by `variationSizeId`, change it to `menuId` with the same value — the tests use synthetic ids, so the string can stay as it is.

- [ ] **Step 3: Run and watch it fail**

Run: `npm test`
Expected: FAIL with type or assertion errors in `returns.test.ts`.

- [ ] **Step 4: Update both modules**

Replace each `variationSizeId` with `menuId` in the parameter types and the comparisons. These modules match lines against package contents; the key changes, the logic does not.

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: 252 passing.

- [ ] **Step 6: Propose the commit**

```bash
git add lib/swap-charge.ts lib/returns.ts lib/returns.test.ts
git commit -m "refactor: swap and return lines key on menu item"
```

---

### Task 5: /api/menu — the read and write contract

Every screen gets its menu from here, so this task changes the shape the rest of the app sees.

**Files:**
- Modify: `app/api/menu/route.ts`
- Modify: `app/api/menu/[id]/route.ts`

**Interfaces:**
- Produces: `GET /api/menu` returns `price: number` per item and no `variations` array. `POST` and `PUT` accept `price` in the body instead of a `variations` array.

- [ ] **Step 1: Simplify the GET query**

In `app/api/menu/route.ts`, delete the entire `variations: { ... }` block from the `include`. The `where` becomes just `availableOnly ? { isAvailable: true } : {}` — it already is; the two nested `where` clauses disappear with the include.

- [ ] **Step 2: Change the response shape**

In the `transformed` map, delete the whole `variations: menu.variations.map(...)` block and add:

```ts
            price: menu.price,
```

Leave `_count`, `hasSugarLevel` and `hasShotType` exactly as they are — they are out of scope.

- [ ] **Step 3: Change POST and PUT**

Both destructure `variations` from the body. Replace with `price`. Delete the nested `create` / `update` blocks that write `MenuVariation` and `VariationSize` rows, and write `price` directly on the `Menu` create/update. In `app/api/menu/[id]/route.ts` this removes the block around line 57-94, including the commented-out `variationSize.updateMany` line — delete that too rather than leaving dead commentary about a table that no longer exists.

- [ ] **Step 4: Verify by hand**

```bash
npm run dev
```

```bash
curl -s "http://localhost:3000/api/menu" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const m=JSON.parse(d);console.log('items:',m.length);console.log('has price:',m.every(x=>typeof x.price==='number'));console.log('has variations:',m.some(x=>'variations' in x))})"
```

Expected: `items: 25`, `has price: true`, `has variations: false`.

Stop the dev server afterwards.

- [ ] **Step 5: Propose the commit**

```bash
git add app/api/menu
git commit -m "refactor: the menu API returns one price per item"
```

---

### Task 6: /api/orders — the heaviest file

28 references, and the place where the dead two-tier recipe lookup lives.

**Files:**
- Modify: `app/api/orders/route.ts`

**Interfaces:**
- Consumes: `Menu.price`, `OrderItem.menuId`.
- Produces: order creation accepts `menuId` per cart line instead of `variationSizeId`.

- [ ] **Step 1: Change the request contract**

Lines 65-101: `variationSizeIds` becomes `menuIds`, `prisma.variationSize.findMany` becomes `prisma.menu.findMany`, and the error string `'Items must have variationSizeId'` becomes `'Items must have menuId'`.

- [ ] **Step 2: Reprice from the item**

Line 176's `priceById` map is built from the fetched rows. It now keys on `menu.id` with `menu.price`. The server-side reprice is the security boundary — a cart cannot set its own price — so this map must still be built from the database rows, never from the request body.

- [ ] **Step 3: Write `menuId` on the created line**

Line 328: `variationSizeId: item.variationSizeId` becomes `menuId: item.menuId`.

- [ ] **Step 4: Delete the two-tier recipe lookup**

Lines 403-415 currently resolve a recipe in two tiers:

```ts
{ menuId: vs.variation.menu.id, variationSizeId: null },   // Tier 1: Base
{ variationSizeId: item.variationSizeId }                   // Tier 2: Specific Choice
```

All 47 recipe rows in the database are tier 1 and zero are tier 2, and with one price per item tier 2 has nothing to mean. Replace the whole lookup with a single `where: { menuId: item.menuId }`, and delete the `tx.variationSize.findUnique` calls at 404 and 468 that existed only to reach the menu id.

- [ ] **Step 5: Tests and build**

Run: `npm test` — expected 252 passing.
Run: `npx tsc --noEmit` — expected no NEW errors versus the count before your change. Type errors here are the point: they name every remaining caller.

- [ ] **Step 6: Propose the commit**

```bash
git add app/api/orders/route.ts
git commit -m "refactor: orders are created and priced from the menu item"
```

---

### Task 7: the remaining API routes

**Files:**
- Modify: `app/api/order-items/[id]/swap/route.ts`
- Modify: `app/api/table-sessions/[id]/returns/route.ts`
- Modify: `app/api/table-sessions/[id]/route.ts`
- Modify: `app/api/recipes/[productId]/route.ts`
- Modify: `app/api/recipes/[productId]/cost/route.ts`
- Modify: `app/api/orders/[id]/void/route.ts`
- Modify: `app/api/orders/[id]/route.ts`
- Modify: `app/api/reports/analytics/route.ts`
- Modify: `app/api/reports/export/route.ts`
- Modify: `app/api/dashboard/stats/route.ts`

- [ ] **Step 1: Let the compiler produce the list**

Run: `npx tsc --noEmit 2>&1 | grep "error TS" | head -40`

(`npm run build` is useless for this — `next.config.mjs` sets
`ignoreBuildErrors: true`, so it compiles cleanly over broken types.)

Work the list top to bottom. Every error is a real caller of a field that no longer exists.

- [ ] **Step 2: Apply the three patterns**

```ts
// the deep include, in app/api/table-sessions/[id]/route.ts
items: { include: { variationSize: { include: { variation: { include: { menu: … } } } } } }
  ->  items: { include: { menu: { select: { image: true, localName: true, category: { select: { name: true } }, recipes: { select: { ingredientId: true, quantity: true } } } } } }

// the flattening that follows it
const menu = item.variationSize?.variation?.menu
  ->  const menu = item.menu

// every filter and write
{ variationSizeId: x }   ->   { menuId: x }
```

In `app/api/table-sessions/[id]/route.ts` the destructure `const { variationSize, ...line } = item` becomes `const { menu, ...line } = item`.

- [ ] **Step 3: Delete the dead import you will pass**

`app/api/reports/analytics/route.ts:4` imports `calculateInclusiveTax` and never uses it — the report sums the stored `Order.tax` column. Delete the import line while you are in the file.

**Scope limit on this file:** delete ONLY that import here. The rest of
`analytics/route.ts` — the `variationSize` include, the size and variation
grouping — belongs to Task 11, which deletes those sections outright. Migrating
them here would be work Task 11 throws away. This is safe because the old
columns still exist until Task 13, so untouched code continues to compile.

- [ ] **Step 4: Build clean**

Run: `npx tsc --noEmit` (npm run build does NOT type-check — see Global Constraints)
Expected: no NEW errors versus the count you recorded before starting, no type errors.

Run: `npm test` — expected 252 passing.

- [ ] **Step 5: Propose the commit**

```bash
git add app/api
git commit -m "refactor: API routes read the menu item directly"
```

---

### Task 8: the till

**Files:**
- Modify: `app/pos/page.tsx`
- Modify: `app/pos/components/CustomizationDialog.tsx`
- Modify: `lib/cart-storage.ts`
- Test: `lib/cart-storage.test.ts`

- [ ] **Step 1: Bump the cart storage key**

Cart lines are keyed on `variationSizeId` and persisted to `localStorage`. A cart saved before this change would deserialise into a line with no menu item. In `lib/cart-storage.ts`, change the storage key string (append `-v2`). Update `lib/cart-storage.test.ts` if it asserts the key.

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: 252 passing. If `cart-storage.test.ts` fails, it is asserting the old key — update the expectation.

- [ ] **Step 3: Move the cart line shape**

In `app/pos/page.tsx` and `CustomizationDialog.tsx`, replace `variationSizeId` with `menuId` on the cart line type and everywhere it is read or written. The price now comes from `item.price` rather than being looked up through variations.

- [ ] **Step 4: Build**

Run: `npx tsc --noEmit` (npm run build does NOT type-check — see Global Constraints)
Expected: no NEW errors versus the count you recorded before starting.

- [ ] **Step 5: Propose the commit**

```bash
git add app/pos lib/cart-storage.ts lib/cart-storage.test.ts
git commit -m "refactor: the cart holds menu items"
```

---

### Task 9: the menu editor

The accordion your co-dev complained about disappears here. This is the only task with visible UI design in it.

**Files:**
- Modify: `app/menu/page.tsx`

- [ ] **Step 1: Replace the variations block with one price field**

Delete the `DEFAULT_SIZES` constant near line 58 (it still contains cafe leftovers — `"0 Cal Sweetener"`), the `toggleVariation` function near line 411, and the entire variations card section around lines 755-800. In their place, one field in the basic-info grid:

```tsx
<div className="space-y-2">
  <Label htmlFor="price">{t.price}</Label>
  <PriceInput
    id="price"
    value={formData.price ?? 0}
    onChange={(value) => setFormData({ ...formData, price: value })}
  />
</div>
```

`PriceInput` is already imported in this file (`@/components/ui/PriceInput`) and is what the old size rows used, so the keypad behaviour staff know is unchanged.

- [ ] **Step 2: Update the form state**

`formData` is `Partial<MenuItem>`. Remove `variations` from the `MenuItem` type near line 38 and add `price: number`. `handleAddNew` and `handleEdit` stop building a variations array and set `price` instead.

- [ ] **Step 3: Keep the discard guard working**

`PriceInput` renders a native input, so the existing `onInput={markDirty}` on `DialogContent` covers it. The two `markDirty()` calls that were added to the variation toggles are being deleted with those toggles — verify the availability Switch still has its `markDirty()` call. Do not delete that one.

- [ ] **Step 4: Build**

Run: `npx tsc --noEmit` (npm run build does NOT type-check — see Global Constraints)
Expected: no NEW errors versus the count you recorded before starting.

- [ ] **Step 5: Propose the commit**

```bash
git add app/menu/page.tsx
git commit -m "refactor: a menu item has one price field"
```

---

### Task 10: the remaining screens

**Files:**
- Modify: `app/menu/recipes/page.tsx`
- Modify: `components/pos/exchange-dialog.tsx`
- Modify: `components/pos/returns-dialog.tsx`
- Modify: `components/menu-item-card.tsx`
- Modify: `app/receipt/page.tsx`
- Modify: `app/pos/page.tsx` — ONLY to delete the shim described below
- Modify: `app/menu/page.tsx` — ONLY to delete the second shim described below

- [ ] **Step 1: Simplify the card**

`components/menu-item-card.tsx` computes:

```ts
const price = Math.min(
    ...item.variations.flatMap((v) => v.sizes.map((z) => z.price)).filter((n) => n > 0)
)
```

Replace with `const price = item.price`. Change the `MenuCardItem` type's `variations` field to `price: number`. The render guards with `Number.isFinite(price)`. That guard is NOT sufficient on its own: `Number.isFinite(0)` is `true`. The old code hid an unpriced item only by accident, because `Math.min(...[].filter(n => n > 0))` returns `Infinity` when the array empties. Reading `item.price` directly removes that accident, so the guard must become `Number.isFinite(price) && price > 0` or an unpriced item renders "฿0" and reads as free.

- [ ] **Step 2: Delete the shim Task 8 left behind**

`app/pos/page.tsx:87-93` synthesizes a fake one-size `variations` shape at the
`MenuCard` call boundary — `item={{ ...item, variations: [{ sizes: [{ price: item.price }] }] }}`
— purely so this component kept working while Task 8 ran. Step 1 makes that a
hard `TS2353` excess-property error, so it cannot be skipped, but delete it
deliberately rather than letting the type checker force it: pass `item` straight
through. Task 9 then set the same precedent a second time in `app/menu/page.tsx`, at the
`<MenuItemCard>` call boundary. Delete that one too, the same way. Those two
files are in scope for THIS DELETION ONLY — change nothing else in either.

After both are gone, run `grep -rn "variations" app/pos/page.tsx app/menu/page.tsx`
and expect no hits. Two shims were created because each task needed the shared
card to keep rendering; a third would mean this task has not finished its job.

- [ ] **Step 3: Sweep the other four**

Run: `grep -n "variationSize\|variations" app/menu/recipes/page.tsx components/pos/exchange-dialog.tsx components/pos/returns-dialog.tsx app/receipt/page.tsx`

Apply these, the same three the API routes needed:

```ts
Math.min(...item.variations.flatMap(v => v.sizes.map(z => z.price)).filter(n => n > 0))
  -> item.price

item.variationSize?.variation?.menu
  -> item.menu

{ variationSizeId: x }
  -> { menuId: x }
```

The recipes page is the largest of these at 15 references: it selects a product, then a variation, then a size to attach a recipe to. The variation and size selectors both disappear; a recipe now attaches to the product directly.

- [ ] **Step 4: Build and test**

Run: `npx tsc --noEmit` — expected no NEW errors versus the count before your change.
Run: `npm test` — expected 252 passing.

- [ ] **Step 5: Propose the commit**

```bash
git add app/menu/recipes components/pos components/menu-item-card.tsx app/receipt
git commit -m "refactor: screens read one price off the item"
```

---

### Task 11: reports — remove the size and variation breakdowns

The analytics API groups sales by size and by variation type, and two screens
render those groups. With one price per item there is nothing left to group by,
so these sections are deleted rather than migrated. They already show a single
meaningless row each (`Standard`, `STANDARD`) — this is the only user-visible
removal in the whole plan.

**Files:**
- Modify: `app/api/reports/analytics/route.ts:238-261`
- Modify: `app/reports/page.tsx:612`
- Modify: `app/monitor/page.tsx:277`
- Modify: `lib/translations.ts`
- Check: `app/api/reports/export/route.ts:56` — same reporting family, never named in any earlier exemption list. Judge it and either migrate it or say why it is fine.

**Interfaces:**
- Produces: the analytics response no longer carries `sizeStats` or `variationStats`.

- [ ] **Step 1: Delete the computation**

In `app/api/reports/analytics/route.ts`, delete section "6. Size & Variation
Type Stats" entirely — `sizeMap`, `varTypeMap`, `sizeStats`, `variationStats`,
and the two keys in the response object that carry them. Also delete the
`variations: { include: { sizes: true } }` include near line 224 that fed it.

The best-seller grouping near line 187 is different and must be **kept**: it
groups by menu name, and currently appends the variation type to build a key
like `Latte (COLD)`. Reduce it to the menu name alone:

```ts
const menuName = item.menu?.name || item.name.split(' - ')[0]
const bestSellerKey = menuName
```

- [ ] **Step 2: Remove the two rendered sections**

In `app/reports/page.tsx` around line 612 and `app/monitor/page.tsx` around
line 277, delete the blocks rendering `t.variation_performance` and, in the
reports page, `t.size_performance`. Remove the now-unused state or props that
held `sizeStats` / `variationStats`.

- [ ] **Step 3: Remove the orphaned translation keys**

Delete these from **both** the `en` and `lo` blocks of `lib/translations.ts` —
removing from one language only fails `lib/translations.test.ts`:

```
variations_pricing, add_variation_type, variation_name_placeholder,
add_size, size_label, variations, variation, variation_performance,
size_performance
```

Also fix `recipe_section_hint`, which currently reads "Base recipe. Per-size
recipes live on the Recipes screen." Per-size recipes no longer exist — Task 6
deleted the tier-2 lookup that made them possible. Replace both language
versions with text describing a single recipe per item.

- [ ] **Step 4: Verify key parity**

Run: `node --experimental-strip-types --test lib/translations.test.ts`
Expected: 3 passing. A failure here means a key was removed from one language
and not the other.

- [ ] **Step 5: Build and test**

Run: `npx tsc --noEmit` — expected no NEW errors versus the count before your change.
Run: `npm test` — expected 252 passing.

- [ ] **Step 6: Propose the commit**

```bash
git add app/api/reports/analytics/route.ts app/reports/page.tsx app/monitor/page.tsx lib/translations.ts
git commit -m "refactor: drop the size and variation report breakdowns"
```

---

### Task 12: seed scripts and litter

**Files:**
- Modify: `prisma/seedBarData.js`
- Modify: `prisma/seedDemoHistory.js`
- Modify: `prisma/addVipSet.js`
- Modify: `prisma/checkPourCost.js`

- [ ] **Step 1: Update the seeds**

These create `variations: { create: { type: 'STANDARD', sizes: { create: { size: 'Standard', price } } } }`. Replace with `price` directly on the menu create. A broken seed is not caught by any test and will only surface when someone sets up a fresh database.

- [ ] **Step 2: Delete the test litter**

```bash
node -e "
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  const r = await p.menu.deleteMany({ where: { name: 'test gin' } });
  console.log('deleted:', r.count, 'expect 1');
  await p.\$disconnect();
})();"
```

- [ ] **Step 3: Prove a fresh database still builds**

**Never run `prisma migrate reset` against `prisma/dev.db`.** It destroys the
1,027 order lines this whole plan is verifying against, and Task 14's receipt
comparison needs the bill captured in Task 1. Point a throwaway database at the
same migrations instead:

```bash
DATABASE_URL="file:./seedcheck.db" npx prisma migrate deploy
DATABASE_URL="file:./seedcheck.db" npm run db:seed
DATABASE_URL="file:./seedcheck.db" node -e "
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{ console.log('seeded items:', await p.menu.count(), '| priced:', await p.menu.count({where:{price:{gt:0}}})); await p.\$disconnect(); })();"
rm -f prisma/seedcheck.db
```

Both numbers must be non-zero and equal. `prisma/dev.db` is never touched.

- [ ] **Step 4: Propose the commit**

```bash
git add scripts/flatten-baseline.mjs prisma/seedBarData.js prisma/seedDemoHistory.js prisma/addVipSet.js prisma/checkPourCost.js
git commit -m "refactor: seeds write one price per item"
```

---

### Task 13: Migration 2 — contract

Only now, with nothing reading them, do the old columns go.

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260914170000_drop_variation_and_size/migration.sql`

- [ ] **Step 1: Confirm nothing reads them**

Run: `grep -rn --include="*.ts" --include="*.tsx" --include="*.js" -E "variationSize|MenuVariation|VariationSize" app lib components prisma hooks | grep -v migrations`

Expected: **no output**. Any hit is a caller this plan missed — fix it before continuing.

- [ ] **Step 2: Remove the models**

In `prisma/schema.prisma`: delete `model MenuVariation` and `model VariationSize` entirely; delete `variations VariationSize[]` from `Menu`; delete `variationSizeId` and the `variationSize` relation from `Recipe`, `OrderItem` and `PackageSwapLine`; change `Recipe`'s `@@unique([menuId, variationSizeId, ingredientId])` to `@@unique([menuId, ingredientId])`; delete `@@index([variationSizeId])` from `OrderItem`.

- [ ] **Step 3: Write the migration and read what Prisma generates**

**DO NOT use `prisma migrate diff`.** The controller ran it on 2026-09-15 and it
generates a rebuild of `Ingredient`, `OrderItem` and `PackageSwap` plus dropped
`Payment` indexes — almost all of it from PRE-EXISTING drift, not from this
refactor. `prisma/migrations/` never captured a migration for
`Ingredient.measureType` / `baseUnit` / `purchaseUnit` / `purchaseMultiplier`
(added to schema.prisma in commit a02687b). Applying that generated SQL would
rebuild unrelated tables at the one-way door.

Hand-write the migration instead, exactly like Task 2 did. The controller
verified the following against a throwaway copy of the real database:

- SQLite here is **3.45.0**, so `DROP COLUMN` is available.
- `PackageSwapLine.variationSizeId` drops cleanly with `ALTER TABLE ... DROP COLUMN`.
- `OrderItem.variationSizeId` and `Recipe.variationSizeId` do **NOT**. Both tables
  carry a `FOREIGN KEY ("variationSizeId") REFERENCES "VariationSize"` clause, and
  SQLite refuses the drop with *error in table X after drop column: unknown column*.
  These two need a create-copy-drop-rename rebuild that omits both the column and
  its FK clause. Preserve every other column, index and foreign key on those two
  tables exactly — a rebuild silently redefines whatever you do not restate.
- Drop `OrderItem_variationSizeId_idx` before rebuilding, and recreate
  `OrderItem_orderId_idx`, `OrderItem_menuId_idx` and `OrderItem_voidedAt_idx` after.
- Replace `Recipe_menuId_variationSizeId_ingredientId_key` with a unique index on
  `(menuId, ingredientId)`.
- Drop `VariationSize` then `MenuVariation` last, after the columns referencing
  them are gone.

Wrap the whole thing in `PRAGMA foreign_keys=OFF;` ... `PRAGMA foreign_keys=ON;`
as Prisma's own generated rebuilds do, and run it inside one transaction.

- [ ] **Step 4: Apply**

```bash
npx prisma migrate deploy
npx prisma generate
```

- [ ] **Step 5: Assert nothing was lost**

```bash
node -e "
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  console.log('menu:', await p.menu.count(), 'expect 24');
  console.log('orderItem:', await p.orderItem.count(), 'expect 1027');
  console.log('orderItem linked:', await p.orderItem.count({where:{menuId:{not:null}}}), 'expect 1022');
  console.log('recipe:', await p.recipe.count(), 'expect 47');
  console.log('packageSwapLine:', await p.packageSwapLine.count(), 'expect 16');
  await p.\$disconnect();
})();"
```

`menu` is 24, not 25, because Task 12 deleted `test gin`. Every other number must match the Task 1 baseline exactly.

- [ ] **Step 6: Propose the commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260914170000_drop_variation_and_size
git commit -m "refactor: drop the variation and size tables"
```

---

### Task 14: Full verification

No automated check in this repo covers the UI. This task is where a human confirms it.

- [ ] **Step 1: The receipt must be byte-identical**

```bash
npm run dev
```

```bash
node -e "
const {readFileSync}=require('fs');
const base=JSON.parse(readFileSync('.superpowers/sdd/2026-09-14-flatten-menu-price/flatten-baseline.json','utf8'));
fetch('http://localhost:3000/api/table-sessions/'+base.billId).then(r=>r.json()).then(now=>{
  const pick=b=>({gross:b.gross,total:b.total,discount:b.discount,taxRate:b.taxRate,fxRateLAK:b.fxRateLAK,
    lines:(b.orders||[]).flatMap(o=>o.items.map(i=>i.name+'x'+i.quantity+'@'+i.price))});
  const a=JSON.stringify(pick(base.rendered)), z=JSON.stringify(pick(now));
  console.log(a===z ? 'IDENTICAL' : 'DIFFERS');
  if(a!==z){console.log('before:',a);console.log('after :',z)}
});"
```

Expected: `IDENTICAL`. Anything else means a historical bill changed, which this refactor must never do.

- [ ] **Step 2: Automated checks**

Run: `npm test` — expected 252 passing.
Run: `npx tsc --noEmit` — expected no NEW errors versus the count before your change.

- [ ] **Step 3: Hand the manual pass to a human**

These cannot be automated here. Each must be done by a person:

| Screen | Check |
|---|---|
| `/menu` | Create an item with a price; edit it; the price persists. One field, no accordion. |
| `/menu` | Open an item, type, press Esc — the discard prompt still appears (Task 9 touched that dialog). |
| `/pos` | Prices on the grid match `/menu`. Add to cart, settle, receipt shows the right total. |
| `/menu/recipes` | Attach an ingredient to a product; the product selector has no variation or size step. |
| `/pos` exchange | Swap a component out of a Set; the charge matches what the dialog previewed. |
| `/orders` | Reprint an old bill — same money as before this work started. |

- [ ] **Step 4: Clean up**

Delete `scripts/flatten-baseline.mjs` and `../scratch/` if they are not wanted. Confirm `git status` is clean.

- [ ] **Step 5: Propose the final merge**

```bash
git checkout main
git merge --no-ff refactor/flatten-menu-price
```

Do not push. The repo owner runs that themselves.

---

## Notes for whoever executes this

- **Task 2's Step 4 assertion is the gate.** If the backfill mismatch is anything but 0, nothing downstream is trustworthy. Stop there.
- **Tasks 5 through 11 are reversible by `git revert` alone** — both column sets are live and correct throughout, which is the entire point of the expand-contract split.
- **Task 13 is the one-way door.** Once the tables are dropped, going back means restoring `prisma/dev.db` from a copy taken before Task 13; take one.
- The requirements document lists "portion sizes" as a **Must Have** that this work removes. That decision is recorded in the spec with its date and rationale. If anyone raises it mid-implementation, point them at the spec rather than relitigating it here.
