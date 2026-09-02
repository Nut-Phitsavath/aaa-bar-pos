# Table View & Table Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the mock floor plan into the working centre of the POS — open a table, order into it from any of three devices with a named waiter, and settle it — so a real bar shift can be run on it.

**Architecture:** Two additive Prisma models (`Table`, `TableSession`) plus two nullable columns on `Order`. Orders belonging to an open bill carry a new status `SENT`: stock deducts at send, revenue books only when the session closes. The floor plan polls one endpoint every 5s; ordering reuses the existing POS screen bound to a session by query param.

**Tech Stack:** Next.js 16 App Router, React 19, Prisma 5.22 + SQLite (WAL), Tailwind v4, Radix/shadcn UI, `node:test` with `--experimental-strip-types`.

**Spec:** [docs/superpowers/specs/2026-09-02-table-view-sessions-design.md](../specs/2026-09-02-table-view-sessions-design.md)

**Branch:** `feat/table-sessions`

## Global Constraints

- **No new dependencies.** Everything needed is already installed.
- **Next.js 16 route handlers:** dynamic params are a Promise — `{ params }: { params: Promise<{ id: string }> }`, then `const { id } = await params`. Copy the shape in `app/api/orders/[id]/hold/route.ts`.
- **Prisma relation gotcha:** never put a scalar foreign key (`shiftId`, `sessionId`) in the same `data` payload as a relation `connect`. Prisma rejects it and 500s the request. Use nested `connect` for all of them. This is documented at `app/api/orders/route.ts:229-234` and has bitten this codebase before.
- **Money is integer LAK.** Use `formatLAK()` from `lib/currency.ts` for every amount displayed. Never hardcode a currency symbol outside that module — P0 swaps it to THB later.
- **Every user-facing string** gets a key in BOTH `en` and `lo` in `lib/translations.ts`. Never inline English in JSX.
- **Dates:** use `formatLongDate()` from `lib/date.ts` for dates. Chrome ships no Lao locale data, so `toLocaleDateString('lo-LA')` silently renders English and causes hydration error #418. Times (`HH:mm`) are safe with `toLocaleTimeString('en-GB')`.
- **Visual language is the app's existing one** — white `Card` surfaces, `slate-800` headings, `slate-500` secondary text, `amber-600` primary actions, `border-2` status tinting, `rounded-lg`. Match `app/pos/page.tsx` and `app/orders/page.tsx`. Do not introduce a new palette.
- **Statuses are free-text strings**, not enums (SQLite). Session: `OPEN` | `BILL_REQUESTED` | `CLOSED`. Order gains `SENT` alongside existing `COMPLETED` | `CANCELLED` | `HOLD` | `PENDING`.
- **Run `npx prisma generate` after any schema edit** or the TypeScript client won't know the new models.

**Deliberate deviation from the spec:** the spec listed both `GET /api/tables` and `GET /api/table-sessions` returning floor-plan data. This plan collapses them into a single `GET /api/tables` that includes each table's open-session summary — one endpoint, one poll, no duplicated aggregation. `POST /api/table-sessions` and the per-session routes remain as specced.

---

### Task 1: Session logic module

Pure functions with no database access, so they are testable in isolation and every later task can import them. This task also adds the `test` script the repo currently lacks.

**Files:**
- Create: `lib/sessions.ts`
- Create: `lib/sessions.test.ts`
- Modify: `package.json` (scripts block, lines 5-13)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `SESSION_OPEN_STATUSES: readonly string[]` — `['OPEN', 'BILL_REQUESTED']`
  - `BILLABLE_ORDER_STATUSES: readonly string[]` — `['SENT', 'COMPLETED']`
  - `sessionTotal(orders: SessionOrderLike[]): number`
  - `formatDuration(openedAt: Date | string, now: Date): string`
  - `canCloseSession(session: {status: string}, orders: SessionOrderLike[]): CloseCheck`
  - `type SessionOrderLike = { status: string; total: number }`
  - `type CloseCheck = { ok: true } | { ok: false; reason: string }`

- [ ] **Step 1: Write the failing test**

Create `lib/sessions.test.ts`:

```typescript
// Run: node --experimental-strip-types --test lib/sessions.test.ts
//
// Bill math and lifecycle rules for open table sessions. These cover the cases
// where the floor plan would show one number and the printed bill another.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sessionTotal, formatDuration, canCloseSession } from './sessions.ts'

test('sessionTotal sums sent and completed orders', () => {
    const orders = [
        { status: 'SENT', total: 120000 },
        { status: 'SENT', total: 80000 },
    ]
    assert.equal(sessionTotal(orders), 200000)
})

test('sessionTotal ignores cancelled orders', () => {
    const orders = [
        { status: 'SENT', total: 120000 },
        { status: 'CANCELLED', total: 500000 },
    ]
    assert.equal(sessionTotal(orders), 120000)
})

test('sessionTotal ignores held orders', () => {
    // A HOLD order is the beeper flow, not part of a table bill.
    const orders = [
        { status: 'SENT', total: 120000 },
        { status: 'HOLD', total: 90000 },
    ]
    assert.equal(sessionTotal(orders), 120000)
})

test('sessionTotal of an empty session is zero', () => {
    assert.equal(sessionTotal([]), 0)
})

test('formatDuration renders hours and padded minutes', () => {
    const opened = new Date('2026-09-02T21:14:00Z')
    const now = new Date('2026-09-02T23:19:00Z')
    assert.equal(formatDuration(opened, now), '2:05')
})

test('formatDuration renders under an hour as 0:mm', () => {
    const opened = new Date('2026-09-02T21:14:00Z')
    const now = new Date('2026-09-02T21:48:00Z')
    assert.equal(formatDuration(opened, now), '0:34')
})

test('formatDuration accepts an ISO string, as the API returns', () => {
    assert.equal(formatDuration('2026-09-02T21:14:00.000Z', new Date('2026-09-02T21:48:00Z')), '0:34')
})

test('formatDuration clamps a backwards clock to zero', () => {
    // Three devices, three system clocks. A tablet running a minute fast must
    // not render "-0:01" on every card.
    const opened = new Date('2026-09-02T21:14:00Z')
    const now = new Date('2026-09-02T21:13:00Z')
    assert.equal(formatDuration(opened, now), '0:00')
})

test('canCloseSession allows an open session with orders', () => {
    const check = canCloseSession({ status: 'OPEN' }, [{ status: 'SENT', total: 120000 }])
    assert.deepEqual(check, { ok: true })
})

test('canCloseSession allows an empty session', () => {
    // A table opened by mistake must be closeable, not stuck occupied all night.
    const check = canCloseSession({ status: 'OPEN' }, [])
    assert.deepEqual(check, { ok: true })
})

test('canCloseSession allows closing from BILL_REQUESTED', () => {
    const check = canCloseSession({ status: 'BILL_REQUESTED' }, [{ status: 'SENT', total: 1000 }])
    assert.deepEqual(check, { ok: true })
})

test('canCloseSession refuses an already closed session', () => {
    const check = canCloseSession({ status: 'CLOSED' }, [])
    assert.equal(check.ok, false)
})

test('canCloseSession refuses a session holding a HOLD order', () => {
    const check = canCloseSession({ status: 'OPEN' }, [
        { status: 'SENT', total: 1000 },
        { status: 'HOLD', total: 2000 },
    ])
    assert.equal(check.ok, false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test lib/sessions.test.ts`
Expected: FAIL — `Cannot find module './sessions.ts'`

- [ ] **Step 3: Write the implementation**

Create `lib/sessions.ts`:

