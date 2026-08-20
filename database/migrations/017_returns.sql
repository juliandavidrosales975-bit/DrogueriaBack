-- =============================================
-- MIGRACIÓN 017: Devoluciones de ventas
-- Ejecutar en el SQL Editor de Supabase (después de 016)
-- =============================================
--
-- Implementa la funcionalidad de devoluciones parciales:
--   1. Tabla sale_returns: cabecera de la devolución (observación, reembolso, usuario).
--   2. Tabla sale_return_items: cada producto devuelto con su cantidad.
--   3. Nuevos valores en stock_movement_type: RETURN.
--   4. Nuevos valores en sale_status: RETURNED, PARTIAL_RETURN.
--   5. RPC create_return: valida, reintegra stock, registra movimiento y actualiza estado venta.

-- =============================================
-- 1. Nuevos valores de ENUM
-- =============================================

-- Tipo de movimiento de inventario
ALTER TYPE stock_movement_type ADD VALUE IF NOT EXISTS 'RETURN';

-- Estados adicionales para la venta
ALTER TYPE sale_status ADD VALUE IF NOT EXISTS 'RETURNED';
ALTER TYPE sale_status ADD VALUE IF NOT EXISTS 'PARTIAL_RETURN';

-- =============================================
-- 2. Tabla sale_returns
-- =============================================

