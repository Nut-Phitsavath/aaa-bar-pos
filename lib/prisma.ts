import { PrismaClient } from "@prisma/client"

const globalForPrisma = global as unknown as {
  prisma: PrismaClient
  prismaPragmasApplied?: boolean
}

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient()

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma

// SQLite tuning. WAL lets readers (e.g. the remote monitor / mom's phone) see a
// consistent committed snapshot while the cashier writes concurrently, instead
// of one blocking the other. busy_timeout makes a writer wait up to 5s for a
// lock rather than immediately throwing "database is locked". journal_mode=WAL
// is persisted in the DB file, so this effectively only needs to run once; the
// guard also prevents it re-running on dev hot-reloads.
if (!globalForPrisma.prismaPragmasApplied) {
  globalForPrisma.prismaPragmasApplied = true
    ; (async () => {
      try {
        await prisma.$queryRawUnsafe("PRAGMA journal_mode=WAL;")
        await prisma.$queryRawUnsafe("PRAGMA busy_timeout=5000;")
      } catch (e) {
        console.error("Failed to apply SQLite PRAGMAs (WAL/busy_timeout):", e)
      }
    })()
}
