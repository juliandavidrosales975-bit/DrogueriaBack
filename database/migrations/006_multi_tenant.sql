-- =============================================
-- MIGRACIÓN 006: MULTI-TENANCY (Aislamiento por Droguería)
-- Ejecutar en el SQL Editor de Supabase
-- =============================================

-- 1. Tabla de droguerías (tenants)
CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  name VARCHAR(255) NOT NULL,
  nit VARCHAR(50) NULL,
  address TEXT NULL,
  phone VARCHAR(50) NULL,
  email VARCHAR(255) NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger de updated_at para stores
CREATE TRIGGER update_stores_updated_at BEFORE UPDATE ON stores
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 2. Droguería por defecto (para datos existentes)
INSERT INTO stores (id, name, nit, address, phone)
VALUES ('store-default', 'Droguería Principal', '900000001-0', 'Dirección Principal', '3001234567')
ON CONFLICT (id) DO NOTHING;

-- 3. Agregar store_id a users (NULL para Super Admin, requerido para Admin Droguería)
ALTER TABLE users ADD COLUMN IF NOT EXISTS store_id TEXT NULL REFERENCES stores(id);
CREATE INDEX IF NOT EXISTS idx_users_store_id ON users(store_id);

-- 4. Agregar store_id a todas las tablas de negocio

-- Productos
ALTER TABLE products ADD COLUMN IF NOT EXISTS store_id TEXT NOT NULL DEFAULT 'store-default' REFERENCES stores(id);
CREATE INDEX IF NOT EXISTS idx_products_store_id ON products(store_id);

-- Categorías de productos
ALTER TABLE product_categories ADD COLUMN IF NOT EXISTS store_id TEXT NOT NULL DEFAULT 'store-default' REFERENCES stores(id);
CREATE INDEX IF NOT EXISTS idx_product_categories_store_id ON product_categories(store_id);

-- Presentaciones de productos
ALTER TABLE product_units ADD COLUMN IF NOT EXISTS store_id TEXT NOT NULL DEFAULT 'store-default' REFERENCES stores(id);
CREATE INDEX IF NOT EXISTS idx_product_units_store_id ON product_units(store_id);

-- Clientes
ALTER TABLE customers ADD COLUMN IF NOT EXISTS store_id TEXT NOT NULL DEFAULT 'store-default' REFERENCES stores(id);
CREATE INDEX IF NOT EXISTS idx_customers_store_id ON customers(store_id);

-- Proveedores
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS store_id TEXT NOT NULL DEFAULT 'store-default' REFERENCES stores(id);
CREATE INDEX IF NOT EXISTS idx_suppliers_store_id ON suppliers(store_id);

-- Compras
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS store_id TEXT NOT NULL DEFAULT 'store-default' REFERENCES stores(id);
CREATE INDEX IF NOT EXISTS idx_purchases_store_id ON purchases(store_id);

-- Ventas
ALTER TABLE sales ADD COLUMN IF NOT EXISTS store_id TEXT NOT NULL DEFAULT 'store-default' REFERENCES stores(id);
CREATE INDEX IF NOT EXISTS idx_sales_store_id ON sales(store_id);

