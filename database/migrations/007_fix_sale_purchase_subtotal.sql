-- Droguería - Corrección de create_sale / create_purchase (multi-tenant)
-- Migration: 007_fix_sale_purchase_subtotal.sql
-- Las versiones de 006_multi_tenant.sql insertaban la cabecera de venta/compra
-- ANTES de calcular el subtotal, y nunca lo escribían en el INSERT inicial
-- (columna NOT NULL), lo que producía el error:
--   "null value in column "subtotal" of relation "sales" violates not-null constraint"
-- Esta migración corrige ambas funciones para calcular el subtotal primero
-- y usarlo tanto en el INSERT como en el UPDATE final.

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

  -- Insertar la cabecera de venta con subtotal y total ya calculados
  INSERT INTO sales (id, customer_id, user_id, notes, subtotal, tax, discount, total, status, store_id)
  VALUES (v_sale_id, p_customer_id, p_user_id, p_notes, v_subtotal, COALESCE(p_tax, 0), COALESCE(p_discount, 0), v_total, 'CONFIRMED', p_store_id);

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
  v_base_unit_cost NUMERIC;
  v_line_total NUMERIC;
  v_subtotal NUMERIC := 0;
  v_total NUMERIC := 0;
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

  -- Insertar la cabecera de compra con subtotal y total ya calculados
  INSERT INTO purchases (id, supplier_id, user_id, invoice_number, notes, subtotal, tax, total, status, store_id)
  VALUES (v_purchase_id, p_supplier_id, p_user_id, p_invoice_number, p_notes, v_subtotal, COALESCE(p_tax, 0), v_total, 'CONFIRMED', p_store_id);

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