```typescript
/**
 * Open table sessions: bill math and lifecycle rules.
 *
 * Pure functions only — no Prisma import. The floor plan, the POS banner, the
 * bill screen and the close endpoint all price a session through here, so the
 * card, the screen and the printed bill cannot disagree.
 */

/** A session is "open" until it is settled. BILL_REQUESTED still occupies the table. */
export const SESSION_OPEN_STATUSES = ['OPEN', 'BILL_REQUESTED'] as const

/** Order statuses that count towards a table's bill. */
export const BILLABLE_ORDER_STATUSES = ['SENT', 'COMPLETED'] as const

export type SessionOrderLike = { status: string; total: number }
export type CloseCheck = { ok: true } | { ok: false; reason: string }

export function sessionTotal(orders: SessionOrderLike[]): number {
    return orders
        .filter((o) => (BILLABLE_ORDER_STATUSES as readonly string[]).includes(o.status))
        .reduce((sum, o) => sum + (o.total || 0), 0)
}

/**
 * "2:05" — hours and padded minutes since the table opened.
 *
 * `now` is passed in rather than read here so the caller controls the ticking
 * interval and the function stays testable.
 */
export function formatDuration(openedAt: Date | string, now: Date): string {
    const opened = typeof openedAt === 'string' ? new Date(openedAt) : openedAt
    const minutes = Math.max(0, Math.floor((now.getTime() - opened.getTime()) / 60000))
    const hours = Math.floor(minutes / 60)
    return `${hours}:${String(minutes % 60).padStart(2, '0')}`
}

export function canCloseSession(session: { status: string }, orders: SessionOrderLike[]): CloseCheck {
    if (session.status === 'CLOSED') {
        return { ok: false, reason: 'SESSION_ALREADY_CLOSED' }
    }
    if (orders.some((o) => o.status === 'HOLD')) {
        return { ok: false, reason: 'SESSION_HAS_HELD_ORDER' }
    }
    return { ok: true }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test lib/sessions.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Add the test script**

In `package.json`, add to the `scripts` block so both test files run together:

```json
    "test": "node --experimental-strip-types --test lib/*.test.ts",
```

- [ ] **Step 6: Verify both suites run**

Run: `npm test`
Expected: PASS — the new session tests plus the existing `lib/promotions.test.ts` suite.

- [ ] **Step 7: Commit**

```bash
git add lib/sessions.ts lib/sessions.test.ts package.json
git commit -m "feat: add table session bill math and lifecycle rules"
```

---

### Task 2: Schema, migration and seed data

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_table_sessions/migration.sql` (generated)
- Modify: `prisma/seedRealData.js`

**Interfaces:**
- Consumes: nothing.
- Produces: Prisma models `Table` and `TableSession`; `Order.sessionId`, `Order.waiterId`; `User` back-relations `sessionsOpened`, `waitedOrders`.

- [ ] **Step 1: Add the two models**

Append to `prisma/schema.prisma`:

```prisma
model Table {
  id           String         @id @default(uuid())
  name         String
  area         String         @default("INDOOR")
  seats        Int            @default(4)
  displayOrder Int            @default(0)
  isActive     Boolean        @default(true)
  createdAt    DateTime       @default(now())
  updatedAt    DateTime       @updatedAt
  sessions     TableSession[]

  @@index([area, displayOrder])
}

model TableSession {
  id         String    @id @default(uuid())
  tableId    String
  status     String    @default("OPEN")
  openedAt   DateTime  @default(now())
  closedAt   DateTime?
  openedById String?
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt
  table      Table     @relation(fields: [tableId], references: [id])
  openedBy   User?     @relation("SessionOpenedBy", fields: [openedById], references: [id])
  orders     Order[]

  @@index([tableId, status])
  @@index([status])
}
```

- [ ] **Step 2: Add the two columns and relations to Order**

In `model Order`, add these fields alongside the existing ones:

```prisma
  sessionId          String?
  waiterId           String?
  session            TableSession? @relation(fields: [sessionId], references: [id])
  waiter             User?         @relation("OrderWaiter", fields: [waiterId], references: [id])
```

and add to its index block:

```prisma
  @@index([sessionId])
```

- [ ] **Step 3: Add the back-relations to User**

In `model User`, add:

```prisma
  sessionsOpened    TableSession[]     @relation("SessionOpenedBy")
  waitedOrders      Order[]            @relation("OrderWaiter")
```

The existing `orders Order[]` field stays — it is the *cashier* who rang the order up, which is a different fact from the waiter who served it. Prisma requires the named relation on `waitedOrders` precisely because there are now two `Order`↔`User` relations.

- [ ] **Step 4: Generate the migration**

```bash
npx prisma migrate dev --name add_table_sessions
npx prisma generate
```

Expected: migration applies cleanly. Every added column is nullable or defaulted, so existing rows need no backfill.

- [ ] **Step 5: Seed tables and waiters**

In `prisma/seedRealData.js`, add before the script's final log. Replace the table names and waiter names with the bar's real ones when they are known:

```javascript
  // --- Tables ---
  const tableSeed = [
    { name: 'T1', area: 'INDOOR', seats: 4, displayOrder: 1 },
    { name: 'T2', area: 'INDOOR', seats: 4, displayOrder: 2 },
    { name: 'T3', area: 'INDOOR', seats: 6, displayOrder: 3 },
    { name: 'T4', area: 'INDOOR', seats: 6, displayOrder: 4 },
    { name: 'O1', area: 'OUTDOOR', seats: 4, displayOrder: 1 },
    { name: 'O2', area: 'OUTDOOR', seats: 4, displayOrder: 2 },
    { name: 'VIP 1', area: 'VIP', seats: 10, displayOrder: 1 },
    { name: 'VIP 2', area: 'VIP', seats: 10, displayOrder: 2 },
  ]
  for (const t of tableSeed) {
    const existing = await prisma.table.findFirst({ where: { name: t.name } })
    if (!existing) await prisma.table.create({ data: t })
  }
  console.log(`Seeded ${tableSeed.length} tables`)

  // --- Waiters ---
  // Role WAITER, no till access. They are picked from a list on the order
  // panel, they never log in — requirement #6.
  const waiterSeed = ['Nok', 'Mai', 'Ting']
  for (const name of waiterSeed) {
    const username = name.toLowerCase()
    const existing = await prisma.user.findUnique({ where: { username } })
    if (!existing) {
      await prisma.user.create({
        data: { name, username, role: 'WAITER', pin: '0000', isActive: true },
      })
    }
  }
  console.log(`Seeded ${waiterSeed.length} waiters`)
```

- [ ] **Step 6: Run the seed and verify**

```bash
npm run db:seed
npx prisma studio
```

Expected: 8 rows in `Table`, 3 users with role `WAITER`. Close Studio when done.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations prisma/seedRealData.js
git commit -m "feat: add Table and TableSession models with seed data"
```

---

### Task 3: Tables API

`GET` is the endpoint the floor plan polls, so it returns each table already joined to its open session summary. The client never aggregates.

**Files:**
- Create: `app/api/tables/route.ts`
- Create: `app/api/tables/[id]/route.ts`

**Interfaces:**
- Consumes: `sessionTotal`, `SESSION_OPEN_STATUSES`, `BILLABLE_ORDER_STATUSES` from `lib/sessions.ts`.
- Produces: `GET /api/tables` → `TableWithSession[]`, shaped as:

```typescript
type TableWithSession = {
  id: string
  name: string
  area: string
  seats: number
  displayOrder: number
  session: {
    id: string
    status: string          // OPEN | BILL_REQUESTED
    openedAt: string        // ISO
    orderCount: number
    waiterCount: number
    total: number
  } | null
}
```

- [ ] **Step 1: Write the list and create handlers**

Create `app/api/tables/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sessionTotal, BILLABLE_ORDER_STATUSES } from '@/lib/sessions'

// The floor plan polls this every 5s; it must never be served stale.
export const dynamic = 'force-dynamic'