-- Movimientos de inventario
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS store_id TEXT NOT NULL DEFAULT 'store-default' REFERENCES stores(id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_store_id ON stock_movements(store_id);

-- Configuraciones
ALTER TABLE settings ADD COLUMN IF NOT EXISTS store_id TEXT NOT NULL DEFAULT 'store-default' REFERENCES stores(id);
CREATE INDEX IF NOT EXISTS idx_settings_store_id ON settings(store_id);

-- 5. Asignar la droguería por defecto al admin existente
UPDATE users SET store_id = 'store-default' WHERE email = 'admin@drogueria.com';

-- 6. Actualizar las funciones RPC para incluir store_id en inserts
-- (Las funciones create_purchase y create_sale necesitan ser recreadas con store_id)

-- Función create_purchase actualizada con store_id
CREATE OR REPLACE FUNCTION create_purchase(
  p_supplier_id TEXT,
  p_user_id TEXT,
  p_invoice_number TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_tax NUMERIC DEFAULT 0,
  p_store_id TEXT DEFAULT 'store-default',
  p_items JSONB DEFAULT '[]'::JSONB
) RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_purchase_id TEXT;
  v_item JSONB;
  v_product_id TEXT;
  v_unit_quantity NUMERIC;
  v_unit_cost NUMERIC;
  v_unit_factor NUMERIC;
  v_unit_label TEXT;
  v_unit_id TEXT;
  v_base_quantity NUMERIC;
  v_line_total NUMERIC;
  v_subtotal NUMERIC := 0;
BEGIN
  v_purchase_id := gen_random_uuid()::TEXT;

  -- Insertar la cabecera de compra
  INSERT INTO purchases (id, supplier_id, user_id, invoice_number, notes, tax, status, store_id)
  VALUES (v_purchase_id, p_supplier_id, p_user_id, p_invoice_number, p_notes, p_tax, 'CONFIRMED', p_store_id);

  -- Procesar ítems
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id   := v_item->>'productId';
    v_unit_quantity := (v_item->>'unitQuantity')::NUMERIC;
    v_unit_cost    := (v_item->>'unitCost')::NUMERIC;
    v_unit_factor  := COALESCE((v_item->>'unitFactor')::NUMERIC, 1);
    v_unit_label   := COALESCE(v_item->>'unitLabel', 'Unidad');
    v_unit_id      := v_item->>'productUnitId';
    IF v_unit_id = 'null' OR v_unit_id = '' THEN v_unit_id := NULL; END IF;

    v_base_quantity := v_unit_quantity * v_unit_factor;
    v_line_total    := v_unit_quantity * v_unit_cost;
    v_subtotal      := v_subtotal + v_line_total;

    INSERT INTO purchase_items (
      id, purchase_id, product_id, quantity, unit_cost, line_total,
      unit_label, unit_factor, unit_quantity, product_unit_id
    ) VALUES (
      gen_random_uuid()::TEXT, v_purchase_id, v_product_id,
      v_base_quantity, v_unit_cost, v_line_total,
      v_unit_label, v_unit_factor, v_unit_quantity, v_unit_id
    );

    -- Incrementar stock
    UPDATE products SET stock = stock + v_base_quantity, updated_at = NOW()
    WHERE id = v_product_id;

    -- Registrar movimiento de inventario con store_id
    INSERT INTO stock_movements (id, product_id, type, quantity, note, reference_type, reference_id, store_id)
    VALUES (
      gen_random_uuid()::TEXT, v_product_id, 'PURCHASE', v_base_quantity,
      'Compra #' || v_purchase_id, 'purchase', v_purchase_id, p_store_id
    );
  END LOOP;

  -- Actualizar total de la compra
  UPDATE purchases SET total = v_subtotal + p_tax WHERE id = v_purchase_id;

  RETURN v_purchase_id;
END;
$$;

-- Función create_sale actualizada con store_id
CREATE OR REPLACE FUNCTION create_sale(
  p_customer_id TEXT DEFAULT NULL,
  p_user_id TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_tax NUMERIC DEFAULT 0,
  p_discount NUMERIC DEFAULT 0,
  p_store_id TEXT DEFAULT 'store-default',
  p_items JSONB DEFAULT '[]'::JSONB
) RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_sale_id TEXT;
  v_item JSONB;
  v_product_id TEXT;
  v_unit_quantity NUMERIC;
  v_unit_price NUMERIC;
  v_unit_factor NUMERIC;
  v_unit_label TEXT;
  v_unit_id TEXT;
  v_base_quantity NUMERIC;
  v_line_total NUMERIC;
  v_current_stock NUMERIC;
  v_subtotal NUMERIC := 0;
BEGIN
  v_sale_id := gen_random_uuid()::TEXT;

  -- Insertar la cabecera de venta
  INSERT INTO sales (id, customer_id, user_id, notes, tax, discount, status, store_id)
  VALUES (v_sale_id, p_customer_id, p_user_id, p_notes, p_tax, p_discount, 'CONFIRMED', p_store_id);

  -- Procesar ítems
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id    := v_item->>'productId';
    v_unit_quantity := (v_item->>'unitQuantity')::NUMERIC;
    v_unit_price    := (v_item->>'unitPrice')::NUMERIC;
    v_unit_factor   := COALESCE((v_item->>'unitFactor')::NUMERIC, 1);
    v_unit_label    := COALESCE(v_item->>'unitLabel', 'Unidad');
    v_unit_id       := v_item->>'productUnitId';
    IF v_unit_id = 'null' OR v_unit_id = '' THEN v_unit_id := NULL; END IF;

    v_base_quantity := v_unit_quantity * v_unit_factor;
    v_line_total    := v_unit_quantity * v_unit_price;
    v_subtotal      := v_subtotal + v_line_total;

    -- Verificar stock suficiente
    SELECT stock INTO v_current_stock FROM products WHERE id = v_product_id;
    IF v_current_stock < v_base_quantity THEN
      RAISE EXCEPTION 'Stock insuficiente para el producto %', v_product_id;
    END IF;

    INSERT INTO sale_items (
      id, sale_id, product_id, quantity, unit_price, line_total,
      unit_label, unit_factor, unit_quantity, product_unit_id
    ) VALUES (
      gen_random_uuid()::TEXT, v_sale_id, v_product_id,
      v_base_quantity, v_unit_price, v_line_total,
      v_unit_label, v_unit_factor, v_unit_quantity, v_unit_id
    );

    -- Descontar stock
    UPDATE products SET stock = stock - v_base_quantity, updated_at = NOW()
    WHERE id = v_product_id;

    -- Registrar movimiento de inventario con store_id
    INSERT INTO stock_movements (id, product_id, type, quantity, note, reference_type, reference_id, store_id)
    VALUES (
      gen_random_uuid()::TEXT, v_product_id, 'SALE', v_base_quantity,
      'Venta #' || v_sale_id, 'sale', v_sale_id, p_store_id
    );
  END LOOP;

  -- Actualizar total de la venta
  UPDATE sales SET total = v_subtotal + p_tax - p_discount WHERE id = v_sale_id;

  RETURN v_sale_id;
END;
$$;
