# AAA Bar POS

Next.js 16 + Prisma/SQLite. Single server on the till machine, other devices reach
it over the LAN. Nothing is published to the internet (the Cloudflare tunnel was the
cafe's, not the bar's).

- [AAA-store-requriment.md](AAA-store-requriment.md) — the 26 requirements from the owner
- [AAA-BAR-PLAN.md](AAA-BAR-PLAN.md) — what exists, what is missing, in what order
- [SETUP-PRODUCTION.md](SETUP-PRODUCTION.md) — build, start-on-boot

## Getting a database

There is no database in this repo and there never will be — `dev.db` is gitignored.
You build one from the seeds, which is also how you get the example data to work against:

```bash
npm install
cp .env.example .env           # then fill in SESSION_SECRET (the command is in the file)
npx prisma migrate deploy      # create prisma/dev.db from prisma/migrations
npm run db:seed     # a clean venue: 24 stock items, 24 menu items, 13 tables, 4 waiters
npm run db:demo     # optional: 21 days of invented trading on top
npm run dev
```

Logins after seeding: `admin/1675`, `manager/2468`, `staff1/3978`, `staff2/2267`.

**Migrations, not `db push`.** The till builds and updates its database with
`migrate deploy` (run-pos.bat does it on every start), so a schema change needs a
migration: `npx prisma migrate dev --name what_changed`. `db push` changes your
database without one, which is how the schema and migrations drifted apart until
`20261021120000_catch_up_with_db_push`. An older dev.db:

- made with `db push` (no `_prisma_migrations` table): delete it and run the steps above — it is seed data.
- made with migrations before that one: `npx prisma migrate resolve --applied 20261021120000_catch_up_with_db_push`, since it already has those columns.

`db:seed` leaves a venue you could open with — no sales history, empty reports.
`db:demo` bolts ~214 sessions, ~637 orders, voids, comps, pay-later tabs and shift
cash counts onto it, so every report tab has something to show. It writes what the
app itself would write, so reports exercise the same joins they will in service.
Re-run `db:seed` to wipe back to clean.

Everything in the seeds is **placeholder** — plausible bar items in Thai baht, not
the owner's list. Prices and costs are chosen so pour cost lands in a defensible
band; `npm run check:pourcost` prints the table and flags anything outside it.

## Where things live

| | |
|---|---|
| Schema | [prisma/schema.prisma](prisma/schema.prisma) — the only one; history in [prisma/migrations/](prisma/migrations/) |
| DB client | [lib/prisma.ts](lib/prisma.ts) — singleton, sets WAL + busy_timeout |
| Seeds | [prisma/seedBarData.js](prisma/seedBarData.js), [prisma/seedDemoHistory.js](prisma/seedDemoHistory.js) |
| Tests | `npm test` — `node --test` over `lib/*.test.ts`, no framework |
