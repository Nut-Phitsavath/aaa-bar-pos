const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const path = require('path');

async function main() {
    console.log("Connecting to database...");
    const db = await open({
        filename: path.join(process.cwd(), 'dev.db'),
        driver: sqlite3.Database
    });

    await db.exec('PRAGMA busy_timeout = 5000');

    console.log("Creating Promotion table...");
    await db.exec(`CREATE TABLE IF NOT EXISTS "Promotion" (
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
    )`);

    await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "Promotion_code_key" ON "Promotion"("code")`);

    console.log("Checking columns...");
    const orderInfo = await db.all(`PRAGMA table_info("Order")`);
    const oCols = orderInfo.map(r => r.name);
    if (!oCols.includes('discount')) await db.exec(`ALTER TABLE "Order" ADD COLUMN "discount" REAL DEFAULT 0`);
    if (!oCols.includes('promoId')) await db.exec(`ALTER TABLE "Order" ADD COLUMN "promoId" TEXT`);

    const productInfo = await db.all(`PRAGMA table_info("Product")`);
    const pCols = productInfo.map(r => r.name);
    if (!pCols.includes('type')) await db.exec(`ALTER TABLE "Product" ADD COLUMN "type" TEXT DEFAULT 'HOT'`);
    if (!pCols.includes('size')) await db.exec(`ALTER TABLE "Product" ADD COLUMN "size" TEXT DEFAULT 'REGULAR'`);

    await db.close();
    console.log("Success! Database patched.");
}

main().catch(err => {
    console.error("Patch failed:", err);
    process.exit(1);
});
