-- Seed data para sistema de droguería - PostgreSQL
-- Seeds: 001_initial_data.sql

-- =============================================
-- ROLES
-- =============================================

INSERT INTO roles (id, name) VALUES
('role-admin', 'Administrador'),
('role-cashier', 'Cajero'),
('role-warehouse', 'Almacén')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- =============================================
-- USUARIOS (password: Admin123!)
-- =============================================

-- Hash de 'Admin123!' con bcrypt rounds=10
-- $2a$10$QxWz/VQN5/GxKGX4n3qOh.vF8RiQqJ5L9wI7YpO8MnJ7YH3qvqYHC

INSERT INTO users (id, email, username, full_name, password_hash, role_id, status) VALUES
('user-admin', 'admin@drogueria.com', 'admin', 'Administrador del Sistema', '$2a$10$QxWz/VQN5/GxKGX4n3qOh.vF8RiQqJ5L9wI7YpO8MnJ7YH3qvqYHC', 'role-admin', 'ACTIVE'),
('user-cashier', 'cajero@drogueria.com', 'cajero', 'Usuario Cajero', '$2a$10$QxWz/VQN5/GxKGX4n3qOh.vF8RiQqJ5L9wI7YpO8MnJ7YH3qvqYHC', 'role-cashier', 'ACTIVE')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

-- =============================================
-- CATEGORÍAS DE PRODUCTOS
-- =============================================

INSERT INTO product_categories (id, name, description) VALUES
('cat-analgesicos', 'Analgésicos', 'Medicamentos para el dolor'),
('cat-antibioticos', 'Antibióticos', 'Medicamentos antibacterianos'),
('cat-vitaminas', 'Vitaminas', 'Suplementos vitamínicos'),
('cat-higiene', 'Higiene Personal', 'Productos de cuidado personal'),
('cat-primeros-auxilios', 'Primeros Auxilios', 'Material de curación')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- =============================================
-- PRODUCTOS DE EJEMPLO
-- =============================================

INSERT INTO products (id, sku, name, description, category_id, cost, price, stock, min_stock, is_active) VALUES
('prod-001', 'MED-001', 'Paracetamol 500mg', 'Analgésico y antipirético', 'cat-analgesicos', 5.00, 10.00, 100, 20, TRUE),
('prod-002', 'MED-002', 'Ibuprofeno 400mg', 'Antiinflamatorio', 'cat-analgesicos', 8.00, 15.00, 80, 15, TRUE),
('prod-003', 'MED-003', 'Amoxicilina 500mg', 'Antibiótico', 'cat-antibioticos', 15.00, 25.00, 50, 10, TRUE),
('prod-004', 'VIT-001', 'Vitamina C 1000mg', 'Suplemento vitamínico', 'cat-vitaminas', 10.00, 20.00, 60, 10, TRUE),
('prod-005', 'HIG-001', 'Alcohol en Gel 500ml', 'Desinfectante de manos', 'cat-higiene', 12.00, 20.00, 150, 30, TRUE)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- =============================================
-- CONFIGURACIONES DEL SISTEMA
-- =============================================

INSERT INTO settings (id, key, value, type, description) VALUES
('set-001', 'business_name', 'Droguería Mi Salud', 'STRING', 'Nombre del negocio'),
('set-002', 'tax_rate', '0.19', 'NUMBER', 'Tasa de impuesto (IVA)'),
('set-003', 'currency', 'COP', 'STRING', 'Moneda del sistema'),
('set-004', 'low_stock_alert', 'true', 'BOOLEAN', 'Alertas de stock bajo')
ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value;
