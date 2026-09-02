import sqlite3 from 'sqlite3'
import { open, Database } from 'sqlite'
import path from 'path'

// Open the database
// We use a singleton pattern to reuse the promise, but for Next.js in dev mode, 
// re-opening might be necessary. However, `open` returns a promise.

let dbPromise: Promise<Database<sqlite3.Database, sqlite3.Statement>> | null = null

export async function getDb() {
    if (!dbPromise) {
        dbPromise = (async () => {
            const db = await open({
                filename: path.join(process.cwd(), 'dev.db'),
                driver: sqlite3.Database
            })

            await db.exec('PRAGMA busy_timeout = 5000')

            // Self-healing schema: Ensure tables and columns exist
            await db.exec(`
                CREATE TABLE IF NOT EXISTS "Promotion" (
                    "id" TEXT NOT NULL PRIMARY KEY,
                    "name" TEXT NOT NULL,
                    "description" TEXT,
                    "code" TEXT NOT NULL,
                    "discountType" TEXT NOT NULL,
                    "discountValue" REAL NOT NULL,
                    "startDate" DATETIME NOT NULL,
                    "endDate" DATETIME NOT NULL,
                    "isActive" BOOLEAN NOT NULL DEFAULT 1,
                    "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
                    "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
                );
                CREATE UNIQUE INDEX IF NOT EXISTS "Promotion_code_key" ON "Promotion"("code");

                CREATE TABLE IF NOT EXISTS "Setting" (
                    "key" TEXT PRIMARY KEY,
                    "value" TEXT NOT NULL
                );
            `)

            // Seed default settings if not exists
            const settings = [
                ['tax_rate', '10'],
                ['language', 'lo'],
                ['shop_name', 'Cafe POS'],
                ['loyalty_rate', '100'] // 1 point = 100 LAK
            ]
            for (const [key, val] of settings) {
                await db.run('INSERT OR IGNORE INTO Setting (key, value) VALUES (?, ?)', [key, val])
            }

            // Patch Order table
            const orderInfo = await db.all('PRAGMA table_info("Order")')
            const oCols = orderInfo.map(r => r.name)
            if (!oCols.includes('discount')) await db.exec('ALTER TABLE "Order" ADD COLUMN "discount" REAL DEFAULT 0')
            if (!oCols.includes('promoId')) await db.exec('ALTER TABLE "Order" ADD COLUMN "promoId" TEXT')
            if (!oCols.includes('pointsRedeemed')) await db.exec('ALTER TABLE "Order" ADD COLUMN "pointsRedeemed" INTEGER DEFAULT 0')
            if (!oCols.includes('taxAmount')) await db.exec('ALTER TABLE "Order" ADD COLUMN "taxAmount" REAL DEFAULT 0')
            if (!oCols.includes('subtotal')) await db.exec('ALTER TABLE "Order" ADD COLUMN "subtotal" REAL DEFAULT 0')

            // Patch Product table
            const productInfo = await db.all('PRAGMA table_info("Product")')
            const pCols = productInfo.map(r => r.name)
            if (!pCols.includes('type')) await db.exec("ALTER TABLE \"Product\" ADD COLUMN \"type\" TEXT DEFAULT 'HOT'")
            if (!pCols.includes('size')) await db.exec("ALTER TABLE \"Product\" ADD COLUMN \"size\" TEXT DEFAULT 'REGULAR'")

            return db
        })()
    }
    return dbPromise
}
