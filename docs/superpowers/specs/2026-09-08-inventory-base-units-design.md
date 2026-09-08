# Inventory: base units, a real stock ledger, and a UI for linking ingredients to the menu

**Date:** 2026-09-08
**Branch:** `feat/inventory-base-units`
**Status:** Approved design, ready for implementation planning

---

## The problem

An ingredient in this system has exactly one unit, held as free text on
`Ingredient.unit`. There is no way to say that you buy Hongthong by the bottle
and pour it by the millilitre. So the conversion had to go somewhere, and it
went into every recipe row as a repeating decimal:

```
Whisky (glass)  ->  Hongthong (bottle) x 0.04285714285714286
Mojito          ->  White Rum (bottle) x 0.06428571428571428
```

That is 30ml and 45ml divided by a 700ml bottle, stored as a float that binary
cannot represent. Three pieces of the codebase exist only to cope with it:

1. `STOCK_DP = 3` and the SQL-side `ROUND()` in `lib/stock.ts`. The comment
   there says it plainly: subtracting that fraction a few hundred times leaves
   the shelf holding `-29.91428571428571` bottles.
2. The `componentIndex` rule in `lib/packages.ts` - "recipe is exactly one
   ingredient at exactly quantity 1". This is using *quantity == 1* as a proxy
   for *this item is counted in whole units*, because there is no field that
   says so.
3. Ice being un-exchangeable. Not a decision anybody made about ice; a side
   effect of the Ice Bucket being 2kg rather than 1.

A second problem surfaced during the cross-check and is arguably worse: **a sale
does not write to the stock ledger.** See "The stock ledger" below.

A third: adding one new drink means visiting three screens in the right order,
and nothing tells you when you have half-finished.

## What the standard actually is

Researched against SambaPOS (named as the reference in
`AAA-store-requriment.md`), Restaurant365, and Supy. All three converge:

Every ingredient lives in three unit worlds - the unit you **buy** it in, the
unit you **count** it in, and the unit a recipe **consumes**. They are
reconciled by resolving everything to a single base unit.

SambaPOS names the fields literally:

| SambaPOS field | Meaning | Bar example |
| --- | --- | --- |
| Base Unit | what recipes and all inventory processes use | `ml`, `g`, `each` |
| Transaction Unit | what you purchase in | `bottle`, `case` |
| Multiplier | base units per transaction unit | `700` |

Its own documented examples are bar-shaped: *"Coca Cola 330 ml Can /
Quantity"*, *"Draft Beer / Cl"*, *"tomato paste: base unit gram, transaction
unit kg, multiplier 1000"*.

Restaurant365 adds one guard worth copying: an **immutable Measure Type** per
item (Weight / Volume / Each), so a conversion from grams to litres cannot be
defined at all.

Sources:
- <https://kb.sambapos.com/en/2-3-15-a-how-to-add-inventory-item/>
- <https://kb.sambapos.com/en/2-3-15-c-what-is-inventory-recipe-how-to-create/>
- <https://docs.restaurant365.com/docs/unit-of-measure>
- <https://docs.restaurant365.com/docs/unit-of-measure-conversions>
- <https://supy.io/blog/learn-restaurant-inventory-unit-conversion>

## Where we stand against it

24 capabilities the standard assumes. We have 7, partially have 4, are missing
13 - three of which are kitchen-shaped and deliberately stay missing.

### Item master

| Standard | Us |
| --- | --- |
| Measure type, immutable | missing - `unit: 'bottle'` means EACH for beer and VOLUME for spirits |
| Base unit, derived not typed | missing - free text, validated only for presence |
| Purchase unit + multiplier | missing - this is the `0.042857` hack |
| Cost per purchase unit | have (`Ingredient.cost`) |
| Category / group | have (`IngredientCategory`) |
| Par levels min/max | have - 4 fields across main and sub |
| Multiple warehouses | partial - 2 hardcoded (MAIN/SUB). Correct for one bar |

