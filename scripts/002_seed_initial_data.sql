-- Seed initial data for café POS

-- Insert categories
INSERT INTO categories (name, sort_order) VALUES
  ('Coffee', 1),
  ('Tea', 2),
  ('Pastries', 3),
  ('Sandwiches', 4),
  ('Desserts', 5)
ON CONFLICT DO NOTHING;

-- Insert menu items
INSERT INTO menu_items (category_id, name, description, base_price, is_available) VALUES
  ((SELECT id FROM categories WHERE name = 'Coffee'), 'Espresso', 'Strong and bold coffee shot', 3.50, true),
  ((SELECT id FROM categories WHERE name = 'Coffee'), 'Americano', 'Espresso with hot water', 4.00, true),
  ((SELECT id FROM categories WHERE name = 'Coffee'), 'Cappuccino', 'Espresso with steamed milk and foam', 4.50, true),
  ((SELECT id FROM categories WHERE name = 'Coffee'), 'Latte', 'Espresso with steamed milk', 4.75, true),
  ((SELECT id FROM categories WHERE name = 'Coffee'), 'Mocha', 'Espresso with chocolate and steamed milk', 5.25, true),
  ((SELECT id FROM categories WHERE name = 'Tea'), 'Earl Grey', 'Classic black tea with bergamot', 3.00, true),
  ((SELECT id FROM categories WHERE name = 'Tea'), 'Green Tea', 'Light and refreshing', 3.00, true),
  ((SELECT id FROM categories WHERE name = 'Tea'), 'Chai Latte', 'Spiced tea with steamed milk', 4.25, true),
  ((SELECT id FROM categories WHERE name = 'Pastries'), 'Croissant', 'Buttery flaky pastry', 3.50, true),
  ((SELECT id FROM categories WHERE name = 'Pastries'), 'Blueberry Muffin', 'Fresh baked muffin', 3.75, true),
  ((SELECT id FROM categories WHERE name = 'Sandwiches'), 'Club Sandwich', 'Triple decker with turkey and bacon', 8.50, true),
  ((SELECT id FROM categories WHERE name = 'Desserts'), 'Cheesecake', 'New York style cheesecake', 6.00, true)
ON CONFLICT DO NOTHING;

-- Insert modifiers
INSERT INTO modifiers (name, type, price_adjustment) VALUES
  ('Small', 'size', -0.50),
  ('Medium', 'size', 0.00),
  ('Large', 'size', 0.75),
  ('No Sugar', 'sugar', 0.00),
  ('Less Sugar', 'sugar', 0.00),
  ('Normal Sugar', 'sugar', 0.00),
  ('Extra Sugar', 'sugar', 0.00),
  ('No Ice', 'ice', 0.00),
  ('Less Ice', 'ice', 0.00),
  ('Normal Ice', 'ice', 0.00),
  ('Extra Ice', 'ice', 0.00),
  ('Extra Shot', 'addon', 1.00),
  ('Soy Milk', 'addon', 0.50),
  ('Almond Milk', 'addon', 0.50),
  ('Oat Milk', 'addon', 0.50),
  ('Whipped Cream', 'addon', 0.75)
ON CONFLICT DO NOTHING;

-- Insert tables
INSERT INTO tables (table_number, seats, status) VALUES
  ('T1', 2, 'free'),
  ('T2', 2, 'free'),
  ('T3', 4, 'free'),
  ('T4', 4, 'free'),
  ('T5', 6, 'free'),
  ('T6', 2, 'free'),
  ('T7', 4, 'free'),
  ('T8', 6, 'free')
ON CONFLICT DO NOTHING;

-- Insert default settings
INSERT INTO settings (key, value) VALUES
  ('shop_name', '"Café Delight"'),
  ('tax_rate', '0.08'),
  ('service_charge_rate', '0.10'),
  ('currency', '"USD"'),
  ('receipt_footer', '"Thank you for your visit!"')
ON CONFLICT (key) DO NOTHING;

-- Insert a default admin user (password: admin123 - hashed)
INSERT INTO staff (email, password_hash, full_name, role) VALUES
  ('admin@cafe.com', '$2a$10$rQ0vZ8jZL9vQxKQZQzKQxeJ1XqQZQZQZQZQZQZQZQZQZQZQZQZQ', 'Admin User', 'admin')
ON CONFLICT DO NOTHING;
