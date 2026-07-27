-- =============================================
-- MIGRACIÓN 016: Edición de compras + precio de venta en la compra + rentabilidad (COGS)
-- Ejecutar en el SQL Editor de Supabase (después de 015)
-- =============================================
--
-- Resuelve tres necesidades:
--
--   1. Editar una compra ya registrada (agregar/quitar productos, cambiar
--      cantidades y costos) revirtiendo el stock correctamente → RPC update_purchase.
--   2. Poder fijar el PRECIO DE VENTA de cada producto/presentación desde la
--      misma compra (campo `salePrice` en los ítems) → create_purchase / update_purchase.
--   3. Calcular la utilidad real: Utilidad = Ventas - COGS. Para eso sale_items
--      necesita una "foto" del costo al momento de vender (`unit_cost`), porque
--      products.cost cambia con cada compra → store_profit_summary / store_profit_daily.
--
-- Zona horaria: los cortes por día se hacen en 'America/Bogota' para que el
-- "día de hoy" del backend coincida con el del navegador del usuario.

-- =============================================
-- 1. Columnas nuevas
-- =============================================

-- Costo unitario (en UNIDADES BASE) al momento de la venta. Sin esto el COGS
-- tendría que usar products.cost actual, que ya cambió con las compras posteriores.
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS unit_cost DECIMAL(10, 2) NOT NULL DEFAULT 0;

-- Precio de venta aplicado al producto/presentación durante la compra (trazabilidad).
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS sale_price DECIMAL(10, 2) NULL;

-- Backfill: para las ventas históricas se usa el costo actual del producto como
-- mejor aproximación disponible (no hay forma de reconstruir el costo exacto).
UPDATE sale_items si
SET unit_cost = p.cost
FROM products p
WHERE p.id = si.product_id
  AND si.unit_cost = 0;

-- =============================================
-- 2. Limpieza de firmas antiguas de las RPC
-- =============================================
-- Quedaron sobrecargas de migraciones previas (005 con 6 params). Se eliminan
-- para evitar el error "Could not choose the best candidate function".
DROP FUNCTION IF EXISTS create_purchase(TEXT, TEXT, TEXT, TEXT, NUMERIC, JSONB);
DROP FUNCTION IF EXISTS create_sale(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, JSONB);

-- =============================================
-- 3. create_sale: guarda el costo base de cada ítem (para el COGS)
-- =============================================
-- Misma firma que 014 (8 params) → CREATE OR REPLACE es suficiente.
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
  v_base_cost NUMERIC;
  v_subtotal NUMERIC := 0;
  v_total NUMERIC := 0;
BEGIN
  v_sale_id := gen_random_uuid()::TEXT;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_unit_quantity := (v_item->>'unitQuantity')::NUMERIC;
    v_unit_price    := (v_item->>'unitPrice')::NUMERIC;
    v_subtotal      := v_subtotal + (v_unit_quantity * v_unit_price);
  END LOOP;

  v_total := v_subtotal + COALESCE(p_tax, 0) - COALESCE(p_discount, 0);

  INSERT INTO sales (id, customer_id, user_id, notes, subtotal, tax, discount, total, status, store_id, payment_method)
  VALUES (
    v_sale_id, p_customer_id, p_user_id, p_notes, v_subtotal, COALESCE(p_tax, 0), COALESCE(p_discount, 0), v_total,
    'CONFIRMED', p_store_id, COALESCE(p_payment_method, 'CASH')::payment_method
  );

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

    -- Se lee stock y costo base en la misma consulta: el costo se congela en la
    -- línea de venta para poder calcular el COGS aunque el producto se recompre.
    SELECT stock, cost INTO v_current_stock, v_base_cost FROM products WHERE id = v_product_id;
    IF v_current_stock IS NULL THEN
      RAISE EXCEPTION 'Producto no encontrado: %', v_product_id;
    END IF;
    IF v_current_stock < v_base_quantity THEN
      RAISE EXCEPTION 'Stock insuficiente para el producto %', v_product_id;
    END IF;

    INSERT INTO sale_items (
      id, sale_id, product_id, quantity, unit_price, line_total,
      unit_label, unit_factor, unit_quantity, product_unit_id, unit_cost
    ) VALUES (
      gen_random_uuid()::TEXT, v_sale_id, v_product_id,
      v_base_quantity, v_unit_price, v_line_total,
      v_unit_label, v_unit_factor, v_unit_quantity, v_unit_id, COALESCE(v_base_cost, 0)
    );

    UPDATE products SET stock = stock - v_base_quantity, updated_at = NOW()
    WHERE id = v_product_id;

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
-- 4. create_purchase: acepta `salePrice` por ítem
-- =============================================
-- Misma firma que 014 (9 params). Ahora cada ítem de p_items puede incluir
-- "salePrice": si viene con valor > 0 se actualiza el precio de venta del
-- producto (presentación base) o de la presentación comprada.
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
  v_item_id TEXT;
  v_product_id TEXT;
  v_unit_quantity NUMERIC;
  v_unit_cost NUMERIC;
  v_unit_factor NUMERIC;
  v_unit_label TEXT;
  v_unit_id TEXT;
  v_sale_price NUMERIC;
  v_base_quantity NUMERIC;
  v_base_unit_cost NUMERIC;
  v_line_total NUMERIC;
  v_subtotal NUMERIC := 0;
  v_total NUMERIC := 0;
  v_payment_status purchase_payment_status;
  v_amount_paid NUMERIC;
