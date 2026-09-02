const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');

async function createInventoryTables() {
    const db = await open({
        filename: path.join(__dirname, '..', 'dev.db'),
        driver: sqlite3.Database
    });

    console.log('Creating Inventory tables...');

    // Check if Ingredient table exists
    const ingredientTable = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='Ingredient'");

    if (!ingredientTable) {
        await db.exec(`
            CREATE TABLE Ingredient (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                unit TEXT NOT NULL,
                currentStock REAL DEFAULT 0,
                minStock REAL DEFAULT 0,
                maxStock REAL DEFAULT 0,
                cost REAL DEFAULT 0,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ Ingredient table created');
    } else {
        console.log('Ingredient table already exists');
    }

    // Check if Recipe table exists
    const recipeTable = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='Recipe'");

    if (!recipeTable) {
        await db.exec(`
            CREATE TABLE Recipe (
                id TEXT PRIMARY KEY,
                productId TEXT NOT NULL,
                ingredientId TEXT NOT NULL,
                quantity REAL NOT NULL,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (productId) REFERENCES Product(id),
                FOREIGN KEY (ingredientId) REFERENCES Ingredient(id),
                UNIQUE(productId, ingredientId)
            );
        `);
        console.log('✅ Recipe table created');
    } else {
        console.log('Recipe table already exists');
    }

    await db.close();
    console.log('\n✅ Inventory tables setup complete!');
}

createInventoryTables().catch(err => {
    console.error(err);
    process.exit(1);
});