### Recipe

| Standard | Us |
| --- | --- |
| Scoped to product + portion | have - `menuId + variationSizeId`, matches SambaPOS Product+Portion |
| Quantities in base units | missing |
| Live recipe cost | partial - logic exists in `prisma/checkPourCost.js`, never rendered |
| Margin / pour cost % | partial - same script, with real trade bands |
| Fixed cost (ice, straws, garnish) | missing - worth adding |
| Yield / waste factor | missing - **kitchen-shaped, skip** |
| Semi-products / prep recipes | missing - syrup is bought here, **skip** |

### Stock operations

| Standard | Us |
| --- | --- |
| Receive in purchase units, auto-convert | partial - deposit dialog uses the single `unit` |
| Transfer between stores | have |
| Count + variance capture | have (`StockCount`) |
| **Sales write to the ledger** | **missing** |
| Depletion / variance report | missing - data captured, never read |
| Waste / adjustment with reason | have (`SHOP_ADJUST`) |

### Linking and integrity

| Standard | Us |
| --- | --- |
| Menu item with no recipe is flagged | missing |
| Create ingredient inline from the recipe screen | missing |
| Unit validation | missing |
| Lock the multiplier once stock has moved | missing |

### What we have that the standard does not

The revamp must not break these. None of them is common in mainstream POS:

- The package exchange engine, with a full swap audit and reversal
- Unopened-drink restock, restricted to the table's own cart
- Names and prices snapshotted onto every historical line

## The stock ledger

Measured on the live database:

```
StockTransaction rows:  DEPOSIT 74   SHOP_ADJUST 10   RETURN_UNOPENED 4
Orders placed:          553
Ledger rows written by those orders: 0
```

`decrementStock` performs a bare `UPDATE "Ingredient" SET "subStock" = ...`.
No row, no user, no timestamp, no reason. Deposits, withdrawals, adjustments
and returns each write a ledger row. The single largest consumer of stock does
not.

Two things follow. The standard depletion identity -
`Starting + Intake - Ending = Depletion` - cannot be computed, because intake
is in the ledger and depletion is not. And when the audit sheet shows six
bottles missing, nobody can ask what sold; only two balances can be diffed.

This is fixed first, before the migration, so that the migration itself is
auditable.

## Design

### 1. Schema

Additive. No column is dropped and no existing column changes meaning.

```
Ingredient
  + measureType         WEIGHT | VOLUME | EACH    immutable once stock has moved
  + baseUnit            g | ml | each             derived from measureType
  + purchaseUnit        "bottle" | "case" | "kg"  what the delivery note says
  + purchaseMultiplier  Float                     base units per purchase unit
    unit                KEPT - becomes display-only legacy
    mainStock, subStock, minStock, maxStock, minStockSub, maxStockSub
                        values migrate to base units; columns unchanged
```

`cost` stays cost-per-purchase-unit, which is what an invoice says.
Cost-per-base-unit is derived at read time and never stored, so a price change
cannot leave two figures disagreeing.

`Recipe.quantity` migrates to base units. The column does not change.

### 2. The stock ledger

`decrementStock` gains a sibling that writes the ledger row inside the same
transaction. Every existing caller passes a reason:

| Caller | Type |
| --- | --- |
| order sent | `SALE` |
| round voided | `SALE_VOID` |
| package exchange, both directions | `EXCHANGE` |
| unopened restock | `RETURN_UNOPENED` (already exists) |

Deliberately not a trigger and not a derived view: the row records *why* the
stock moved and *who* moved it, which no amount of diffing balances can
reconstruct afterwards.

### 3. Migration

One script, reversible, run against a copy first. Three buckets, measured
against the live data:

- **41 of 47 rows convert mechanically.** `kg -> g x1000`,
  `litre -> ml x1000`, `can/piece -> each x1`, `beer bottle -> each x1`.
