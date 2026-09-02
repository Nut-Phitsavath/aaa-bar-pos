const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');

async function checkSchema() {
    const db = await open({
        filename: path.join(__dirname, '..', 'dev.db'),
        driver: sqlite3.Database
    });

    console.log('Checking Order table schema...');
    const columns = await db.all("PRAGMA table_info('Order')");
    console.log(JSON.stringify(columns, null, 2));

    const hasBeeper = columns.some(c => c.name === 'beeperNumber');
    if (!hasBeeper) {
        console.log('Adding beeperNumber column...');
        await db.run('ALTER TABLE "Order" ADD COLUMN beeperNumber TEXT');
        console.log('Success!');
    } else {
        console.log('beeperNumber column already exists.');
    }

    await db.close();
}

checkSchema().catch(console.error);
