# AAA Bar POS — Adaptation Plan

Base: `pos-system-for-cafes` (Next.js 16 + Prisma/SQLite, single-server, LAN + Cloudflare tunnel).
Target: SambaPOS-style bar/VIP club POS per `AAA-store-requriment.md` (26 rows).

---

## 1. What already exists (and is reusable)

| Area | State | Verdict |
|---|---|---|
| Menu / Category / Variation / Size | Full CRUD, images, Lao names | **Reuse as-is** — covers req #4 modifiers except prep notes |
| Recipe → Ingredient deduction | Wired into order transaction (`app/api/orders/route.ts:315-394`), deducts on sale, **increments back on cancel** | **Reuse** — covers req #21, incl. the reverse path needed for #14 |
| Inventory (main/sub stock, transactions, stock counts, categories) | Full CRUD + deposit/withdraw/shop-adjust/stock-count APIs | **Reuse** — strong base for #14, #22 |
| BCEL OnePay | Auth+token cache, dynamic EMVco QR, webhook, status polling (`lib/onepay.ts`, `app/api/webhooks/onepay`) | **Reuse** — req #20 essentially done; only needs to point at a session bill instead of one order |
| Shifts | Open/close, start/end cash, variance, orders linked to shift | **Reuse** — base for #25 |
| Users + PIN login + roles (ADMIN/MANAGER/STAFF) | Working | **Reuse**, extend with WAITER |
| Promotions engine | Server-priced, shared client/server (`lib/promotions.ts`), has unit test | Reuse; not required by the bar spec but harmless |
| Reports/analytics + CSV export | `api/reports/analytics` (621 lines) drives dashboard + reports page | **Extend**, don't rewrite |
| Cancel-with-reason | Order-level `cancellationReason` + stock reversal | **Partial** basis for #5/#24 (needs item-level) |
| Complimentary flag | `isComplimentary` → sets `isReportable: false` | **Wrong semantics** for #16 — see gaps |
| Deployment (standalone build, tunnel, `build-deploy.ps1`) | Working | **Reuse** — covers #26 architecture |

## 2. What does not exist

| # | Requirement | Reality |
|---|---|---|
| 1 | Floor plan / table map | `app/tables/page.tsx` is **12 hardcoded fake tables, zero backend**. No `Table` model. `tableNumber` in POS is a text box saved only to `localStorage` — never persisted. |
| 2 | Split / merge / transfer | None. Cart → one Order → checkout. No concept of an open bill. |
| 3 | Bill open/close timestamps | None (order `createdAt` only). |
| 5 | Item-level void audit | Only whole-order cancel. |
| 6 | Waiter per order line-set | None. Orders link to logged-in `userId` only. |
| 7 | Multi-payment per bill | `Order.paymentMethod` is a single string. No `Payment` table. |
| 12–14 | Package exchange engine + audit + restock | None. |
| 15 | Per-table discount (% round-up / fixed) | Order-level promo discount only, no manual per-bill discount. |
| 16 | Owner VIP comped | Closest is `isComplimentary`, but it **hides the order from reports** instead of booking it to a comped account. |
| 17–18 | THB main + LAK/USD display + rate locking | `lib/currency.ts` is **hardcoded LAK-only**. No rate table, no per-transaction rate snapshot. |
| 19 | Pay-later / house tab | None. |
| 22 | Inventory audit sheet print | Data exists, no print view. |
| 23 | Waiter performance report | Blocked on #6. |
| 24 | Void audit report | Blocked on #5. |

**Also found:** `app/api/reports/route.ts` queries `prisma.product`, a model that does not exist in the schema → dead/broken route (the UI uses `analytics` instead). Delete it.

---

## 3. The spine: one schema change unlocks 15 of the 26 rows

The cafe model is `Cart → Order → Pay → Done`. The bar model is a **persistent table session** that accumulates many orders from many waiters and is settled once, possibly by several payments.