BEGIN
  v_purchase_id := gen_random_uuid()::TEXT;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_unit_quantity := (v_item->>'unitQuantity')::NUMERIC;
    v_unit_cost     := (v_item->>'unitCost')::NUMERIC;
    v_subtotal      := v_subtotal + (v_unit_quantity * v_unit_cost);
  END LOOP;

  v_total := v_subtotal + COALESCE(p_tax, 0);

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
    v_payment_status := 'PAID';
    v_amount_paid := v_total;
  END IF;

  INSERT INTO purchases (
    id, supplier_id, user_id, invoice_number, notes, subtotal, tax, total, status, store_id,
    payment_status, amount_paid
  )
  VALUES (
    v_purchase_id, p_supplier_id, p_user_id, p_invoice_number, p_notes, v_subtotal, COALESCE(p_tax, 0), v_total,
    'CONFIRMED', p_store_id, v_payment_status, v_amount_paid
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id    := v_item->>'productId';
    v_unit_quantity := (v_item->>'unitQuantity')::NUMERIC;
    v_unit_cost     := (v_item->>'unitCost')::NUMERIC;
    v_unit_factor   := COALESCE((v_item->>'unitFactor')::NUMERIC, 1);
    v_unit_label    := COALESCE(v_item->>'unitLabel', 'Unidad');
    v_unit_id       := v_item->>'productUnitId';
    IF v_unit_id = 'null' OR v_unit_id = '' THEN v_unit_id := NULL; END IF;
    v_sale_price := NULLIF(v_item->>'salePrice', '')::NUMERIC;

    v_base_quantity  := v_unit_quantity * v_unit_factor;
    v_base_unit_cost := v_unit_cost / v_unit_factor;
    v_line_total     := v_unit_quantity * v_unit_cost;
    v_item_id        := gen_random_uuid()::TEXT;

    INSERT INTO purchase_items (
      id, purchase_id, product_id, quantity, unit_cost, line_total,
      unit_label, unit_factor, unit_quantity, product_unit_id, sale_price
    ) VALUES (
      v_item_id, v_purchase_id, v_product_id,
      v_base_quantity, v_unit_cost, v_line_total,
      v_unit_label, v_unit_factor, v_unit_quantity, v_unit_id, v_sale_price
    );

    -- Stock y costo base (el costo base siempre refleja la última compra)
    UPDATE products SET stock = stock + v_base_quantity, cost = v_base_unit_cost, updated_at = NOW()
    WHERE id = v_product_id;

    -- Costo propio de la presentación comprada
    IF v_unit_id IS NOT NULL THEN
      UPDATE product_units SET cost = v_unit_cost, updated_at = NOW() WHERE id = v_unit_id;
    END IF;

    -- Precio de venta opcional: evita tener que ir al producto a cambiarlo aparte
    IF v_sale_price IS NOT NULL AND v_sale_price > 0 THEN
      IF v_unit_id IS NULL THEN
        UPDATE products SET price = v_sale_price, updated_at = NOW() WHERE id = v_product_id;
      ELSE
        UPDATE product_units SET price = v_sale_price, updated_at = NOW() WHERE id = v_unit_id;
      END IF;
    END IF;

    INSERT INTO stock_movements (id, product_id, type, quantity, note, reference_type, reference_id, store_id, purchase_item_id)
    VALUES (
      gen_random_uuid()::TEXT, v_product_id, 'PURCHASE', v_base_quantity,
      'Compra #' || v_purchase_id, 'purchase', v_purchase_id, p_store_id, v_item_id
    );
  END LOOP;

  RETURN v_purchase_id;
END;
$$;

-- =============================================
-- 5. update_purchase: editar una compra ya registrada
-- =============================================
-- Reemplaza por completo los ítems de la compra y ajusta el inventario por
-- DIFERENCIA NETA por producto (nuevo - anterior), no revirtiendo y volviendo a
-- sumar: así subir la cantidad de 10 a 12 no falla por un negativo intermedio.
--
-- Reglas de negocio implementadas:
--   * La compra debe pertenecer a la droguería (store_id) del usuario.
--   * Todos los productos deben existir en esa misma droguería.
--   * Si al editar el stock de algún producto quedaría NEGATIVO (porque ya se
--     vendió mercancía de esa compra), la operación se rechaza completa.
--   * Los abonos ya registrados (supplier_payments) se respetan: no se puede
--     dejar la compra con amount_paid menor a lo efectivamente pagado.
--   * Todo ocurre en una sola transacción: si algo falla, no cambia nada.
CREATE OR REPLACE FUNCTION update_purchase(
  p_purchase_id TEXT,
  p_store_id TEXT,
  p_user_id TEXT,
  p_supplier_id TEXT,
  p_invoice_number TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_tax NUMERIC DEFAULT 0,
  p_items JSONB DEFAULT '[]'::JSONB,
  p_payment_status TEXT DEFAULT NULL,
  p_amount_paid NUMERIC DEFAULT NULL
) RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_purchase purchases;
  v_item JSONB;
  v_item_id TEXT;
  v_product_id TEXT;
  v_unit_quantity NUMERIC;
  v_unit_cost NUMERIC;
  v_unit_factor NUMERIC;
  v_unit_label TEXT;
  v_unit_id TEXT;
  v_sale_price NUMERIC;
  v_base_quantity NUMERIC;
  v_base_unit_cost NUMERIC;
  v_line_total NUMERIC;
  v_subtotal NUMERIC := 0;
  v_total NUMERIC := 0;
  v_negative TEXT;
  v_registered NUMERIC;
  v_payment_status purchase_payment_status;
  v_amount_paid NUMERIC;
  v_requested_status TEXT;
BEGIN
  IF jsonb_array_length(COALESCE(p_items, '[]'::JSONB)) = 0 THEN
    RAISE EXCEPTION 'La compra debe incluir al menos un ítem';
  END IF;

  -- Bloquea la cabecera para evitar ediciones concurrentes sobre la misma compra
  SELECT * INTO v_purchase
  FROM purchases
  WHERE id = p_purchase_id AND store_id = p_store_id
  FOR UPDATE;

  IF v_purchase.id IS NULL THEN
    RAISE EXCEPTION 'Compra no encontrada';
  END IF;

  IF p_supplier_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM suppliers WHERE id = p_supplier_id AND store_id = p_store_id
  ) THEN
    RAISE EXCEPTION 'Proveedor no encontrado en esta droguería';
  END IF;

  -- Validar que todos los productos existan en la droguería
  SELECT string_agg(DISTINCT it->>'productId', ', ') INTO v_negative
  FROM jsonb_array_elements(p_items) it
  WHERE NOT EXISTS (
    SELECT 1 FROM products p WHERE p.id = it->>'productId' AND p.store_id = p_store_id
  );
  IF v_negative IS NOT NULL THEN
    RAISE EXCEPTION 'Productos inexistentes en esta droguería: %', v_negative;
  END IF;

  -- Ajuste de inventario por diferencia neta (nuevas cantidades - anteriores)
  WITH old_q AS (
    SELECT product_id, SUM(quantity)::NUMERIC AS qty
    FROM purchase_items
    WHERE purchase_id = p_purchase_id
    GROUP BY product_id
  ),
  new_q AS (
    SELECT it->>'productId' AS product_id,
           SUM((it->>'unitQuantity')::NUMERIC * COALESCE((it->>'unitFactor')::NUMERIC, 1)) AS qty
    FROM jsonb_array_elements(p_items) it
    GROUP BY 1
  ),
  delta AS (
    SELECT COALESCE(o.product_id, n.product_id) AS product_id,
           COALESCE(n.qty, 0) - COALESCE(o.qty, 0) AS diff
    FROM old_q o
    FULL OUTER JOIN new_q n ON n.product_id = o.product_id
  )
  UPDATE products p
  SET stock = p.stock + d.diff, updated_at = NOW()
  FROM delta d
  WHERE p.id = d.product_id AND p.store_id = p_store_id AND d.diff <> 0;

  -- Si algún producto involucrado quedó en negativo, la mercancía ya se vendió:
  -- no se puede editar (el RAISE revierte toda la transacción, incluido el stock)
  SELECT string_agg(DISTINCT p.name, ', ') INTO v_negative
  FROM products p
  WHERE p.store_id = p_store_id
    AND p.stock < 0
    AND (
      p.id IN (SELECT product_id FROM purchase_items WHERE purchase_id = p_purchase_id)
      OR p.id IN (SELECT it->>'productId' FROM jsonb_array_elements(p_items) it)
    );

  IF v_negative IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede editar la compra: el stock quedaría negativo en %. Ya se vendieron unidades que ingresaron con esta compra.', v_negative;
  END IF;

  -- Borrar los movimientos e ítems anteriores (el stock ya quedó ajustado arriba)
  DELETE FROM stock_movements
  WHERE reference_type = 'purchase' AND reference_id = p_purchase_id;

  DELETE FROM purchase_items WHERE purchase_id = p_purchase_id;

  -- Reinsertar los ítems enviados
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id    := v_item->>'productId';
    v_unit_quantity := (v_item->>'unitQuantity')::NUMERIC;
    v_unit_cost     := (v_item->>'unitCost')::NUMERIC;
    v_unit_factor   := COALESCE((v_item->>'unitFactor')::NUMERIC, 1);
    v_unit_label    := COALESCE(v_item->>'unitLabel', 'Unidad');
    v_unit_id       := v_item->>'productUnitId';
    IF v_unit_id = 'null' OR v_unit_id = '' THEN v_unit_id := NULL; END IF;
    v_sale_price := NULLIF(v_item->>'salePrice', '')::NUMERIC;

    IF v_unit_quantity IS NULL OR v_unit_quantity <= 0 THEN
      RAISE EXCEPTION 'La cantidad de cada ítem debe ser mayor a 0';
    END IF;
    IF v_unit_cost IS NULL OR v_unit_cost < 0 THEN
      RAISE EXCEPTION 'El costo de cada ítem no puede ser negativo';
    END IF;

    v_base_quantity  := v_unit_quantity * v_unit_factor;
    v_base_unit_cost := v_unit_cost / v_unit_factor;
    v_line_total     := v_unit_quantity * v_unit_cost;
    v_subtotal       := v_subtotal + v_line_total;
    v_item_id        := gen_random_uuid()::TEXT;

    INSERT INTO purchase_items (
      id, purchase_id, product_id, quantity, unit_cost, line_total,
      unit_label, unit_factor, unit_quantity, product_unit_id, sale_price
    ) VALUES (
      v_item_id, p_purchase_id, v_product_id,
      v_base_quantity, v_unit_cost, v_line_total,
      v_unit_label, v_unit_factor, v_unit_quantity, v_unit_id, v_sale_price
    );

    -- El costo del producto refleja el costo de esta compra (ya editado)
    UPDATE products SET cost = v_base_unit_cost, updated_at = NOW() WHERE id = v_product_id;

    IF v_unit_id IS NOT NULL THEN
      UPDATE product_units SET cost = v_unit_cost, updated_at = NOW() WHERE id = v_unit_id;
    END IF;

    IF v_sale_price IS NOT NULL AND v_sale_price > 0 THEN
      IF v_unit_id IS NULL THEN
        UPDATE products SET price = v_sale_price, updated_at = NOW() WHERE id = v_product_id;
      ELSE
        UPDATE product_units SET price = v_sale_price, updated_at = NOW() WHERE id = v_unit_id;
      END IF;
    END IF;

    INSERT INTO stock_movements (id, product_id, type, quantity, note, reference_type, reference_id, store_id, purchase_item_id)
    VALUES (
      gen_random_uuid()::TEXT, v_product_id, 'PURCHASE', v_base_quantity,
      'Compra #' || p_purchase_id || ' (editada)', 'purchase', p_purchase_id, p_store_id, v_item_id
    );
  END LOOP;

  v_total := v_subtotal + COALESCE(p_tax, 0);

  -- Abonos realmente registrados en el historial de pagos
  SELECT COALESCE(SUM(amount), 0) INTO v_registered
  FROM supplier_payments WHERE purchase_id = p_purchase_id;

  v_requested_status := COALESCE(p_payment_status, v_purchase.payment_status::TEXT);

  IF v_requested_status = 'PENDING' THEN
    IF v_registered > 0 THEN
      -- Hay abonos registrados: no puede volver a "Pendiente" sin saldo pagado
      v_amount_paid := LEAST(v_registered, v_total);
      v_payment_status := CASE WHEN v_amount_paid >= v_total THEN 'PAID' ELSE 'PARTIAL' END;
    ELSE
      v_payment_status := 'PENDING';
      v_amount_paid := 0;
    END IF;
  ELSIF v_requested_status = 'PARTIAL' THEN
    v_amount_paid := COALESCE(p_amount_paid, v_purchase.amount_paid);
    IF v_amount_paid < v_registered THEN
      RAISE EXCEPTION 'El monto abonado (%) no puede ser menor a los pagos ya registrados (%)', v_amount_paid, v_registered;
    END IF;
    IF v_amount_paid >= v_total THEN
      v_payment_status := 'PAID';
      v_amount_paid := v_total;
    ELSIF v_amount_paid <= 0 THEN
      v_payment_status := 'PENDING';
      v_amount_paid := 0;
    ELSE
      v_payment_status := 'PARTIAL';
    END IF;
  ELSE
    v_payment_status := 'PAID';
    v_amount_paid := v_total;
  END IF;

  UPDATE purchases
  SET supplier_id = p_supplier_id,
      invoice_number = p_invoice_number,
      notes = p_notes,
      subtotal = v_subtotal,
      tax = COALESCE(p_tax, 0),
      total = v_total,
      payment_status = v_payment_status,
      amount_paid = v_amount_paid,
      updated_at = NOW()
  WHERE id = p_purchase_id AND store_id = p_store_id;

  RETURN p_purchase_id;
