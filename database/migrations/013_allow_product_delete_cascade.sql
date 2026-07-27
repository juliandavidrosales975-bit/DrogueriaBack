-- =============================================
-- MIGRACIÓN 013: Permitir eliminar productos con historial (borrado en cascada)
-- Ejecutar en el SQL Editor de Supabase
-- =============================================
--
-- Contexto: al iniciar el uso del sistema se necesita poder limpiar productos
-- de prueba/mal cargados aunque ya tengan ventas, compras o movimientos de
-- inventario asociados. Antes, `products.delete()` bloqueaba esa operación
-- (ver product.repository.ts) para no dejar referencias huérfanas.
--
-- Esta migración cambia las llaves foráneas de sale_items, purchase_items y
-- stock_movements hacia products para que sean ON DELETE CASCADE: al borrar
-- un producto, se borran automáticamente sus líneas de venta/compra y sus
-- movimientos de inventario relacionados.
--
-- ADVERTENCIA: esto es IRREVERSIBLE y afecta el histórico. Si una venta tenía
-- 3 productos y se borra 1, esa venta queda con 2 líneas pero su columna
-- `total` seguirá reflejando el monto original (no se recalcula). Úsese solo
-- como limpieza de datos de arranque, no como operación rutinaria.

-- sale_items.product_id -> products.id
ALTER TABLE sale_items DROP CONSTRAINT IF EXISTS sale_items_product_id_fkey;
ALTER TABLE sale_items
  ADD CONSTRAINT sale_items_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;

-- purchase_items.product_id -> products.id
ALTER TABLE purchase_items DROP CONSTRAINT IF EXISTS purchase_items_product_id_fkey;
ALTER TABLE purchase_items
  ADD CONSTRAINT purchase_items_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;

-- stock_movements.product_id -> products.id
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_product_id_fkey;
ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