- **4 rows need one fact: the spirit bottle size.** 700ml is used for
  Hongthong, Vodka, White Rum and Gin, because it makes the pours land on
  exactly 30ml and 45ml - which is what a jigger measures. To be confirmed
  against the owner's actual bottles before the script runs for real.
- **2 rows are left alone.** `Gin Tonic / Lime 0.25 piece` and
  `Mojito / Mint 0.15 bunch` stay fractional EACH. Legal, and the existing
  `Number.isInteger` guard already excludes them from being exchangeable.

The script writes the pre-migration values into `StockTransaction.notes` so the
conversion is itself auditable, and reports any row it cannot convert rather
than guessing.

### 4. Code changes

| File | Change |
| --- | --- |
| `lib/stock.ts` | ledger row alongside every movement; rounding becomes per measure type (see below). The rounding hack stops being load-bearing |
| `lib/packages.ts` | `componentIndex` rule becomes `measureType === 'EACH' && quantity === 1` - same behaviour, honest reason |
| `lib/pour-cost.ts` | **new** - lifted from `prisma/checkPourCost.js`, which already values a recipe at ingredient cost and checks it against real trade bands |
| `app/api/orders/route.ts` | untouched - still deducts `recipe.quantity`, now in base units |
| audit sheet | prints `3 bottles + 250 ml` instead of `3.357` |

**Rounding, per measure type.** `STOCK_DP` is currently a single constant of 3,
chosen to absorb the repeating decimals. Once quantities are in base units it
becomes a function of measure type:

| Measure type | Decimal places | Why |
| --- | --- | --- |
| WEIGHT (g) | 0 | a gram is already fine enough; nothing pours a third of one |
| VOLUME (ml) | 0 | same - 30ml, 45ml, 20ml are all integers |
| EACH | 2 | **required** - `Lime 0.25` and `Mint 0.15 bunch` are fractions of a countable thing and must survive |

The EACH case is the one that is easy to get backwards. Whole-unit items look
like the case that needs no decimals, but they are the only case that still
has fractional recipe quantities after the migration.

**Deliberately not changing:** the base-plus-size `OR` in the order path that
*adds* rather than overrides. It diverges from SambaPOS, which resolves one
recipe per (Product, Portion). Changing it would silently alter what every
existing multi-size recipe deducts. Separate decision, separate branch.

### 5. UI

**Ingredient form** (`/inventory`, staff reachable) restructured around measure
type. Segmented Weight / Volume / Each control; base unit derived, not typed;
purchase unit and multiplier asked once. A live plain-language echo under the
form:

> You buy **Hongthong** by the **bottle** (700 ml). Stock is counted in **ml**.
> 450 THB/bottle = **0.64 THB per ml**. Par: 4,200-16,800 ml (6-24 bottles).

That echo is the guardrail. Typing `7` instead of `700` reads back as
"64.29 THB per ml" and looks wrong before anyone saves. Par levels are entered
in purchase units, because that is what a human thinks in, and stored in base.

Once stock has moved, measure type and multiplier lock. Changing a multiplier
after the fact silently rewrites history, because every past deduction used the
old number. A manager can override with a warning.

"Stock has moved" is defined precisely as: **at least one `StockTransaction`
row references this ingredient.** Not "stock is non-zero" - an ingredient
received and then fully consumed is back at zero and must still be locked.
This definition is only available because sales start writing ledger rows in
step 1, which is another reason that step comes first.

**Recipe builder** (`/menu/recipes`, manager only) keeps its master-detail
shape, which is good. Three changes:

- quantity input with a unit toggle - type `30 ml` or `0.043 bottle`, stores base
- per-row cost, and a footer showing cost / price / margin % live
- the exchangeable badge now says *why not*: "Ice is measured by weight - only
  Each items can be exchanged"

The footer is the point of the screen. Today a recipe that loses money looks
identical to one that does not. It is also where a bad multiplier finally shows
itself: gin at 7ml per bottle renders as `Cost 2,893 THB, margin -1,507%`.