export async function GET() {
    try {
        const tables = await prisma.table.findMany({
            where: { isActive: true },
            orderBy: [{ area: 'asc' }, { displayOrder: 'asc' }, { name: 'asc' }],
            include: {
                sessions: {
                    where: { status: { not: 'CLOSED' } },
                    take: 1,
                    orderBy: { openedAt: 'desc' },
                    include: {
                        orders: {
                            select: { status: true, total: true, waiterId: true },
                        },
                    },
                },
            },
        })

        const payload = tables.map((table) => {
            const session = table.sessions[0]
            const billable = session
                ? session.orders.filter((o) =>
                    (BILLABLE_ORDER_STATUSES as readonly string[]).includes(o.status))
                : []

            return {
                id: table.id,
                name: table.name,
                area: table.area,
                seats: table.seats,
                displayOrder: table.displayOrder,
                session: session
                    ? {
                        id: session.id,
                        status: session.status,
                        openedAt: session.openedAt.toISOString(),
                        orderCount: billable.length,
                        waiterCount: new Set(billable.map((o) => o.waiterId).filter(Boolean)).size,
                        total: sessionTotal(session.orders),
                    }
                    : null,
            }
        })

        return NextResponse.json(payload)
    } catch (error) {
        console.error('[tables] GET failed', error)
        return NextResponse.json({ error: 'Failed to load tables' }, { status: 500 })
    }
}

export async function POST(request: Request) {
    try {
        const { name, area, seats, displayOrder } = await request.json()

        if (!name || typeof name !== 'string' || !name.trim()) {
            return NextResponse.json({ error: 'Table name is required' }, { status: 400 })
        }

        const table = await prisma.table.create({
            data: {
                name: name.trim(),
                area: area || 'INDOOR',
                seats: Number(seats) || 4,
                displayOrder: Number(displayOrder) || 0,
            },
        })

        return NextResponse.json(table)
    } catch (error) {
        console.error('[tables] POST failed', error)
        return NextResponse.json({ error: 'Failed to create table' }, { status: 500 })
    }
}
```

- [ ] **Step 2: Write the edit and deactivate handlers**

Create `app/api/tables/[id]/route.ts`. Deactivation is a soft delete — a hard delete would orphan the historical sessions and the orders under them.

```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const { name, area, seats, displayOrder, isActive } = await request.json()

        // A table with money open on it cannot be taken off the floor.
        if (isActive === false) {
            const open = await prisma.tableSession.findFirst({
                where: { tableId: id, status: { not: 'CLOSED' } },
            })
            if (open) {
                return NextResponse.json(
                    { error: 'TABLE_HAS_OPEN_SESSION' },
                    { status: 409 }
                )
            }
        }

        const table = await prisma.table.update({
            where: { id },
            data: {
                ...(name !== undefined && { name: String(name).trim() }),
                ...(area !== undefined && { area }),
                ...(seats !== undefined && { seats: Number(seats) }),
                ...(displayOrder !== undefined && { displayOrder: Number(displayOrder) }),
                ...(isActive !== undefined && { isActive: Boolean(isActive) }),
            },
        })

        return NextResponse.json(table)
    } catch (error) {
        console.error('[tables] PUT failed', error)
        return NextResponse.json({ error: 'Failed to update table' }, { status: 500 })
    }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params

        const open = await prisma.tableSession.findFirst({
            where: { tableId: id, status: { not: 'CLOSED' } },
        })
        if (open) {
            return NextResponse.json({ error: 'TABLE_HAS_OPEN_SESSION' }, { status: 409 })
        }

        // Soft delete: history under this table must survive.
        await prisma.table.update({ where: { id }, data: { isActive: false } })
        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('[tables] DELETE failed', error)
        return NextResponse.json({ error: 'Failed to remove table' }, { status: 500 })
    }
}
```

- [ ] **Step 3: Verify by hand**

Start the dev server (`npm run dev`), then:

```bash
curl -s http://localhost:3000/api/tables | head -c 600
```

Expected: a JSON array of 8 tables, every one with `"session": null`.

- [ ] **Step 4: Commit**

```bash
git add app/api/tables
git commit -m "feat: add tables API with open-session summary"
```

---

### Task 4: Session open, read and status API

**Files:**
- Create: `app/api/table-sessions/route.ts`
- Create: `app/api/table-sessions/[id]/route.ts`
- Create: `app/api/table-sessions/[id]/status/route.ts`

**Interfaces:**
- Consumes: `sessionTotal` from `lib/sessions.ts`.
- Produces:
  - `POST /api/table-sessions` body `{ tableId: string }` → the open `TableSession` row (existing one if there is one).
  - `GET /api/table-sessions/[id]` → session with `table`, `orders` (each with `items` and `waiter`), and a computed `total`.
  - `PUT /api/table-sessions/[id]/status` body `{ status: 'OPEN' | 'BILL_REQUESTED' }` → updated session.

- [ ] **Step 1: Write the open-session handler**

Create `app/api/table-sessions/route.ts`. The find-then-create pair must sit inside one transaction, or two devices tapping the same table at the same moment open two bills on it.

```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { cookies } from 'next/headers'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
    try {
        const { tableId } = await request.json()

        if (!tableId) {
            return NextResponse.json({ error: 'tableId is required' }, { status: 400 })
        }

        const table = await prisma.table.findUnique({ where: { id: tableId } })
        if (!table || !table.isActive) {
            return NextResponse.json({ error: 'Table not found' }, { status: 404 })
        }

        // Who opened it. Same cookie shape POST /api/orders reads.
        const cookieStore = await cookies()
        const sessionCookie = cookieStore.get('pos_session')
        let openedById: string | null = null
        if (sessionCookie) {
            try {
                const sessionUser = JSON.parse(sessionCookie.value)
                const dbUser = await prisma.user.findUnique({ where: { id: sessionUser.id } })
                if (dbUser) openedById = dbUser.id
            } catch { }
        }

        // Idempotent: tapping an already-open table returns its session rather
        // than opening a second bill on the same table.
        const session = await prisma.$transaction(async (tx) => {
            const existing = await tx.tableSession.findFirst({
                where: { tableId, status: { not: 'CLOSED' } },
            })
            if (existing) return existing

            return tx.tableSession.create({
                data: { tableId, status: 'OPEN', openedById },
            })
        })

        return NextResponse.json(session)
    } catch (error) {
        console.error('[table-sessions] POST failed', error)
        return NextResponse.json({ error: 'Failed to open table' }, { status: 500 })
    }
}
```

- [ ] **Step 2: Write the session detail handler**

Create `app/api/table-sessions/[id]/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sessionTotal } from '@/lib/sessions'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params

        const session = await prisma.tableSession.findUnique({
            where: { id },
            include: {
                table: true,
                orders: {
                    orderBy: { createdAt: 'asc' },
                    include: {
                        items: true,
                        waiter: { select: { id: true, name: true } },
                    },
                },
            },
        })

        if (!session) {
            return NextResponse.json({ error: 'Session not found' }, { status: 404 })
        }

        return NextResponse.json({
            ...session,
            total: sessionTotal(session.orders),
        })
    } catch (error) {
        console.error('[table-sessions] GET failed', error)
        return NextResponse.json({ error: 'Failed to load session' }, { status: 500 })
    }
}
```

- [ ] **Step 3: Write the status handler**

Create `app/api/table-sessions/[id]/status/route.ts`. This flips a table to "bill requested" so the floor plan shows it — closing is a separate endpoint with real consequences.

```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const ALLOWED = ['OPEN', 'BILL_REQUESTED']

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const { status } = await request.json()

        if (!ALLOWED.includes(status)) {
            return NextResponse.json(
                { error: 'Status must be OPEN or BILL_REQUESTED' },
                { status: 400 }
            )
        }

        const existing = await prisma.tableSession.findUnique({ where: { id } })
        if (!existing) {
            return NextResponse.json({ error: 'Session not found' }, { status: 404 })
        }
        if (existing.status === 'CLOSED') {
            return NextResponse.json({ error: 'SESSION_ALREADY_CLOSED' }, { status: 409 })
        }

        const session = await prisma.tableSession.update({ where: { id }, data: { status } })
        return NextResponse.json(session)
    } catch (error) {
        console.error('[table-sessions] status PUT failed', error)
        return NextResponse.json({ error: 'Failed to update session status' }, { status: 500 })
    }
}
```

- [ ] **Step 4: Verify the idempotency by hand**

With the dev server running, take a table id from `GET /api/tables`, then POST twice:

```bash
curl -s -X POST http://localhost:3000/api/table-sessions \
  -H 'Content-Type: application/json' -d '{"tableId":"<TABLE_ID>"}'