```prisma
model Table {                          // req #1
  id, name, area (INDOOR|OUTDOOR|VIP), seats, posX, posY, isActive
  sessions TableSession[]
}

model TableSession {                   // req #1,2,3,15,16,19
  id, tableId, status (OPEN|BILL_REQUESTED|CLOSED)
  openedAt, closedAt                   // req #3 — printed on bill
  discountType, discountValue          // req #15
  isOwnerVip Boolean                   // req #16
  fxRateLAK, fxRateUSD Float           // req #18 — SNAPSHOT at close, never re-read
  orders Order[]  payments Payment[]  exchanges ItemExchange[]
}

model Payment {                        // req #7,9,19,20,25
  id, sessionId, method (CASH|ONEPAY|PAY_LATER|OWNER_VIP)
  amount, currency, fxRate, bankReference, paidAt, userId
}

model VoidLog {                        // req #5,24
  id, sessionId, orderItemId, name, qty, reason, userId, createdAt
}

model ItemExchange {                   // req #12,13
  id, sessionId, fromItems Json, toItems Json
  fromValue, toValue, priceDifference, userId, createdAt
}

// Order gains: sessionId?, waiterId?   // req #6
// User gains:  role "WAITER"
```

Rules that fall out of this:
- **Bill total** = sum of session orders − discount − exchange credits; **balance** = total − sum(payments). Partial payment is just "balance > 0". (#9, #19)
- **Rate integrity** (#18) is free: closed sessions carry their own `fxRate`; settings changes only affect new sessions. Never join to the live rate.
- **Owner VIP** (#16) is a `Payment{method: OWNER_VIP, amount: full}` — stock already deducted by the normal order path, bill nets to 0, and it stays visible in the Z-report as its own line instead of vanishing.

## 4. Phases

Each phase ends shippable and testable on the real device.

**P0 — Currency foundation** (#17, #18)
`lib/currency.ts` → THB primary, `formatTHB` / `formatLAK` / `formatUSD`, settings-driven rates (`rate_lak`, `rate_usd`, `show_usd`), snapshot helper. Touches every price display; do it first or pay twice.
Check: closing a bill, then changing the rate in settings, leaves the closed bill's LAK figure unchanged.

**P1 — Tables + sessions** (#1, #3, #6, #26)
Schema above (Table, TableSession, Order.sessionId/waiterId). Real floor plan replacing the mock page: areas as tabs, live status colours, poll every ~5s (`setInterval`, same pattern as `app/orders/page.tsx`) so 3 devices stay in sync. POS opens *into* a session; waiter picked from a list per order — **not** a login (#6).
Check: two browsers on one table both see the other's order within one poll.

**P2 — Bill & payments** (#7, #9, #15, #16, #19, #20, #25)
Session bill view: line items grouped by waiter, per-table discount (% rounds up, or fixed), multi-payment panel (Cash / OnePay QR / Pay-Later / Owner VIP) with running balance. Repoint the existing OnePay generate+webhook at `sessionId` and the remaining balance. Z-report split by payment method.
Check: 500,000 cash + OnePay remainder closes one bill and reconciles in the Z-report.

**P3 — Void & waiter audit** (#5, #23, #24)
Item-level void with mandatory reason dropdown → `VoidLog` + stock reversal (reuse the existing increment path). Two manager reports: voids, and per-waiter/per-shift performance.
Check: voiding a line restores exactly the recipe quantity it deducted.

**P4 — Package exchange & restock** (#12, #13, #14, #22)
Exchange dialog on the table view: pick source items from the session cart, pick targets, price-diff logic (`src >= target` → 0 charge; else charge difference as a session line). Restock dialog constrained to items on that session. Print stylesheet for the inventory audit sheet.
Check: an exchange logs both directions and the stock delta is symmetric.

**P5 — Split / merge / transfer** (#2)
Deliberately last: it is the fiddliest and every other feature must already be session-aware. Split-by-item creates a child session; merge reparents orders; transfer moves orders between sessions/tables.
Check: split then merge returns to the original total.

## 5. Decisions I need from you

1. **Prices in THB or LAK in the DB?** The spec says THB is the main currency, but the whole existing menu is priced in LAK. Storing THB and converting for display is cleaner for #18; re-pricing the menu is manual work. I'd store **THB** and re-seed the menu.
2. **3 devices** — is the plan still one main PC serving two tablets over LAN/WiFi? SQLite handles that fine through one Node server; a "dedicated server" only matters if you want the tills to survive the main PC being off. I'd stay with the current setup.
3. **Waiters** — separate `Waiter` list (name only, no login) or `User` rows with role `WAITER`? I'd use `User` + role, so shift/report joins already work.
4. **Pay-Later** — settled against a named customer (the `Customer` model already exists) or an anonymous house tab per table?

---
*Skipped: rewriting reports from scratch (extend `analytics`), and any table-reservation feature — not in the requirement.*