**Inline ingredient creation.** The ingredient picker gets a
"+ New ingredient" button that opens the same ingredient form as a dialog and
drops the result straight into the recipe. This is the fix for the three-screen
problem - one button inside a dialog that is already open, not a new wizard.

**No-recipe flag.** A menu item with no recipe gets an amber chip in the menu
list and sorts to the top of the recipe screen. Flagged, not blocked: a corkage
fee or service charge legitimately has no recipe.

**Variance report.** `StockCount` has been faithfully storing theoretical,
actual and difference, and nothing anywhere reads it. A small report closes
that loop.

### 6. Permissions

Split by task, matching how the app already gates discounts, comps and
pay-later behind a manager.

| | Staff | Manager |
| --- | --- | --- |
| Create ingredient, set measure type and multiplier | yes | yes |
| Receive / withdraw / count stock | yes | yes |
| Create menu item, set price | no | yes |
| Link recipe | no | yes |
| Change a locked multiplier | no | yes, with a warning |

`/menu` and `/menu/recipes` stay manager-only in middleware. `/inventory` is
already staff-reachable and stays so.

**Open question, deliberately left open:** whether staff should set the
multiplier at all. They are the ones holding the delivery note, which argues
yes. It is also the single field that can silently corrupt every future number.
The echo line is the mitigation; the alternative is that staff create the
ingredient and a manager confirms the conversion before it goes live. Decide
before building the form.

## The user flow this produces

### A spirit the bar has never carried

1. **Add the ingredient** (staff or manager, `/inventory`). Name, category,
   measure type, purchase unit and multiplier, cost, par levels. The echo line
   reads the conversion back in plain language.
2. **Receive the delivery** (staff, Deposit). Quantity entered in **bottles**;
   the system multiplies. Every stock figure thereafter displays as
   `8,400 ml (12 bottles)`.
3. **Create the menu item** (manager, `/menu`). Unchanged screen. The item is
   now sellable but deducts nothing, so it carries an amber `No recipe` chip.
4. **Link the recipe** (manager, `/menu/recipes`). Rows in base units, live
   cost per row, cost / price / margin in the footer.
5. **Prove it** - sell one on a test table, check the ingredient moved, void it,
   check it came back.

### A new cocktail from stock already held

Steps 3, 4, 5 only. If an ingredient turns out to be missing mid-recipe, the
picker's "+ New ingredient" opens step 1 in a dialog without leaving the screen.

### A new set or bucket

As above, watching the exchangeable badge on each row, and the existing
contents-value line that compares set price against what the parts sell for
singly.

## Testing

The 60 assertions already written against the running app cover order
deduction, package exchange in both directions, and unopened restock - which is
every path that calls `decrementStock`. They run before and after the migration
and the resulting stock numbers are diffed.

Added:

- unit tests for the `unit -> (measureType, baseUnit, multiplier)` conversion table
- a migration dry-run that reports every row it cannot convert
- unit tests for `lib/pour-cost.ts` (lifted with the logic from the existing script)
- a test that a sale writes exactly one ledger row per ingredient, and a void writes its reverse

## Order of work

1. `SALE` / `SALE_VOID` / `EXCHANGE` ledger rows - first, so everything after is auditable
2. Schema plus migration to base units
3. Stock paths and the `componentIndex` rule
4. Ingredient form and recipe builder with live cost and margin
5. Inline ingredient creation, no-recipe flag, variance report

Roughly a week.

## Out of scope

- **Yield and waste factors.** Raw input versus finished output matters for a
  kitchen braising beef. This bar pours bottles.
- **Semi-products / prep recipes.** Sugar syrup is bought, not made.
- **Velocity-driven par levels.** Worth doing once the ledger has enough sales
  history to derive them from - which this work is what makes possible.
- **Changing base-plus-size from additive to override.** Real question, wrong
  branch.
- **Warehouses as a table.** Two hardcoded stores is right for one bar.
