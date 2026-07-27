-- Droguería - Función para vaciar completamente el inventario de una droguería
-- Migration: 011_wipe_inventory.sql
-- Ejecutar este script en el SQL Editor de Supabase

-- =============================================
-- FUNCIÓN: wipe_store_inventory
-- Borra TODO lo relacionado al inventario de una droguería (store_id):
--   - stock_movements
--   - sale_items / sales
--   - purchase_items / purchases
--   - product_units
--   - products
-- Operación DESTRUCTIVA e IRREVERSIBLE. Se ejecuta en una sola transacción:
-- si algo falla, no se borra nada.
-- =============================================

CREATE OR REPLACE FUNCTION wipe_store_inventory(p_store_id TEXT)
RETURNS TABLE (
  deleted_products INT,
  deleted_sales INT,
  deleted_purchases INT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_products INT;
  v_sales INT;
  v_purchases INT;
BEGIN
  IF p_store_id IS NULL OR p_store_id = '' THEN
    RAISE EXCEPTION 'p_store_id es requerido';
  END IF;

  -- 1. Movimientos de inventario de la droguería
  DELETE FROM stock_movements WHERE store_id = p_store_id;

  -- 2. Ítems de venta cuyas ventas pertenecen a la droguería
  DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE store_id = p_store_id);

  -- 3. Ítems de compra cuyas compras pertenecen a la droguería
  DELETE FROM purchase_items WHERE purchase_id IN (SELECT id FROM purchases WHERE store_id = p_store_id);

  -- 4. Cabeceras de ventas y compras
  DELETE FROM sales WHERE store_id = p_store_id;
  GET DIAGNOSTICS v_sales = ROW_COUNT;

  DELETE FROM purchases WHERE store_id = p_store_id;
  GET DIAGNOSTICS v_purchases = ROW_COUNT;

  -- 5. Presentaciones de producto (también caen en cascada al borrar products,
  --    pero se borran explícitamente por claridad)
  DELETE FROM product_units WHERE store_id = p_store_id;

  -- 6. Productos
  DELETE FROM products WHERE store_id = p_store_id;
  GET DIAGNOSTICS v_products = ROW_COUNT;

  RETURN QUERY SELECT v_products, v_sales, v_purchases;
END;
$$;