curl -s -X POST http://localhost:3000/api/table-sessions \
  -H 'Content-Type: application/json' -d '{"tableId":"<TABLE_ID>"}'
```

Expected: both responses carry the **same** session `id`. Then `GET /api/tables` shows that table with a non-null `session` and `total: 0`.

- [ ] **Step 5: Commit**

```bash
git add app/api/table-sessions
git commit -m "feat: add table session open, read and status endpoints"
```

---

### Task 5: Orders belong to sessions

The single most delicate task: it changes when stock moves. Read the whole task before editing.

**Files:**
- Modify: `app/api/orders/route.ts`

**Interfaces:**
- Consumes: the `TableSession` model from Task 2.
- Produces: `POST /api/orders` accepts optional `sessionId` and `waiterId`. When `sessionId` is present the order is stored with status `SENT`, linked to the session and the waiter, and deducts stock without touching loyalty, the cash drawer, or the shift.

- [ ] **Step 1: Accept the two new fields**

In the destructure at `app/api/orders/route.ts:14-21`, add `sessionId, waiterId`:

```typescript
        const {
            id, items, total, subtotal, tax, discount,
            promoId, customerId, paymentMethod, status,
            beeperNumber, cancellationReason,
            pointsRedeemed, taxAmount, isReportable,
            cashReceived, changeAmount,
            sessionId, waiterId
        } = body
```

- [ ] **Step 2: Validate the session pairing**

Immediately after the existing items validation block (the one ending around line 50 that rejects an order with no `variationSizeId`), add:

```typescript
        // A table order without a waiter is an unattributable sale — requirement #6
        // exists precisely so the shift report can name who sold what.
        if (sessionId && !waiterId) {
            return NextResponse.json(
                { error: 'A table order must be assigned to a waiter' },
                { status: 400 }
            )
        }

        if (sessionId) {
            const session = await prisma.tableSession.findUnique({ where: { id: sessionId } })
            if (!session) {
                return NextResponse.json({ error: 'Session not found' }, { status: 404 })
            }
            if (session.status === 'CLOSED') {
                return NextResponse.json({ error: 'SESSION_ALREADY_CLOSED' }, { status: 409 })
            }
        }
```

- [ ] **Step 3: Add the relation links**

Next to the existing `shiftLink` definition (`app/api/orders/route.ts:232-234`), add two more. They must be nested `connect`, not scalar ids, for the reason documented in that same comment:

```typescript
            const sessionLink = sessionId
                ? { session: { connect: { id: sessionId } } }
                : {}

            const waiterLink = waiterId
                ? { waiter: { connect: { id: waiterId } } }
                : {}
```

Then spread them into BOTH branches of the save. In the `tx.order.create` call (around line 273) and the `tx.order.update` call (around line 290), add `...sessionLink,` and `...waiterLink,` directly after the existing `...shiftLink,` line.

- [ ] **Step 4: Widen the stock gate to SENT, keep money on COMPLETED**

Replace the three status booleans at `app/api/orders/route.ts:308-310`:

```typescript
            const wasCompleted = previousOrder?.status === 'COMPLETED'
            const isNowCompleted = status === 'COMPLETED'
            const isCancelled = status === 'CANCELLED'
```

with:

```typescript
            const wasCompleted = previousOrder?.status === 'COMPLETED'
            const isNowCompleted = status === 'COMPLETED'
            const isCancelled = status === 'CANCELLED'

            // Stock moves when the drink is served, not when the bill is paid.
            // A SENT order is sitting on an open table: the bottle has already
            // left the shelf, so it must be deducted now — but no money has
            // changed hands, so loyalty, the cash drawer and the shift link all
            // stay on COMPLETED.
            const ACTIVE_STATUSES = ['COMPLETED', 'SENT']
            const wasActive = previousOrder ? ACTIVE_STATUSES.includes(previousOrder.status) : false
            const isNowActive = ACTIVE_STATUSES.includes(status || 'COMPLETED')
