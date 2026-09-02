# Table View & Table Sessions — Design

Date: 2026-09-02
Status: Approved, ready for implementation planning
Covers: `AAA-store-requriment.md` rows #1 (partial), #3, #6, #7, #26
Phase: P1 of [AAA-BAR-PLAN.md](../../../AAA-BAR-PLAN.md)

## Problem

The system is a counter POS: `Cart → Order → Pay → Done`. A bar needs a bill that
stays open on a table, collects rounds from several waiters over hours, and is
settled once at the end.

Today `app/tables/page.tsx` is twelve hardcoded fake tables with no backend, not
in the sidebar, and the POS `tableNumber` field is a text box written only to
`localStorage` — never persisted to any order. Table management is 0% built.

## Goal

Make the floor plan the working centre of the app: open a table, order into it
from any of three devices, see it live, and close it out. Usable on a real shift
at the end of this phase.

## Non-goals (explicitly deferred)

| Deferred | Owner |
|---|---|
| Multi-payment per bill, per-table discount, Owner VIP, pay-later | P2 |
| Item-level void audit, waiter performance report | P3 |
| Package exchange, unconsumed restock, audit sheet | P4 |
| Split / merge / transfer | P5 |
| THB-primary currency and FX rate locking | P0, done separately |
| Spatial drag-and-drop floor editor, table reservations | Not planned |

Closing a bill in this phase reuses the existing single-method checkout (one of
cash or OnePay). Split tender arrives in P2.

## Decisions taken

1. **Floor plan is the home screen, walk-in counter sale is kept.** After PIN
   login staff land on the floor plan. A "Walk-in sale" button still opens the
   current table-less flow that checks out immediately.
2. **Area-grouped card grid, not a spatial map.** Tables render as cards under
   INDOOR / OUTDOOR / VIP tabs ordered by `displayOrder`. No `posX`/`posY`
   columns — a spatial view, if ever wanted, is a new migration then.
3. **The session screen is the existing POS with a banner**, not a new screen.
   All menu, search, variation and modifier behaviour is reused as-is.
