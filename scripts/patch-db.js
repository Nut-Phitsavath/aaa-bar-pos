const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(process.cwd(), 'dev.db');
console.log("Using database at:", dbPath);
const db = new sqlite3.Database(dbPath);

const mutations = [
    `CREATE TABLE IF NOT EXISTS "Promotion" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "code" TEXT NOT NULL,
        "discountType" TEXT NOT NULL,
        "discountValue" REAL NOT NULL,
        "startDate" DATETIME NOT NULL,
        "endDate" DATETIME NOT NULL,
        "isActive" BOOLEAN NOT NULL DEFAULT 1,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "Promotion_code_key" ON "Promotion"("code")`
];

db.serialize(() => {
    mutations.forEach(sql => {
        db.run(sql, (err) => {
            if (err) console.error("Error executing SQL:", sql, err);
        });
    });

    // Check Order table for new columns
    db.all(`PRAGMA table_info("Order")`, (err, rows) => {
        if (err) return console.error(err);
        const columns = rows.map(r => r.name);
        if (!columns.includes('discount')) {
            db.run(`ALTER TABLE "Order" ADD COLUMN "discount" REAL DEFAULT 0`);
            console.log("Added discount column to Order");
        }
        if (!columns.includes('promoId')) {
            db.run(`ALTER TABLE "Order" ADD COLUMN "promoId" TEXT`);
            console.log("Added promoId column to Order");
        }
    });

    // Check Product table for new columns
    db.all(`PRAGMA table_info("Product")`, (err, rows) => {
        if (err) return console.error(err);
        const columns = rows.map(r => r.name);
        if (!columns.includes('type')) {
            db.run(`ALTER TABLE "Product" ADD COLUMN "type" TEXT DEFAULT 'HOT'`);
            console.log("Added type column to Product");
        }
        if (!columns.includes('size')) {
            db.run(`ALTER TABLE "Product" ADD COLUMN "size" TEXT DEFAULT 'REGULAR'`);
            console.log("Added size column to Product");
        }
    });
});

db.close(() => {
    console.log("Database patch completed.");
});
