const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const bcrypt = require('bcryptjs');

async function createDefaultUsers() {
    const db = await open({
        filename: path.join(__dirname, '..', 'dev.db'),
        driver: sqlite3.Database
    });

    console.log('Creating default users...');

    const crypto = require('crypto');
    const uuid = () => crypto.randomUUID();

    // Check if User table exists
    const tableExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='User'");

    if (!tableExists) {
        console.log('Creating User table...');
        await db.exec(`
            CREATE TABLE User (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                role TEXT NOT NULL,
                pin TEXT NOT NULL,
                isActive BOOLEAN DEFAULT 1,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);
    }

    // Check if users already exist
    const existingUsers = await db.all('SELECT * FROM User');

    if (existingUsers.length === 0) {
        // Create default users with PINs
        const users = [
            { name: 'Admin', role: 'ADMIN', pin: '1234' },
            { name: 'Cashier 1', role: 'CASHIER', pin: '2222' },
            { name: 'Barista 1', role: 'KITCHEN', pin: '3333' }
        ];

        for (const user of users) {
            const hashedPin = await bcrypt.hash(user.pin, 10);
            await db.run(
                'INSERT INTO User (id, name, role, pin, createdAt, updatedAt) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
                uuid(), user.name, user.role, hashedPin
            );
            console.log(`Created user: ${user.name} (PIN: ${user.pin})`);
        }

        console.log('\n✅ Default users created successfully!');
        console.log('Login PINs:');
        console.log('  Admin: 1234');
        console.log('  Cashier 1: 2222');
        console.log('  Barista 1: 3333');
    } else {
        console.log('Users already exist, skipping creation.');
    }

    await db.close();
}

createDefaultUsers().catch(err => {
    console.error(err);
    process.exit(1);
});
