-- Droguería - Presentaciones de producto (unidad, caja x10, caja completa, etc.)
-- Migration: 004_product_units.sql
-- Ejecutar este script en el SQL Editor de Supabase (después de 001, 002 y 003)

-- =============================================
-- TABLA: product_units
-- Presentaciones ADICIONALES a la unidad base del producto.
-- La presentación "Unidad" siempre existe implícitamente usando
-- products.price / products.cost / products.barcode (factor = 1).
-- Aquí solo se guardan presentaciones con factor > 1 (ej. Caja x10).
-- =============================================

CREATE TABLE IF NOT EXISTS product_units (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  product_id TEXT NOT NULL,
  name VARCHAR(50) NOT NULL,          -- 'Caja x10', 'Caja completa', etc.
  factor INT NOT NULL CHECK (factor > 1), -- cuántas unidades base representa
  price DECIMAL(10, 2) NOT NULL,      -- precio de venta de esta presentación
  barcode VARCHAR(100) NULL,          -- código de barras propio de esta presentación
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE INDEX idx_product_units_product_id ON product_units(product_id);
CREATE UNIQUE INDEX idx_product_units_barcode ON product_units(barcode) WHERE barcode IS NOT NULL;

CREATE TRIGGER update_product_units_updated_at BEFORE UPDATE ON product_units
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- Columnas de trazabilidad en items de venta y compra
-- Guardan una "foto" de la presentación usada al momento de la
-- operación (por si luego se edita o elimina la presentación).
-- El campo `quantity` SIEMPRE queda en unidades base (no cambia).
-- =============================================

ALTER TABLE sale_items
  ADD COLUMN IF NOT EXISTS product_unit_id TEXT NULL REFERENCES product_units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unit_label VARCHAR(50) NULL DEFAULT 'Unidad',
  ADD COLUMN IF NOT EXISTS unit_factor INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS unit_quantity INT NOT NULL DEFAULT 1;

ALTER TABLE purchase_items
  ADD COLUMN IF NOT EXISTS product_unit_id TEXT NULL REFERENCES product_units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unit_label VARCHAR(50) NULL DEFAULT 'Unidad',
  ADD COLUMN IF NOT EXISTS unit_factor INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS unit_quantity INT NOT NULL DEFAULT 1;
