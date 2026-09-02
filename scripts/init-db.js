const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');

async function initDb() {
  const db = await open({
    filename: path.join(__dirname, '..', 'dev.db'),
    driver: sqlite3.Database
  });

  console.log('Database connected.');

  // Create Tables
  await db.exec(`
    CREATE TABLE IF NOT EXISTS Category (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS Product (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      isAvailable BOOLEAN DEFAULT 1,
      image TEXT DEFAULT '/placeholder.svg',
      categoryId TEXT NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (categoryId) REFERENCES Category(id)
    );

    CREATE TABLE IF NOT EXISTS Customer (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      loyaltyPoints INTEGER DEFAULT 0,
      totalSpent REAL DEFAULT 0,
      visitCount INTEGER DEFAULT 0,
      lastVisit DATETIME DEFAULT CURRENT_TIMESTAMP,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS "Order" (
      id TEXT PRIMARY KEY,
      orderNumber TEXT UNIQUE,
      status TEXT DEFAULT 'COMPLETED',
      total REAL,
      subtotal REAL,
      tax REAL,
      discount REAL DEFAULT 0,
      paymentMethod TEXT DEFAULT 'CASH',
      customerId TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customerId) REFERENCES Customer(id)
    );

    CREATE TABLE IF NOT EXISTS OrderItem (
      id TEXT PRIMARY KEY,
      orderId TEXT NOT NULL,
      productId TEXT NOT NULL,
      name TEXT,
      price REAL,
      quantity INTEGER,
      total REAL,
      FOREIGN KEY (orderId) REFERENCES "Order"(id),
      FOREIGN KEY (productId) REFERENCES Product(id)
    );
  `);

  console.log('Tables created.');

  // Seed Data
  const categories = await db.all('SELECT * FROM Category');
  if (categories.length === 0) {
    console.log('Seeding data...');

    const crypto = require('crypto');
    const uuid = () => crypto.randomUUID();

    const coffeeId = uuid();
    await db.run('INSERT INTO Category (id, name, createdAt, updatedAt) VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)', coffeeId, 'Coffee');

    const teaId = uuid();
    await db.run('INSERT INTO Category (id, name, createdAt, updatedAt) VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)', teaId, 'Tea');

    const pastriesId = uuid();
    await db.run('INSERT INTO Category (id, name, createdAt, updatedAt) VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)', pastriesId, 'Pastries');

    await db.run('INSERT INTO Product (id, name, price, categoryId, description, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
      uuid(), 'Espresso', 3.5, coffeeId, 'Strong and bold');

    await db.run('INSERT INTO Product (id, name, price, categoryId, description, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
      uuid(), 'Latte', 4.5, coffeeId, 'Milky delight');

    await db.run('INSERT INTO Product (id, name, price, categoryId, description, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
      uuid(), 'Croissant', 3.5, pastriesId, 'Buttery goodness');

    await db.run('INSERT INTO Customer (id, name, phone, email, loyaltyPoints, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
      uuid(), 'John Doe', '555-0123', 'john@example.com', 100);

    console.log('Seeding completed.');
  } else {
    console.log('Data already exists, skipping seed.');
  }

  await db.close();
}

initDb().catch(err => {
  console.error(err);
  process.exit(1);
});
