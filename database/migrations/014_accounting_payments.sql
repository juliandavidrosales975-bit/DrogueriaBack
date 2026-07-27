-- =============================================
-- MIGRACIÓN 014: Contabilidad básica (método de pago en ventas +
-- estado de pago / cuentas por pagar a proveedores)
-- Ejecutar en el SQL Editor de Supabase
-- =============================================
--
-- Contexto: el módulo de Contabilidad (Caja + Ventas + Proveedores) necesita
-- saber CÓMO se cobró cada venta (efectivo/tarjeta/transferencia) y si una
-- compra a un proveedor ya se pagó, quedó pendiente o se pagó parcialmente.
-- Ninguno de los dos existía antes de esta migración.

-- =============================================
-- 1. Método de pago (compartido entre ventas y pagos a proveedores)
-- =============================================
DO $$ BEGIN
  CREATE TYPE payment_method AS ENUM ('CASH', 'CARD', 'TRANSFER', 'OTHER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 1a. Ventas: método de pago usado por el cliente
ALTER TABLE sales ADD COLUMN IF NOT EXISTS payment_method payment_method NOT NULL DEFAULT 'CASH';
CREATE INDEX IF NOT EXISTS idx_sales_payment_method ON sales(payment_method);

-- =============================================
-- 2. Estado de pago a proveedor (cuentas por pagar) en compras
-- =============================================
DO $$ BEGIN
  CREATE TYPE purchase_payment_status AS ENUM ('PAID', 'PARTIAL', 'PENDING');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE purchases ADD COLUMN IF NOT EXISTS payment_status purchase_payment_status NOT NULL DEFAULT 'PAID';
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS amount_paid DECIMAL(10, 2) NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_purchases_payment_status ON purchases(payment_status);

-- Las compras ya existentes se asumían pagadas de inmediato (comportamiento
-- anterior a esta migración): se marcan como PAID con amount_paid = total.
UPDATE purchases SET payment_status = 'PAID', amount_paid = total WHERE amount_paid = 0;

-- =============================================
-- 3. Historial de pagos realizados a proveedores (soporta abonos parciales)
-- =============================================
CREATE TABLE IF NOT EXISTS supplier_payments (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  store_id TEXT NOT NULL REFERENCES stores(id),
  purchase_id TEXT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  amount DECIMAL(10, 2) NOT NULL,
  payment_method payment_method NOT NULL DEFAULT 'CASH',
  note TEXT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_payments_purchase ON supplier_payments(purchase_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier ON supplier_payments(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_store ON supplier_payments(store_id);

-- =============================================
-- 4. cash_registers: separar ventas en efectivo del total de ventas
-- =============================================
-- El cierre de caja calculaba "efectivo esperado" sumando TODAS las ventas del
-- turno, sin importar el método de pago. Con tarjeta/transferencia eso está mal:
-- solo las ventas en EFECTIVO deben contar para el efectivo físico esperado en caja.
ALTER TABLE cash_registers ADD COLUMN IF NOT EXISTS cash_sales_total DECIMAL(10, 2) NULL;

-- =============================================
-- 5. RPC create_sale: agregar método de pago
-- =============================================
-- IMPORTANTE: CREATE OR REPLACE FUNCTION no sustituye una función si la lista
-- de parámetros cambia (crea una sobrecarga nueva y deja la anterior intacta).
-- Como agregamos p_payment_method, hay que borrar la firma vieja (7 params)
-- explícitamente o Postgres queda con dos create_sale y no puede elegir cuál
-- usar ("Could not choose the best candidate function...").
DROP FUNCTION IF EXISTS create_sale(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, JSONB);

CREATE OR REPLACE FUNCTION create_sale(
  p_customer_id TEXT DEFAULT NULL,
  p_user_id TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_tax NUMERIC DEFAULT 0,
  p_discount NUMERIC DEFAULT 0,
  p_store_id TEXT DEFAULT 'store-default',
  p_items JSONB DEFAULT '[]'::JSONB,
  p_payment_method TEXT DEFAULT 'CASH'
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
  v_total NUMERIC := 0;
BEGIN
  v_sale_id := gen_random_uuid()::TEXT;

  -- Calcular subtotal antes de insertar la cabecera
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_unit_quantity := (v_item->>'unitQuantity')::NUMERIC;
    v_unit_price    := (v_item->>'unitPrice')::NUMERIC;
    v_subtotal      := v_subtotal + (v_unit_quantity * v_unit_price);
  END LOOP;

  v_total := v_subtotal + COALESCE(p_tax, 0) - COALESCE(p_discount, 0);

  -- Insertar la cabecera de venta con subtotal, total y método de pago
  INSERT INTO sales (id, customer_id, user_id, notes, subtotal, tax, discount, total, status, store_id, payment_method)
  VALUES (
    v_sale_id, p_customer_id, p_user_id, p_notes, v_subtotal, COALESCE(p_tax, 0), COALESCE(p_discount, 0), v_total,
    'CONFIRMED', p_store_id, COALESCE(p_payment_method, 'CASH')::payment_method
  );

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

    -- Verificar stock suficiente
    SELECT stock INTO v_current_stock FROM products WHERE id = v_product_id;
    IF v_current_stock IS NULL THEN
      RAISE EXCEPTION 'Producto no encontrado: %', v_product_id;
    END IF;
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

  RETURN v_sale_id;
END;
$$;

-- =============================================
-- 6. RPC create_purchase: agregar estado de pago / monto abonado
-- =============================================
-- Mismo problema: se borra la firma vieja (7 params) antes de crear la nueva
-- (9 params) para evitar la ambigüedad de sobrecarga.
DROP FUNCTION IF EXISTS create_purchase(TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, JSONB);

CREATE OR REPLACE FUNCTION create_purchase(
  p_supplier_id TEXT,
  p_user_id TEXT,
  p_invoice_number TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_tax NUMERIC DEFAULT 0,
  p_store_id TEXT DEFAULT 'store-default',
  p_items JSONB DEFAULT '[]'::JSONB,
  p_payment_status TEXT DEFAULT 'PAID',
  p_amount_paid NUMERIC DEFAULT NULL
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
  v_base_unit_cost NUMERIC;
  v_line_total NUMERIC;
  v_subtotal NUMERIC := 0;
  v_total NUMERIC := 0;
  v_payment_status purchase_payment_status;
  v_amount_paid NUMERIC;
BEGIN
  v_purchase_id := gen_random_uuid()::TEXT;

  -- Calcular subtotal antes de insertar la cabecera
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_unit_quantity := (v_item->>'unitQuantity')::NUMERIC;
    v_unit_cost     := (v_item->>'unitCost')::NUMERIC;
    v_subtotal      := v_subtotal + (v_unit_quantity * v_unit_cost);
  END LOOP;

  v_total := v_subtotal + COALESCE(p_tax, 0);

  -- Resolver estado de pago y monto abonado
  IF p_payment_status = 'PENDING' THEN
    v_payment_status := 'PENDING';
    v_amount_paid := 0;
  ELSIF p_payment_status = 'PARTIAL' THEN
    v_amount_paid := COALESCE(p_amount_paid, 0);
    IF v_amount_paid <= 0 OR v_amount_paid >= v_total THEN
      RAISE EXCEPTION 'El monto abonado debe ser mayor a 0 y menor al total (%) para un pago parcial', v_total;
    END IF;
    v_payment_status := 'PARTIAL';
  ELSE
    -- PAID (por defecto): se asume pagada de inmediato por el total
    v_payment_status := 'PAID';
    v_amount_paid := v_total;
  END IF;

  -- Insertar la cabecera de compra con subtotal, total y estado de pago
  INSERT INTO purchases (
    id, supplier_id, user_id, invoice_number, notes, subtotal, tax, total, status, store_id,
    payment_status, amount_paid
  )
  VALUES (
    v_purchase_id, p_supplier_id, p_user_id, p_invoice_number, p_notes, v_subtotal, COALESCE(p_tax, 0), v_total,
    'CONFIRMED', p_store_id, v_payment_status, v_amount_paid
  );

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

    v_base_quantity  := v_unit_quantity * v_unit_factor;
    v_base_unit_cost := v_unit_cost / v_unit_factor;
    v_line_total     := v_unit_quantity * v_unit_cost;

    INSERT INTO purchase_items (
      id, purchase_id, product_id, quantity, unit_cost, line_total,
      unit_label, unit_factor, unit_quantity, product_unit_id
    ) VALUES (
      gen_random_uuid()::TEXT, v_purchase_id, v_product_id,
      v_base_quantity, v_unit_cost, v_line_total,
      v_unit_label, v_unit_factor, v_unit_quantity, v_unit_id
    );

    -- Incrementar stock y actualizar costo (en unidades base)
    UPDATE products SET stock = stock + v_base_quantity, cost = v_base_unit_cost, updated_at = NOW()
    WHERE id = v_product_id;

    -- Registrar movimiento de inventario con store_id
    INSERT INTO stock_movements (id, product_id, type, quantity, note, reference_type, reference_id, store_id)
    VALUES (
      gen_random_uuid()::TEXT, v_product_id, 'PURCHASE', v_base_quantity,
      'Compra #' || v_purchase_id, 'purchase', v_purchase_id, p_store_id
    );
  END LOOP;

  RETURN v_purchase_id;
END;
$$;