END;
$$;

-- =============================================
-- 6. Rentabilidad: Utilidad = Ventas - COGS
-- =============================================
-- COGS = suma de (unidades base vendidas * costo unitario congelado en la venta).
-- Si una venta antigua no tiene costo congelado se cae al costo actual del producto.
CREATE OR REPLACE FUNCTION store_profit_summary(
  p_store_id TEXT,
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL
) RETURNS TABLE (
  sales_total NUMERIC,
  cogs NUMERIC,
  profit NUMERIC,
  sales_count INT,
  purchases_total NUMERIC
)
LANGUAGE plpgsql
STABLE
-- Nota: las columnas de RETURNS TABLE también son variables en plpgsql, así que
-- se usa #variable_conflict para que los nombres repetidos se resuelvan como
-- columnas de la consulta.
AS $$
#variable_conflict use_column
DECLARE
  v_from TIMESTAMPTZ;
  v_to TIMESTAMPTZ;
BEGIN
  v_from := COALESCE(p_from, (NOW() AT TIME ZONE 'America/Bogota')::DATE)::TIMESTAMP
              AT TIME ZONE 'America/Bogota';
  v_to := (COALESCE(p_to, (NOW() AT TIME ZONE 'America/Bogota')::DATE) + 1)::TIMESTAMP
              AT TIME ZONE 'America/Bogota';

  RETURN QUERY
  WITH sold AS (
    SELECT s.id AS sale_id, s.total AS sale_amount
    FROM sales s
    WHERE s.store_id = p_store_id
      AND s.created_at >= v_from
      AND s.created_at < v_to
      AND s.status <> 'CANCELLED'
  ),
  cost AS (
    SELECT COALESCE(SUM(si.quantity * COALESCE(NULLIF(si.unit_cost, 0), p.cost, 0)), 0) AS cost_amount
    FROM sale_items si
    JOIN sold ON sold.sale_id = si.sale_id
    LEFT JOIN products p ON p.id = si.product_id
  ),
  bought AS (
    SELECT COALESCE(SUM(pu.total), 0) AS purchase_amount
    FROM purchases pu
    WHERE pu.store_id = p_store_id
      AND pu.created_at >= v_from
      AND pu.created_at < v_to
  )
  SELECT
    COALESCE((SELECT SUM(sale_amount) FROM sold), 0)::NUMERIC,
    (SELECT cost_amount FROM cost)::NUMERIC,
    (COALESCE((SELECT SUM(sale_amount) FROM sold), 0) - (SELECT cost_amount FROM cost))::NUMERIC,
    (SELECT COUNT(*) FROM sold)::INT,
    (SELECT purchase_amount FROM bought)::NUMERIC;