```

- [ ] **Step 5: Split block A**

Change the opening of block A (line ~314) from:

```typescript
            if (isNowCompleted && !wasCompleted) {
```

to:

```typescript
            if (isNowActive && !wasActive) {
```

Then wrap only the loyalty and cash-drawer sections in an inner guard. Find section `// 2. Add Loyalty` (line ~343) and open the guard just before it:

```typescript
                // Money only moves on a real checkout. A SENT order on an open
                // table has deducted its stock above and stops here.
                if (isNowCompleted && !wasCompleted) {
```

and close that inner block after the cash-drawer section (`// 3. Update Cash Drawer`, ending line ~368) with a matching `}` before block A's own closing brace.

- [ ] **Step 6: Make cancellation reverse a SENT order too**

At block B (line ~356), change:

```typescript
            if (wasCompleted && isCancelled) {
```

to:

```typescript
            if (wasActive && isCancelled) {
```

Then, inside that block, wrap only the loyalty reversal (the `// 2. Revert Loyalty` section) in `if (wasCompleted) { ... }` — a SENT order never earned loyalty points, so reversing them would silently drain the customer's balance.

- [ ] **Step 7: Verify the whole flow by hand**

Start the dev server. Note an ingredient's `subStock` in Prisma Studio for a drink with a recipe. Then, using a `sessionId` from Task 4 and a `waiterId` from a `WAITER` user:

```bash
curl -s -X POST http://localhost:3000/api/orders \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"<SESSION_ID>","waiterId":"<WAITER_ID>","status":"SENT",
       "items":[{"variationSizeId":"<VS_ID>","name":"Test","price":20000,"quantity":1}],
       "total":20000,"subtotal":20000,"tax":0,"discount":0}'
```

Expected, all four:
1. The response order has `"status": "SENT"` and the correct `sessionId`.
2. The ingredient's `subStock` has **dropped** by the recipe quantity.
3. `GET /api/tables` shows that table's `session.total` as 20000 and `orderCount` 1.
4. `GET /api/reports/analytics?startDate=<today>&endDate=<today>` does **not** include the 20000 — an open bill is not revenue.

Then confirm the same request without `sessionId` still behaves exactly as before (a normal walk-in `COMPLETED` sale that books revenue).

- [ ] **Step 8: Confirm nothing regressed**

Run: `npm test`
Expected: PASS — the promotions suite still passes, proving the server-side pricing path is untouched.

- [ ] **Step 9: Commit**

```bash
git add app/api/orders/route.ts
git commit -m "feat: link orders to table sessions and deduct stock on SENT"
```

---

### Task 6: Close a session

**Files:**
- Create: `app/api/table-sessions/[id]/close/route.ts`

**Interfaces:**
- Consumes: `sessionTotal`, `canCloseSession` from `lib/sessions.ts`.
- Produces: `POST /api/table-sessions/[id]/close` body `{ paymentMethod: string, cashReceived?: number }` → `{ success: true, total: number, closedAt: string }`.

- [ ] **Step 1: Write the close handler**

Create `app/api/table-sessions/[id]/close/route.ts`. Stock was already deducted at send, so this endpoint must **not** touch inventory — it only converts an open bill into booked revenue.

```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sessionTotal, canCloseSession } from '@/lib/sessions'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const { paymentMethod, cashReceived } = await request.json()

        const method = paymentMethod === 'BANK_NOTE' ? 'CASH' : (paymentMethod || 'CASH')

        const session = await prisma.tableSession.findUnique({
            where: { id },
            include: { orders: { select: { id: true, status: true, total: true } } },
        })

        if (!session) {
            return NextResponse.json({ error: 'Session not found' }, { status: 404 })
        }

        const check = canCloseSession(session, session.orders)
        if (!check.ok) {
            return NextResponse.json({ error: check.reason }, { status: 409 })
        }

        const total = sessionTotal(session.orders)
        const openShift = await prisma.shift.findFirst({ where: { status: 'OPEN' } })
        const closedAt = new Date()

        await prisma.$transaction(async (tx) => {
            // Book the revenue. Stock already moved when each round was sent,
            // so nothing here touches inventory.
            await tx.order.updateMany({
                where: { sessionId: id, status: 'SENT' },
                data: {
                    status: 'COMPLETED',
                    paymentMethod: method,
                    shiftId: openShift?.id ?? null,
                    updatedAt: closedAt,
                },
            })

            await tx.tableSession.update({
                where: { id },
                data: { status: 'CLOSED', closedAt },
            })

            // One drawer movement for the whole bill, not one per round.
            if (method === 'CASH' && openShift && total > 0) {
                await tx.shift.update({
                    where: { id: openShift.id },
                    data: { cashPayments: { increment: total } },
                })
            }
        })

        return NextResponse.json({ success: true, total, closedAt: closedAt.toISOString() })
    } catch (error) {
        console.error('[table-sessions] close failed', error)
        return NextResponse.json({ error: 'Failed to close session' }, { status: 500 })
    }
}
```

`updateMany` sets `shiftId` as a plain scalar, which is correct here — the Prisma relation-conflict rule in the Global Constraints applies to `create`/`update` payloads that also carry a `connect`, and this one carries none.

- [ ] **Step 2: Verify the close by hand**

Using the session from Task 5 (which has one 20000 SENT order on it):

```bash
curl -s -X POST http://localhost:3000/api/table-sessions/<SESSION_ID>/close \
  -H 'Content-Type: application/json' -d '{"paymentMethod":"CASH","cashReceived":20000}'
```

Expected, all four:
1. Response `{ "success": true, "total": 20000, "closedAt": "..." }`.
2. `GET /api/tables` shows that table back to `"session": null`.
3. The analytics endpoint **now** includes the 20000.
4. The ingredient's `subStock` is unchanged by the close — it moved once, at send.

- [ ] **Step 3: Verify the guard**

Close the same session a second time.
Expected: HTTP 409 with `{"error":"SESSION_ALREADY_CLOSED"}`.

- [ ] **Step 4: Commit**

```bash
git add app/api/table-sessions/\[id\]/close
git commit -m "feat: close a table session and book its revenue"
```

---

### Task 7: Floor plan screen

**Before writing any JSX, invoke the `impeccable` skill** for the card and status treatment. The direction is fixed and is not up for reinvention: this screen must look like it has always been part of this app. Reference is `app/pos/page.tsx` and `app/orders/page.tsx` — white `Card` surfaces on `bg-slate-50`, `slate-800` headings, `slate-500` secondary text, `amber-600` primary action, `border-2` for status tint, `rounded-lg`. Status colours follow the legend already in the mock: green free, red occupied, blue bill-requested. Do not ship a plain version to polish later.

**Files:**
- Rewrite: `app/tables/page.tsx`
- Modify: `lib/translations.ts`

**Interfaces:**
- Consumes: `GET /api/tables` from Task 3, `POST /api/table-sessions` from Task 4, `formatDuration` and `formatLAK`.
- Produces: the route `/tables`, and navigation to `/pos?session=<id>`.

- [ ] **Step 1: Add the translation keys**

In `lib/translations.ts`, add to the `en` object. Keys `free`, `occupied`, `total_tables`, `seats` and `orders` already exist — reuse those, do not duplicate. `tables` does **not** exist yet despite the mock page's other table keys, so it is added here:

```typescript
        tables: "Tables",
        bill_requested: "Bill Requested",
        walk_in_sale: "Walk-in Sale",
        open_table: "Open Table",
        view_bill: "View Bill",
        all_areas: "All",
        area_indoor: "Indoor",
        area_outdoor: "Outdoor",
        area_vip: "VIP",
        waiters_count: "waiters",
        no_tables_yet: "No tables set up yet",
```

and the matching Lao in the `lo` object:

```typescript
        tables: "ໂຕະ",
        bill_requested: "ຂໍບິນ",
        walk_in_sale: "ຂາຍໜ້າຮ້ານ",
        open_table: "ເປີດໂຕະ",
        view_bill: "ເບິ່ງບິນ",
        all_areas: "ທັງໝົດ",
        area_indoor: "ໃນຮ້ານ",
        area_outdoor: "ນອກຮ້ານ",
        area_vip: "ຫ້ອງ VIP",
        waiters_count: "ພະນັກງານ",
        no_tables_yet: "ຍັງບໍ່ມີໂຕະ",
```

- [ ] **Step 2: Rewrite the page**

Replace the whole of `app/tables/page.tsx`:

```tsx
"use client"

import { useState, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import { useTranslation } from "@/hooks/use-translation"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Users, Clock, Receipt, ShoppingCart } from "lucide-react"
import { formatLAK } from "@/lib/currency"
import { formatDuration } from "@/lib/sessions"

type TableWithSession = {
  id: string
  name: string
  area: string
  seats: number
  displayOrder: number
  session: {
    id: string
    status: string
    openedAt: string
    orderCount: number
    waiterCount: number
    total: number
  } | null
}

const POLL_MS = 5000

export default function TablesPage() {
  const { t } = useTranslation()
  const router = useRouter()
  const [tables, setTables] = useState<TableWithSession[]>([])
  const [area, setArea] = useState("ALL")
  const [now, setNow] = useState(() => new Date())
  const [loading, setLoading] = useState(true)
  const [opening, setOpening] = useState<string | null>(null)

  // Two independent clocks: the poll pulls new totals from the server, the
  // tick re-renders the durations in between so cards don't freeze.
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch("/api/tables")
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) setTables(data)
      } catch {
        // Offline on a tablet: keep showing the last known floor.
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    const poll = setInterval(load, POLL_MS)
    return () => { cancelled = true; clearInterval(poll) }
  }, [])

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(tick)
  }, [])

  const areas = useMemo(() => {
    const found = Array.from(new Set(tables.map((tbl) => tbl.area)))
    return ["ALL", ...found]
  }, [tables])

  const visible = area === "ALL" ? tables : tables.filter((tbl) => tbl.area === area)

  const freeCount = tables.filter((tbl) => !tbl.session).length
  const occupiedCount = tables.filter((tbl) => tbl.session?.status === "OPEN").length
  const billCount = tables.filter((tbl) => tbl.session?.status === "BILL_REQUESTED").length

  const areaLabel = (value: string) => {
    if (value === "ALL") return t.all_areas
    if (value === "INDOOR") return t.area_indoor
    if (value === "OUTDOOR") return t.area_outdoor
    if (value === "VIP") return t.area_vip
    return value
  }

  const openTable = async (table: TableWithSession) => {
    if (table.session) {
      router.push(`/pos?session=${table.session.id}`)
      return
    }
    setOpening(table.id)
    try {
      const res = await fetch("/api/table-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableId: table.id }),
      })
      if (res.ok) {
        const session = await res.json()
        router.push(`/pos?session=${session.id}`)
      }
    } finally {
      setOpening(null)
    }
  }

  const cardTone = (table: TableWithSession) => {
    if (!table.session) return "bg-white border-green-300 hover:border-green-500"
    if (table.session.status === "BILL_REQUESTED") return "bg-blue-50 border-blue-400"
    return "bg-amber-50 border-amber-400"
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">{t.tables}</h1>
            <p className="text-sm text-slate-500">
              {freeCount} {t.free} · {occupiedCount} {t.occupied} · {billCount} {t.bill_requested}
            </p>
          </div>
          <Button
            variant="outline"
            className="h-11"
            onClick={() => router.push("/pos")}
          >
            <ShoppingCart className="w-4 h-4 mr-2" />
            {t.walk_in_sale}
          </Button>
        </div>

        <div className="px-6 pb-3 flex gap-2 overflow-x-auto">
          {areas.map((value) => (
            <Button
              key={value}
              size="sm"
              variant={area === value ? "default" : "outline"}
              className={area === value ? "bg-amber-600 hover:bg-amber-700" : ""}
              onClick={() => setArea(value)}
            >
              {areaLabel(value)}
            </Button>
          ))}
        </div>
      </header>

      <div className="p-4 md:p-6">
        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Card key={i} className="h-40 animate-pulse bg-slate-100 border-2" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <Card className="p-10 text-center text-slate-500">{t.no_tables_yet}</Card>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4">
            {visible.map((table) => (
              <Card
                key={table.id}
                onClick={() => !opening && openTable(table)}
                className={`p-4 border-2 cursor-pointer transition-all hover:shadow-lg active:scale-[0.98] ${cardTone(table)}`}
              >
                <div className="flex items-start justify-between mb-3">
                  <h3 className="text-xl font-bold text-slate-800 leading-none">{table.name}</h3>
                  {table.session ? (
                    <Badge className={table.session.status === "BILL_REQUESTED"
                      ? "bg-blue-600 hover:bg-blue-700"
                      : "bg-amber-600 hover:bg-amber-700"}>
                      {table.session.status === "BILL_REQUESTED" ? t.bill_requested : t.occupied}
                    </Badge>
                  ) : (
                    <Badge className="bg-green-600 hover:bg-green-700">{t.free}</Badge>
                  )}
                </div>

                <div className="flex items-center gap-1 text-slate-500 text-xs mb-3">
                  <Users className="w-3.5 h-3.5" />
                  <span>{table.seats} {t.seats}</span>
                </div>

                {table.session ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1 text-xs text-slate-600">
                      <Clock className="w-3.5 h-3.5" />
                      <span className="font-mono">{formatDuration(table.session.openedAt, now)}</span>
                    </div>
                    <p className="text-lg font-black text-slate-800 leading-none">
                      {formatLAK(table.session.total)}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {table.session.orderCount} {t.orders} · {table.session.waiterCount} {t.waiters_count}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">{opening === table.id ? "…" : t.open_table}</p>
                )}

                {table.session && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full mt-3 h-9"
                    onClick={(e) => {
                      e.stopPropagation()
                      router.push(`/tables/${table.session!.id}/bill`)
                    }}
                  >
                    <Receipt className="w-3.5 h-3.5 mr-1.5" />
                    {t.view_bill}
                  </Button>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify at three widths**

Run `npm run dev`, open `/tables`, and check with devtools device toolbar at **390px (phone), 820px (tablet), 1440px (desktop)**:
- 2 / 3 / 5 columns respectively, no horizontal page scroll at any width.
- Area filter row scrolls horizontally rather than wrapping into a tall stack on phone.
- Cards are at least 44px tall in their tap targets.

Open a table from one browser window and confirm a second window on `/tables` turns that card amber within 5 seconds.

- [ ] **Step 4: Commit**

```bash
git add app/tables/page.tsx lib/translations.ts
git commit -m "feat: real floor plan with live session status"
```

---

### Task 8: POS session banner

**Files:**
- Create: `components/session-banner.tsx`
- Modify: `app/pos/page.tsx`
- Modify: `lib/translations.ts`

**Interfaces:**
- Consumes: `GET /api/table-sessions/[id]`, `POST /api/orders` with `sessionId`/`waiterId`.
- Produces: `<SessionBanner session waiters waiterId onWaiterChange onViewBill />`, and the `/pos?session=<id>` behaviour.

The session logic lives in this component and in `lib/sessions.ts`. `app/pos/page.tsx` is 2,148 lines already — it gains wiring, not behaviour.

- [ ] **Step 1: Add the translation keys**

In `lib/translations.ts`, `en`:

```typescript
        send_order: "Send",
        select_waiter: "Select waiter",
        waiter: "Waiter",
        running_total: "Running Total",
        back_to_floor: "Floor",
        order_sent: "Order sent to table",
        waiter_required: "Select a waiter first",
```

`lo`:

```typescript
        send_order: "ສົ່ງ",
        select_waiter: "ເລືອກພະນັກງານ",
        waiter: "ພະນັກງານ",
        running_total: "ຍອດລວມ",
        back_to_floor: "ຜັງໂຕະ",
        order_sent: "ສົ່ງອໍເດີແລ້ວ",
        waiter_required: "ກະລຸນາເລືອກພະນັກງານກ່ອນ",
```

- [ ] **Step 2: Write the banner component**

Create `components/session-banner.tsx`:

```tsx
"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useTranslation } from "@/hooks/use-translation"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ArrowLeft, Clock, Receipt } from "lucide-react"
import { formatLAK } from "@/lib/currency"
import { formatDuration } from "@/lib/sessions"

export type BannerSession = {
  id: string
  openedAt: string
  total: number
  table: { name: string; area: string }
}

export type Waiter = { id: string; name: string }

export function SessionBanner({
  session,
  waiters,
  waiterId,
  onWaiterChange,
}: {
  session: BannerSession
  waiters: Waiter[]
  waiterId: string
  onWaiterChange: (id: string) => void
}) {
  const { t } = useTranslation()
  const router = useRouter()
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(tick)
  }, [])

  return (
    <div className="bg-amber-600 text-white px-4 py-2 flex items-center gap-3 flex-wrap">
      <Button
        size="sm"
        variant="ghost"
        className="text-white hover:bg-amber-700 h-9"
        onClick={() => router.push("/tables")}
      >
        <ArrowLeft className="w-4 h-4 mr-1.5" />
        {t.back_to_floor}
      </Button>

      <div className="flex items-baseline gap-2">
        <span className="text-lg font-black leading-none">{session.table.name}</span>
        <span className="text-xs opacity-80">{session.table.area}</span>
      </div>

      <div className="flex items-center gap-1 text-sm opacity-90">
        <Clock className="w-3.5 h-3.5" />
        <span className="font-mono">{formatDuration(session.openedAt, now)}</span>
      </div>

      <div className="flex items-center gap-1.5 ml-auto">
        <span className="text-xs opacity-80">{t.running_total}</span>
        <span className="text-lg font-black leading-none">{formatLAK(session.total)}</span>
      </div>

      <Select value={waiterId} onValueChange={onWaiterChange}>
        <SelectTrigger className="w-[150px] h-9 bg-white text-slate-800">
          <SelectValue placeholder={t.select_waiter} />
        </SelectTrigger>
        <SelectContent>
          {waiters.map((w) => (
            <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        size="sm"
        variant="secondary"
        className="h-9"
        onClick={() => router.push(`/tables/${session.id}/bill`)}
      >
        <Receipt className="w-4 h-4 mr-1.5" />
        {t.view_bill}
      </Button>
    </div>
  )
}
```

- [ ] **Step 3: Wrap the POS page in Suspense**

`useSearchParams` in a client component fails `next build` with "should be wrapped in a suspense boundary". At the top of `app/pos/page.tsx`, add `Suspense` to the React import, rename the existing component, and add a new default export.

Change line 114 from:

```tsx
export default function POSPage() {
```

to:

```tsx
function POSPageInner() {
```

and append at the very end of the file:

```tsx
export default function POSPage() {
  return (
    <Suspense fallback={null}>
      <POSPageInner />
    </Suspense>
  )
}
```

- [ ] **Step 4: Load the session and waiters**

Inside `POSPageInner`, after the existing `useState` declarations (around line 168), add:

```tsx
  const searchParams = useSearchParams()
  const sessionIdParam = searchParams.get("session")
  const [session, setSession] = useState<BannerSession | null>(null)
  const [waiters, setWaiters] = useState<Waiter[]>([])
  const [waiterId, setWaiterId] = useState("")

  // Session + waiter list. Refetched after every send so the banner total is
  // never behind the bill.
  const loadSession = useCallback(async () => {
    if (!sessionIdParam) { setSession(null); return }
    const res = await fetch(`/api/table-sessions/${sessionIdParam}`)
    if (!res.ok) { router.push("/tables"); return }
    const data = await res.json()
    if (data.status === "CLOSED") { router.push("/tables"); return }
    setSession({ id: data.id, openedAt: data.openedAt, total: data.total, table: data.table })
  }, [sessionIdParam, router])

  useEffect(() => { loadSession() }, [loadSession])

  useEffect(() => {
    if (!sessionIdParam) return
    fetch("/api/users?role=WAITER")
      .then((r) => r.ok ? r.json() : [])
      .then((list) => {
        const active = (list || []).filter((u: any) => u.role === "WAITER" && u.isActive)
        setWaiters(active)
        // A waiter works one section all night; remembering the pick saves a
        // tap per round. The order still stores it per row.
        const remembered = localStorage.getItem("pos_waiter")
        if (remembered && active.some((w: any) => w.id === remembered)) setWaiterId(remembered)
      })
      .catch(() => setWaiters([]))
  }, [sessionIdParam])

  const changeWaiter = (id: string) => {
    setWaiterId(id)
    localStorage.setItem("pos_waiter", id)
  }
```

Add the imports at the top of the file:

```tsx
import { useSearchParams } from "next/navigation"
import { SessionBanner, type BannerSession, type Waiter } from "@/components/session-banner"
```

and add `Suspense` and `useCallback` to the existing `react` import if not already present.

- [ ] **Step 4b: Confirm the users endpoint returns waiters**

Run: `curl -s http://localhost:3000/api/users | head -c 400`

Expected: each user carries a `role` field (`app/api/users/route.ts:20` already selects it) and the three seeded `WAITER` rows are present. No change to that route is needed — this step only confirms the assumption the client filter depends on.

- [ ] **Step 5: Add the send handler**

Toasts come from **sonner**, not the shadcn `use-toast` hook. `components/client-layout.tsx:32` mounts sonner's `<Toaster />` and nothing mounts the shadcn one, so `useToast()` from `hooks/use-toast.ts` would render silently into the void. Add this import to `app/pos/page.tsx`:

```tsx
import { toast } from "sonner"
```

Then add the handler next to the existing checkout handler:

```tsx
  const sendToTable = async () => {
    if (!session || cart.length === 0) return
    if (!waiterId) { toast.error(t.waiter_required); return }

    setIsProcessing(true)
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.id,
          waiterId,
          status: "SENT",
          items: cart.map((i) => ({
            variationSizeId: i.variationSizeId,
            name: i.localName ? `${i.localName} (${i.name})` : i.name,
            price: i.price,
            quantity: i.quantity,
            sugarLevel: i.sugar,
            shotType: i.shot,
            variation: i.variation,
            size: i.size,
            isTakeaway: i.isTakeaway,
          })),
          total,
          subtotal,
          tax,
          discount: 0,
        }),
      })

      if (res.ok) {
        setCart([])
        await loadSession()
        toast.success(t.order_sent)
      } else {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error || "Failed")
      }
    } finally {
      setIsProcessing(false)
    }
  }
```

- [ ] **Step 6: Render the banner and swap the action button**

Render `<SessionBanner>` as the first child inside the page's outermost wrapper, guarded on `session`:

```tsx
      {session && (
        <SessionBanner
          session={session}
          waiters={waiters}
          waiterId={waiterId}
          onWaiterChange={changeWaiter}
        />
      )}
```

Then, at the cart's primary action button, branch on the session so the walk-in path is untouched:

```tsx
      {session ? (
        <Button
          className="w-full h-14 text-lg bg-amber-600 hover:bg-amber-700"
          disabled={cart.length === 0 || isProcessing}
          onClick={sendToTable}
        >
          {t.send_order}
        </Button>
      ) : (
        /* existing checkout button, unchanged */
      )}
```

- [ ] **Step 7: Verify both paths**

Run `npm run dev`, then:
1. Open `/pos` with no query param — the banner is absent and a walk-in sale checks out exactly as before.
2. From `/tables`, tap a free table — the banner appears with the table name and `0:00`.
3. Send a round without picking a waiter — blocked with the waiter-required toast.
4. Pick a waiter, send a round — the cart clears and the banner total rises.
5. Return to `/tables` — the card shows the same total.

- [ ] **Step 8: Confirm the build still compiles**

Run: `npm run build`
Expected: success. If it fails on `useSearchParams`, Step 3's Suspense wrapper was not applied correctly.

- [ ] **Step 9: Commit**

```bash
git add components/session-banner.tsx app/pos/page.tsx lib/translations.ts
git commit -m "feat: order into a table session from the POS"
```

---

### Task 9: Bill screen

**Files:**
- Create: `app/tables/[sessionId]/bill/page.tsx`
- Modify: `lib/translations.ts`

**Interfaces:**
- Consumes: `GET /api/table-sessions/[id]`, `POST /api/table-sessions/[id]/close`, `PUT /api/table-sessions/[id]/status`.
- Produces: the route `/tables/[sessionId]/bill`.

Requirement #3 is satisfied here: the table name, the walk-in open timestamp, and the checkout close timestamp all appear on the bill.

- [ ] **Step 1: Add the translation keys**

`en`:

```typescript
        bill: "Bill",
        opened_at: "Opened",
        closed_at: "Closed",
        request_bill: "Request Bill",
        settle_bill: "Settle Bill",
        bill_total: "Total",
        no_orders_yet: "Nothing ordered yet",
        session_closed: "Bill settled",
```

`lo`:

```typescript
        bill: "ບິນ",
        opened_at: "ເປີດ",
        closed_at: "ປິດ",
        request_bill: "ຂໍບິນ",
        settle_bill: "ຈ່າຍເງິນ",
        bill_total: "ລວມ",
        no_orders_yet: "ຍັງບໍ່ມີລາຍການ",
        session_closed: "ຈ່າຍເງິນແລ້ວ",
```

- [ ] **Step 2: Write the bill page**

Create `app/tables/[sessionId]/bill/page.tsx`:

```tsx
"use client"

import { useState, useEffect, use } from "react"
import { useRouter } from "next/navigation"
import { useTranslation } from "@/hooks/use-translation"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ArrowLeft, Receipt } from "lucide-react"
import { formatLAK } from "@/lib/currency"
import { toast } from "sonner"

type BillOrder = {
  id: string
  orderNumber: string
  status: string
  total: number
  createdAt: string
  waiter: { id: string; name: string } | null
  items: { id: string; name: string; quantity: number; total: number }[]
}

type Bill = {
  id: string
  status: string
  openedAt: string
  closedAt: string | null
  total: number
  table: { name: string; area: string }
  orders: BillOrder[]
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })

export default function BillPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params)
  const { t } = useTranslation()
  const router = useRouter()
  const [bill, setBill] = useState<Bill | null>(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const res = await fetch(`/api/table-sessions/${sessionId}`)
    if (!res.ok) { router.push("/tables"); return }
    setBill(await res.json())
  }

  useEffect(() => { load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sessionId])

  const requestBill = async () => {
    setBusy(true)
    try {
      await fetch(`/api/table-sessions/${sessionId}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "BILL_REQUESTED" }),
      })
      await load()
    } finally { setBusy(false) }
  }

  const settle = async (paymentMethod: string) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/table-sessions/${sessionId}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMethod }),
      })
      if (res.ok) {
        toast.success(t.session_closed)
        router.push("/tables")
      } else {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error || "Failed")
      }
    } finally { setBusy(false) }
  }

  if (!bill) return <div className="min-h-screen bg-slate-50 p-6 text-slate-500">…</div>

  // Cancelled rounds stay visible on screen but are struck through and excluded
  // from the total, so staff can see a void happened rather than wonder where
  // a round went.
  const rounds = bill.orders.filter((o) => o.status !== "HOLD")

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b sticky top-0 z-10 px-4 py-3 flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push("/tables")}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div>
          <h1 className="text-xl font-bold text-slate-800 leading-none">
            {bill.table.name} · {t.bill}
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            {t.opened_at} {clock(bill.openedAt)}
            {bill.closedAt && ` · ${t.closed_at} ${clock(bill.closedAt)}`}
          </p>
        </div>
      </header>

      <div className="p-4 max-w-2xl mx-auto space-y-3">
        {rounds.length === 0 ? (
          <Card className="p-8 text-center text-slate-500">{t.no_orders_yet}</Card>
        ) : (
          rounds.map((order) => (
            <Card key={order.id} className={`p-4 ${order.status === "CANCELLED" ? "opacity-50" : ""}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{order.waiter?.name || "—"}</Badge>
                  <span className="text-xs text-slate-500">{clock(order.createdAt)}</span>
                </div>
                <span className={`font-bold text-slate-800 ${order.status === "CANCELLED" ? "line-through" : ""}`}>
                  {formatLAK(order.total)}
                </span>
              </div>
              <div className="space-y-1">
                {order.items.map((item) => (
                  <div key={item.id} className="flex justify-between text-sm text-slate-600">
                    <span>{item.quantity}× {item.name}</span>
                    <span>{formatLAK(item.total)}</span>
                  </div>
                ))}
              </div>
            </Card>
          ))
        )}

        <Card className="p-4 sticky bottom-4 shadow-lg">
          <div className="flex items-center justify-between mb-3">
            <span className="text-slate-500">{t.bill_total}</span>
            <span className="text-2xl font-black text-slate-800">{formatLAK(bill.total)}</span>
          </div>

          {bill.status === "CLOSED" ? (
            <p className="text-center text-sm text-slate-500">{t.session_closed}</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" className="h-12" disabled={busy} onClick={requestBill}>
                <Receipt className="w-4 h-4 mr-2" />
                {t.request_bill}
              </Button>
              <Button
                className="h-12 bg-amber-600 hover:bg-amber-700"
                disabled={busy}
                onClick={() => settle("CASH")}
              >
                {t.settle_bill}
              </Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
```

Settling is cash-only in this phase, matching the spec's non-goals. OnePay and split tender arrive with the `Payment` model in P2.

- [ ] **Step 3: Verify the bill**

From `/tables`, open a table, send two rounds under two different waiters, then tap View Bill.
Expected: both rounds listed with their waiter badge and time, correct total, and the open timestamp in the header. Tap Request Bill — return to `/tables` and the card is blue. Reopen the bill and settle — the card returns to free and the analytics endpoint now includes the total.

- [ ] **Step 4: Commit**

```bash
git add "app/tables/[sessionId]" lib/translations.ts
git commit -m "feat: table bill screen with per-waiter rounds and settle"
```

---

### Task 10: Navigation, landing page and cleanup

**Files:**
- Modify: `components/sidebar.tsx:97-107`
- Modify: `app/pin-login/page.tsx:98-100`
- Delete: `app/api/reports/route.ts`

**Interfaces:**
- Consumes: the `/tables` route from Task 7.
- Produces: `/tables` reachable from the sidebar and used as the non-admin landing page.

- [ ] **Step 1: Add the nav entry**

In `components/sidebar.tsx`, add to `mainNavItems` directly above the POS entry so the floor plan reads as the primary screen:

```tsx
        { name: t.tables, href: "/tables", icon: LayoutGrid },
```

Add `LayoutGrid` to the existing `lucide-react` import.

- [ ] **Step 2: Change the landing page**

In `app/pin-login/page.tsx:98-100`, change the non-admin destination only. Admins keep landing on the dashboard:

```typescript
                    window.location.href = '/dashboard'
                } else {
                    window.location.href = '/tables'
                }
```

- [ ] **Step 3: Delete the dead reports route**

```bash
rm app/api/reports/route.ts
```

It queries `prisma.product`, a model that does not exist in `schema.prisma`, so every call 500s. The UI has always used `/api/reports/analytics` instead — confirm with:

```bash
grep -rn "api/reports\"" app components || echo "no callers of /api/reports — safe to delete"
```

- [ ] **Step 4: Full verification**

```bash
npm test
npm run build
```

Expected: all tests pass, build succeeds.

Then run `npm run dev` and walk the whole loop once:
1. PIN-login as a STAFF user → lands on `/tables`.
2. Open a table → POS with the banner.
3. Pick a waiter, send a round → card total updates on a second device within 5s.
4. Note an ingredient's `subStock` before and after the send — deducted once, at send.
5. Confirm the dashboard does **not** yet show the sale.
6. Settle the bill → table frees, dashboard now shows it.
7. Cancel a sent round from `/orders` → stock returns to its pre-send value.

- [ ] **Step 5: Commit**

```bash
git add components/sidebar.tsx app/pin-login/page.tsx
git commit -m "feat: make the floor plan the landing screen; drop dead reports route"
```

---

## Verification Summary

The phase is done when all of these hold:

| Check | How |
|---|---|
| Session math is correct | `npm test` — 13 session tests plus the existing promotions suite |
| Build is clean | `npm run build` |
| Stock deducts once, at send | Ingredient `subStock` in Prisma Studio, before/after |
| Open bills are not revenue | `/api/reports/analytics` excludes an open session, includes it after close |
| Cancellation reverses stock | Cancel a `SENT` order, `subStock` returns to its original value |
| Three devices agree | Two browsers on `/tables`, one opens a table, other updates within 5s |
| One bill per table | Two rapid `POST /api/table-sessions` for the same table return the same id |
| Requirement #3 | Table name, open time and close time all print on the bill |
| Requirement #6 | One table carries rounds from two different waiters, each attributed |
| Responsive | `/tables` holds at 390px, 820px and 1440px with no horizontal scroll |

## Self-Review Notes

Checked against the spec:

- Spec's `GET /api/table-sessions` is intentionally absent — folded into `GET /api/tables` (documented under Global Constraints).
- Spec's "close a session with a HOLD order is blocked" is covered by `canCloseSession` in Task 1 and enforced in Task 6.
- Spec's "close a session with zero orders is allowed" is covered by a test in Task 1 and the absence of a guard in Task 6.
- Spec's table-administration screen under settings is **not** in this plan. Tables are seeded in Task 2 and edited through the API from Task 3. Add the settings UI as a follow-up if the bar needs to add tables without a developer — it is not needed to run a shift.
- Spec's `openedById` is written in Task 4 but not yet displayed anywhere. It exists for the P3 shift report.