4. **Waiter is picked per order, never a login** (requirement #6). One table can
   carry orders from several waiters.
5. **Currency stays LAK for now.** THB conversion is a single-file change in
   `lib/currency.ts` during P0; nothing in this phase should hardcode a symbol
   outside that module.

## Data model

Additive. The only change to an existing table is two nullable columns on
`Order`, so every current flow keeps working with both null.

```prisma
model Table {
  id           String         @id @default(uuid())
  name         String                          // "T1", "VIP 3"
  area         String                          // "INDOOR" | "OUTDOOR" | "VIP"
  seats        Int            @default(4)
  displayOrder Int            @default(0)
  isActive     Boolean        @default(true)
  createdAt    DateTime       @default(now())
  updatedAt    DateTime       @updatedAt
  sessions     TableSession[]
}

model TableSession {
  id         String    @id @default(uuid())
  tableId    String
  status     String    @default("OPEN")        // OPEN | BILL_REQUESTED | CLOSED
  openedAt   DateTime  @default(now())         // req #3, printed on the bill
  closedAt   DateTime?                         // req #3, printed on the bill
  openedById String?
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt
  table      Table     @relation(fields: [tableId], references: [id])
  openedBy   User?     @relation("SessionOpenedBy", fields: [openedById], references: [id])
  orders     Order[]

  @@index([tableId, status])
  @@index([status])
}

// Order gains:
//   sessionId String?   session TableSession? @relation(fields: [sessionId], references: [id])
//   waiterId  String?   waiter  User?         @relation("OrderWaiter", fields: [waiterId], references: [id])
//   @@index([sessionId])
//
// User gains the back-relations for the two named relations above.
// User.role accepts a new value "WAITER" (role is a free-text String today).
```

`area` is free text seeded with the three values so a fourth room needs no
migration.

### One open session per table

Prisma cannot express a partial unique index (`UNIQUE(tableId) WHERE status =
'OPEN'`). The invariant is enforced in application code instead: the create
endpoint runs `findFirst({ where: { tableId, status: { not: 'CLOSED' } } })`
and the insert inside a single `prisma.$transaction`, returning the existing
session if one is found. Two devices tapping T7 at the same moment both land on
the same session rather than creating a duplicate.

## Order status semantics

Orders belonging to an open session carry a new status, `SENT`. Existing
statuses (`COMPLETED`, `CANCELLED`, `HOLD`, `PENDING`) are untouched.

Two deliberate consequences, each requiring one change:

**Stock deducts on `SENT`.** Today deduction is gated on `status === 'COMPLETED'`
(`app/api/orders/route.ts:306-310`). A poured drink leaves the shelf when it is
served, not when the bill is paid, so the condition widens to
`COMPLETED || SENT`. The existing cancellation path already reverses a deduction
and needs no change.

**Revenue is not booked until the session closes.** `app/api/reports/analytics/route.ts`
filters `status: 'COMPLETED'` in every query and stays that way. An open bill is
therefore correctly absent from sales, the dashboard, and the Z-report until
settled. This is why the floor plan's running total is computed from the
session's own orders rather than from any sales query.

On close, every `SENT` order in the session is flipped to `COMPLETED` and linked
to the open shift, in the same transaction that stamps `closedAt`.

## API

| Route | Method | Purpose |
|---|---|---|
| `/api/tables` | GET, POST | List (with each table's open session summary), create |
| `/api/tables/[id]` | PUT, DELETE | Edit, soft-delete via `isActive` |
| `/api/table-sessions` | GET | Open sessions with totals — polled by the floor plan |
| `/api/table-sessions` | POST | Open or return the existing session for a table |
| `/api/table-sessions/[id]` | GET | One session with its orders, items and waiters |
| `/api/table-sessions/[id]/status` | PUT | `OPEN ⇄ BILL_REQUESTED` |
| `/api/table-sessions/[id]/close` | POST | Settle: stamp `closedAt`, flip orders to `COMPLETED`, attach payment + shift |

`POST /api/orders` accepts two new optional fields, `sessionId` and `waiterId`.
When `sessionId` is present the order is created with status `SENT` and no
payment fields; everything else about the endpoint is unchanged.

The floor plan's GET returns, per table: status, `openedAt`, order count, and
running total, computed server-side in one query. Clients never sum orders
themselves.

## Screens

**`/tables` — rebuilt, becomes the landing page.**
Area tabs, responsive card grid. Each card: table name, seats, status colour
(free / occupied / bill requested), open duration ticking client-side from
`openedAt`, running total, waiter count. Free card → opens a session and routes
to the POS. Occupied card → routes straight to the POS bound to that session.
A `Walk-in sale` button routes to plain `/pos`. Polls every 5 seconds using the
same `setInterval` pattern as `app/orders/page.tsx`.

**`/pos?session=<id>` — existing screen plus a banner.**
Banner shows table name, area, open duration, running total, a waiter `<Select>`
and a `Bill` button. The checkout button becomes `Send`, which posts the cart as
a `SENT` order and clears it. Without the `session` query param the screen
behaves exactly as it does today.

The waiter selection persists per device in `localStorage` so a waiter is not
re-picking it every round, but it is stored on each `Order` row — the device
default is a convenience, the order is the record.

**`/tables/[sessionId]/bill` — new.**
Line items grouped by waiter and round, `openedAt` and `closedAt` timestamps
(requirement #3), total, and a settle action that opens the existing checkout
dialog. On success the session closes and the app returns to the floor plan.

**Sidebar** gains a Tables entry; the non-admin post-login redirect changes from `/pos` to
`/tables`.

All new UI strings are added to both `en` and `lo` in `lib/translations.ts`.
Keys `free`, `occupied`, `reserved`, `total_tables` already exist and are reused.

## Table administration

A plain list under settings: name, area, seats, display order, active toggle.
No drag editor. Seeded with the bar's real tables in `prisma/seedRealData.js`, the script `npm run db:seed` actually runs.

## Concurrency across three devices

Three devices share one Node server and one SQLite file, so all writes serialise
on the server. Orders only ever append to a session — no read-modify-write on a
shared total — so two staff keying the same table produce two order rows rather
than a lost update. That is the honest behaviour for requirement #5: the
duplicate is visible on the bill and a manager voids it (P3), rather than the
system silently discarding a real round.

The 5-second poll means a card may be up to 5 seconds stale. Acceptable here;
the session creation transaction, not the poll, is what prevents double-opening
a table.

## Error handling

| Case | Behaviour |
|---|---|
| Open a table that already has an open session | Return the existing session, route to it. Not an error. |
| Send an order with no waiter selected | Blocked client-side, and the API rejects `sessionId` without `waiterId`. |
| Close a session with zero orders | Allowed; closes with total 0 and creates no order. Covers a table opened by mistake. |
| Close a session with a `HOLD` order in it | Blocked with a message naming the order. |
| Deactivate a table with an open session | Blocked. |
| Network drop mid-send | Existing POS retry/offline handling applies unchanged; the order either exists with a `SENT` status or does not. |

## Testing

`lib/sessions.test.ts`, alongside the existing `lib/promotions.test.ts`, covering
the pure logic: running-total computation across multiple orders and waiters,
duration formatting, and the close-transition rules (which statuses may close,
what a zero-order session totals).

Manual verification on the real hardware before this phase is called done:

1. Open T7 on device A; card turns occupied on device B within one poll.
2. Send a round from A and another from B under a different waiter; both appear
   on the bill, grouped by waiter.
3. Check an ingredient's stock before and after sending — deducted once, at send.
4. Confirm the open bill does not appear in the dashboard or Z-report.
5. Settle the bill; confirm it now appears in the Z-report, `closedAt` prints on
   the receipt, and the table returns to free.
6. Cancel a sent round; confirm stock returns to its pre-send value.

## Files touched

- `prisma/schema.prisma` — two new models, two columns on `Order`, back-relations on `User`
- `prisma/migrations/` — one migration
- `prisma/seedRealData.js` — seed tables and waiter users (this is the script `npm run db:seed` runs)
- `app/tables/page.tsx` — rewritten
- `app/tables/[sessionId]/bill/page.tsx` — new
- `app/api/tables/`, `app/api/table-sessions/` — new
- `app/api/orders/route.ts` — accept `sessionId`/`waiterId`, widen the stock-deduction condition to `SENT`
- `app/pos/page.tsx` — session banner, waiter select, `Send` path
- `components/sidebar.tsx` — Tables nav entry
- `app/pin-login/page.tsx:98-100` — the non-admin redirect changes from `/pos` to `/tables`; admins still land on `/dashboard`
- `lib/sessions.ts` + `lib/sessions.test.ts` — new
- `lib/translations.ts` — new keys in `en` and `lo`
- `app/api/reports/route.ts` — delete; it queries `prisma.product`, a model that does not exist

## Open risk

`app/pos/page.tsx` is 2,148 lines before this change. Adding the session banner
and send path grows it further. The session-specific logic goes in `lib/sessions.ts`
and a `components/session-banner.tsx` so the page file gains wiring, not
behaviour. If the page proves too tangled to modify safely, splitting the cart
panel out is in scope for this phase — but only if it blocks the work.