CREATE TABLE IF NOT EXISTS sale_returns (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  sale_id     TEXT NOT NULL REFERENCES sales(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  store_id    TEXT NOT NULL REFERENCES stores(id),
  notes       TEXT NOT NULL,                           -- observación obligatoria
  total_refund DECIMAL(10, 2) NOT NULL DEFAULT 0,      -- monto total devuelto al cliente
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sale_returns_sale_id   ON sale_returns(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_returns_store_id  ON sale_returns(store_id);
CREATE INDEX IF NOT EXISTS idx_sale_returns_user_id   ON sale_returns(user_id);

-- =============================================
-- 3. Tabla sale_return_items
-- =============================================

CREATE TABLE IF NOT EXISTS sale_return_items (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  return_id     TEXT NOT NULL REFERENCES sale_returns(id) ON DELETE CASCADE,
  sale_item_id  TEXT NOT NULL REFERENCES sale_items(id),
  product_id    TEXT NOT NULL REFERENCES products(id),
  quantity      NUMERIC NOT NULL,         -- unidades BASE devueltas
  unit_quantity NUMERIC NOT NULL,         -- unidades de presentación devueltas
  unit_price    DECIMAL(10, 2) NOT NULL,  -- precio al que se vendió (para calcular reembolso)
  line_total    DECIMAL(10, 2) NOT NULL   -- importe a reembolsar para este ítem
);

CREATE INDEX IF NOT EXISTS idx_sale_return_items_return_id ON sale_return_items(return_id);
CREATE INDEX IF NOT EXISTS idx_sale_return_items_product_id ON sale_return_items(product_id);

-- =============================================
-- 4. RPC create_return
-- =============================================
-- Crea una devolución parcial o total de una venta.
-- Parámetros:
--   p_sale_id   : ID de la venta a devolver.
--   p_user_id   : Usuario que registra la devolución.
--   p_store_id  : Droguería (aislamiento multi-tenant).
--   p_notes     : Observación obligatoria.
--   p_items     : JSONB array de { saleItemId, unitQuantity }
--                 unitQuantity = unidades de presentación a devolver.
-- Retorna: ID de la devolución creada.

CREATE OR REPLACE FUNCTION create_return(
  p_sale_id    TEXT,
  p_user_id    TEXT,
  p_store_id   TEXT,
  p_notes      TEXT,
  p_items      JSONB DEFAULT '[]'::JSONB
) RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_return_id      TEXT;
  v_item           JSONB;
  v_sale_item_id   TEXT;
  v_product_id     TEXT;
  v_unit_quantity  NUMERIC;
  v_unit_factor    NUMERIC;
  v_unit_price     NUMERIC;
  v_base_quantity  NUMERIC;
  v_line_total     NUMERIC;
  v_total_refund   NUMERIC := 0;

  -- Para validar stock y cantidades ya devueltas
  v_sold_unit_qty        NUMERIC;
  v_already_returned_qty NUMERIC;
  v_available_qty        NUMERIC;

  -- Para actualizar el estado de la venta
  v_total_sold_units     NUMERIC;
  v_total_returned_units NUMERIC;
  v_new_status           sale_status;
BEGIN
  -- Validaciones básicas
  IF TRIM(COALESCE(p_notes, '')) = '' THEN
    RAISE EXCEPTION 'La observación de la devolución es obligatoria';
  END IF;

  IF jsonb_array_length(COALESCE(p_items, '[]'::JSONB)) = 0 THEN
    RAISE EXCEPTION 'Debes seleccionar al menos un producto a devolver';
  END IF;

  -- Verificar que la venta existe y pertenece a la droguería
  IF NOT EXISTS (
    SELECT 1 FROM sales WHERE id = p_sale_id AND store_id = p_store_id
  ) THEN
    RAISE EXCEPTION 'Venta no encontrada';
  END IF;

  -- Verificar que la venta no esté cancelada
  IF EXISTS (
    SELECT 1 FROM sales WHERE id = p_sale_id AND status = 'CANCELLED'
  ) THEN
    RAISE EXCEPTION 'No se puede devolver una venta cancelada';
  END IF;

  -- Verificar que la venta no esté totalmente devuelta
  IF EXISTS (
    SELECT 1 FROM sales WHERE id = p_sale_id AND status = 'RETURNED'
  ) THEN
    RAISE EXCEPTION 'Esta venta ya fue devuelta en su totalidad';
  END IF;

  v_return_id := gen_random_uuid()::TEXT;

  -- Crear cabecera de la devolución (total_refund se actualiza al final)
  INSERT INTO sale_returns (id, sale_id, user_id, store_id, notes, total_refund)
  VALUES (v_return_id, p_sale_id, p_user_id, p_store_id, p_notes, 0);

  -- Procesar cada ítem a devolver
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_sale_item_id  := v_item->>'saleItemId';
    v_unit_quantity := (v_item->>'unitQuantity')::NUMERIC;

    IF v_unit_quantity IS NULL OR v_unit_quantity <= 0 THEN
      RAISE EXCEPTION 'La cantidad a devolver debe ser mayor a 0';
    END IF;

    -- Obtener datos del ítem de venta
    SELECT si.product_id, si.unit_factor, si.unit_price, si.unit_quantity
    INTO v_product_id, v_unit_factor, v_unit_price, v_sold_unit_qty
    FROM sale_items si
    WHERE si.id = v_sale_item_id AND si.sale_id = p_sale_id;

    IF v_product_id IS NULL THEN
      RAISE EXCEPTION 'Ítem de venta no encontrado: %', v_sale_item_id;
    END IF;

    -- Calcular cuántas unidades de presentación ya se devolvieron de este ítem
    SELECT COALESCE(SUM(sri.unit_quantity), 0)
    INTO v_already_returned_qty
    FROM sale_return_items sri
    JOIN sale_returns sr ON sr.id = sri.return_id
    WHERE sri.sale_item_id = v_sale_item_id
      AND sr.sale_id = p_sale_id;

    v_available_qty := v_sold_unit_qty - v_already_returned_qty;

    IF v_unit_quantity > v_available_qty THEN
      RAISE EXCEPTION 'No se puede devolver % unidades del ítem (disponibles para devolución: %)',
        v_unit_quantity, v_available_qty;
    END IF;

    -- Calcular cantidades y monto
    v_unit_factor   := COALESCE(v_unit_factor, 1);
    v_base_quantity := v_unit_quantity * v_unit_factor;
    v_line_total    := v_unit_quantity * v_unit_price;
    v_total_refund  := v_total_refund + v_line_total;

    -- Insertar ítem de la devolución
    INSERT INTO sale_return_items (
      id, return_id, sale_item_id, product_id,
      quantity, unit_quantity, unit_price, line_total
    ) VALUES (
      gen_random_uuid()::TEXT, v_return_id, v_sale_item_id, v_product_id,
      v_base_quantity, v_unit_quantity, v_unit_price, v_line_total
    );

    -- Reintegrar stock al inventario
    UPDATE products
    SET stock = stock + v_base_quantity, updated_at = NOW()
    WHERE id = v_product_id;

    -- Registrar movimiento de inventario
    INSERT INTO stock_movements (
      id, product_id, type, quantity, note,
      reference_type, reference_id, store_id
    ) VALUES (
      gen_random_uuid()::TEXT, v_product_id, 'RETURN', v_base_quantity,
      'Devolución #' || v_return_id || ' (venta #' || p_sale_id || ')',
      'return', v_return_id, p_store_id
    );
  END LOOP;

  -- Actualizar monto total de la devolución
  UPDATE sale_returns SET total_refund = v_total_refund WHERE id = v_return_id;

  -- Recalcular estado de la venta:
  -- Sumar total de unidades de presentación vendidas en toda la venta
  SELECT COALESCE(SUM(si.unit_quantity), 0)
  INTO v_total_sold_units
  FROM sale_items si
  WHERE si.sale_id = p_sale_id;

  -- Sumar total de unidades de presentación devueltas (históricas + esta)
  SELECT COALESCE(SUM(sri.unit_quantity), 0)
  INTO v_total_returned_units
  FROM sale_return_items sri
  JOIN sale_returns sr ON sr.id = sri.return_id
  WHERE sr.sale_id = p_sale_id;

  IF v_total_returned_units >= v_total_sold_units THEN
    v_new_status := 'RETURNED';
  ELSE
    v_new_status := 'PARTIAL_RETURN';
  END IF;

  UPDATE sales SET status = v_new_status, updated_at = NOW()
  WHERE id = p_sale_id;

  RETURN v_return_id;
END;
$$;
