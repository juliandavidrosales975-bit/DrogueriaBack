-- Droguería - Actualización de funciones RPC para soportar presentaciones
-- Migration: 005_rpc_functions_units.sql
-- Ejecutar este script en el SQL Editor de Supabase (después de 004)
-- Reemplaza las funciones create_sale y create_purchase de 002_rpc_functions.sql

-- =============================================
-- FUNCIÓN: create_sale (v2 con soporte de presentaciones)
-- Cada item de p_items ahora puede incluir:
--   productId, unitPrice, unitQuantity, unitFactor, unitLabel, productUnitId (opcional)
-- `quantity` (unidades base) se calcula como unitQuantity * unitFactor
-- =============================================

CREATE OR REPLACE FUNCTION create_sale(
  p_customer_id TEXT,
  p_user_id TEXT,
  p_notes TEXT,
  p_tax DECIMAL,
  p_discount DECIMAL,
  p_items JSONB
  -- [{ "productId", "unitPrice", "unitQuantity", "unitFactor", "unitLabel", "productUnitId" }]
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_sale_id TEXT := gen_random_uuid()::TEXT;
  v_sale_item_id TEXT;
  v_subtotal DECIMAL := 0;
  v_total DECIMAL := 0;
  v_item JSONB;
  v_product_id TEXT;
  v_unit_quantity INT;
  v_unit_factor INT;
  v_base_quantity INT;
  v_unit_price DECIMAL;
  v_line_total DECIMAL;
  v_current_stock INT;
  v_product_name TEXT;
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_unit_quantity := COALESCE((v_item->>'unitQuantity')::INT, (v_item->>'quantity')::INT);
    v_unit_factor := COALESCE((v_item->>'unitFactor')::INT, 1);
    v_subtotal := v_subtotal + (v_unit_quantity * (v_item->>'unitPrice')::DECIMAL);
  END LOOP;

  v_total := v_subtotal + COALESCE(p_tax, 0) - COALESCE(p_discount, 0);

  -- Validar stock de todos los productos antes de procesar (en unidades base)
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := v_item->>'productId';
    v_unit_quantity := COALESCE((v_item->>'unitQuantity')::INT, (v_item->>'quantity')::INT);
    v_unit_factor := COALESCE((v_item->>'unitFactor')::INT, 1);
    v_base_quantity := v_unit_quantity * v_unit_factor;

    SELECT stock, name INTO v_current_stock, v_product_name
    FROM products WHERE id = v_product_id;

    IF v_current_stock IS NULL THEN
      RAISE EXCEPTION 'Producto no encontrado: %', v_product_id;
    END IF;

    IF v_current_stock < v_base_quantity THEN
      RAISE EXCEPTION 'Stock insuficiente para %', v_product_name;
    END IF;
  END LOOP;

  INSERT INTO sales (id, customer_id, user_id, notes, subtotal, tax, discount, total, status)
  VALUES (v_sale_id, p_customer_id, p_user_id, p_notes, v_subtotal, COALESCE(p_tax, 0), COALESCE(p_discount, 0), v_total, 'CONFIRMED');

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := v_item->>'productId';
    v_unit_quantity := COALESCE((v_item->>'unitQuantity')::INT, (v_item->>'quantity')::INT);
    v_unit_factor := COALESCE((v_item->>'unitFactor')::INT, 1);
    v_base_quantity := v_unit_quantity * v_unit_factor;
    v_unit_price := (v_item->>'unitPrice')::DECIMAL;
    v_line_total := v_unit_quantity * v_unit_price;
    v_sale_item_id := gen_random_uuid()::TEXT;

    INSERT INTO sale_items (
      id, sale_id, product_id, quantity, unit_price, line_total,
      product_unit_id, unit_label, unit_factor, unit_quantity
    )
    VALUES (
      v_sale_item_id, v_sale_id, v_product_id, v_base_quantity, v_unit_price, v_line_total,
      v_item->>'productUnitId', COALESCE(v_item->>'unitLabel', 'Unidad'), v_unit_factor, v_unit_quantity
    );

    UPDATE products SET stock = stock - v_base_quantity, updated_at = NOW()
    WHERE id = v_product_id;

    INSERT INTO stock_movements (id, product_id, type, quantity, note, reference_type, reference_id, sale_item_id)
    VALUES (gen_random_uuid()::TEXT, v_product_id, 'SALE', v_base_quantity, 'Venta ' || v_sale_id, 'sale', v_sale_id, v_sale_item_id);
  END LOOP;

  RETURN v_sale_id;
END;
$$;

-- =============================================
-- FUNCIÓN: create_purchase (v2 con soporte de presentaciones)
-- Cada item de p_items ahora puede incluir:
--   productId, unitCost, unitQuantity, unitFactor, unitLabel, productUnitId (opcional)
-- =============================================

CREATE OR REPLACE FUNCTION create_purchase(
  p_supplier_id TEXT,
  p_user_id TEXT,
  p_invoice_number TEXT,
  p_notes TEXT,
  p_tax DECIMAL,
  p_items JSONB
  -- [{ "productId", "unitCost", "unitQuantity", "unitFactor", "unitLabel", "productUnitId" }]
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_purchase_id TEXT := gen_random_uuid()::TEXT;
  v_purchase_item_id TEXT;
  v_subtotal DECIMAL := 0;
  v_total DECIMAL := 0;
  v_item JSONB;
  v_product_id TEXT;
  v_unit_quantity INT;
  v_unit_factor INT;
  v_base_quantity INT;
  v_unit_cost DECIMAL;
  v_base_unit_cost DECIMAL;
  v_line_total DECIMAL;
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_unit_quantity := COALESCE((v_item->>'unitQuantity')::INT, (v_item->>'quantity')::INT);
    v_subtotal := v_subtotal + (v_unit_quantity * (v_item->>'unitCost')::DECIMAL);
  END LOOP;

  v_total := v_subtotal + COALESCE(p_tax, 0);

  INSERT INTO purchases (id, supplier_id, user_id, invoice_number, notes, subtotal, tax, total, status)
  VALUES (v_purchase_id, p_supplier_id, p_user_id, p_invoice_number, p_notes, v_subtotal, COALESCE(p_tax, 0), v_total, 'CONFIRMED');

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := v_item->>'productId';
    v_unit_quantity := COALESCE((v_item->>'unitQuantity')::INT, (v_item->>'quantity')::INT);
    v_unit_factor := COALESCE((v_item->>'unitFactor')::INT, 1);
    v_base_quantity := v_unit_quantity * v_unit_factor;
    v_unit_cost := (v_item->>'unitCost')::DECIMAL;
    v_base_unit_cost := v_unit_cost / v_unit_factor; -- costo unitario en unidades base
    v_line_total := v_unit_quantity * v_unit_cost;
    v_purchase_item_id := gen_random_uuid()::TEXT;

    INSERT INTO purchase_items (
      id, purchase_id, product_id, quantity, unit_cost, line_total,
      product_unit_id, unit_label, unit_factor, unit_quantity
    )
    VALUES (
      v_purchase_item_id, v_purchase_id, v_product_id, v_base_quantity, v_unit_cost, v_line_total,
      v_item->>'productUnitId', COALESCE(v_item->>'unitLabel', 'Unidad'), v_unit_factor, v_unit_quantity
    );

    UPDATE products SET stock = stock + v_base_quantity, cost = v_base_unit_cost, updated_at = NOW()
    WHERE id = v_product_id;

    INSERT INTO stock_movements (id, product_id, type, quantity, note, reference_type, reference_id, purchase_item_id)
    VALUES (gen_random_uuid()::TEXT, v_product_id, 'PURCHASE', v_base_quantity, 'Compra ' || v_purchase_id, 'purchase', v_purchase_id, v_purchase_item_id);
  END LOOP;

  RETURN v_purchase_id;
END;
$$;