END;
$$;

-- Serie diaria (últimos N días, incluyendo días sin ventas) para gráficos.
CREATE OR REPLACE FUNCTION store_profit_daily(
  p_store_id TEXT,
  p_days INT DEFAULT 14
) RETURNS TABLE (
  day DATE,
  sales_total NUMERIC,
  cogs NUMERIC,
  profit NUMERIC
)
LANGUAGE plpgsql
STABLE
AS $$
#variable_conflict use_column
DECLARE
  v_days INT := GREATEST(COALESCE(p_days, 14), 1);
  v_today DATE := (NOW() AT TIME ZONE 'America/Bogota')::DATE;
  v_start DATE;
BEGIN
  v_start := v_today - (v_days - 1);

  RETURN QUERY
  WITH calendar AS (
    SELECT generate_series(v_start, v_today, INTERVAL '1 day')::DATE AS cal_day
  ),
  sold AS (
    SELECT s.id AS sale_id,
           s.total AS sale_amount,
           (s.created_at AT TIME ZONE 'America/Bogota')::DATE AS sale_day
    FROM sales s
    WHERE s.store_id = p_store_id
      AND s.created_at >= (v_start::TIMESTAMP AT TIME ZONE 'America/Bogota')
      AND s.status <> 'CANCELLED'
  ),
  totals AS (
    SELECT sale_day, SUM(sale_amount) AS sales_amount FROM sold GROUP BY sale_day
  ),
  costs AS (
    SELECT sold.sale_day, SUM(si.quantity * COALESCE(NULLIF(si.unit_cost, 0), p.cost, 0)) AS cost_amount
    FROM sale_items si
    JOIN sold ON sold.sale_id = si.sale_id
    LEFT JOIN products p ON p.id = si.product_id
    GROUP BY sold.sale_day
  )
  SELECT cal.cal_day,
         COALESCE(t.sales_amount, 0)::NUMERIC,
         COALESCE(c.cost_amount, 0)::NUMERIC,
         (COALESCE(t.sales_amount, 0) - COALESCE(c.cost_amount, 0))::NUMERIC
  FROM calendar cal
  LEFT JOIN totals t ON t.sale_day = cal.cal_day
  LEFT JOIN costs c ON c.sale_day = cal.cal_day
  ORDER BY cal.cal_day;
END;
$$;
