-- Droguería - Corrección de restricciones UNIQUE globales (multi-tenant)
-- Migration: 010_fix_multi_tenant_unique_constraints.sql
--
-- El esquema original (001_initial_schema.sql) definió `UNIQUE` GLOBAL en varias
-- columnas (code, sku, barcode, document, email, tax_id) antes de que existiera
-- multi-tenancy (006_multi_tenant.sql). Ya se corrigió el mismo problema para
-- `settings` en 008_fix_settings_unique_per_store.sql; esta migración aplica el
-- mismo arreglo a customers, suppliers y products, que sufren el mismo error:
--   "duplicate key value violates unique constraint ..."
-- cuando dos droguerías distintas usan el mismo código/SKU/documento/email,
-- algo perfectamente válido entre tenants distintos.
--
-- Se reemplazan las restricciones UNIQUE globales por restricciones compuestas
-- (store_id, columna), y los índices UNIQUE parciales de barcode se recrean
-- con el mismo alcance. Este script es idempotente: puede ejecutarse varias
-- veces sin fallar si ya se aplicó parcial o totalmente antes.

-- ============== customers ==============
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_code_key;
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_document_key;
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_email_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customers_store_id_code_key'
  ) THEN
    ALTER TABLE customers ADD CONSTRAINT customers_store_id_code_key UNIQUE (store_id, code);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_store_document
  ON customers(store_id, document) WHERE document IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_store_email
  ON customers(store_id, email) WHERE email IS NOT NULL;

-- ============== suppliers ==============
ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS suppliers_code_key;
ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS suppliers_tax_id_key;
ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS suppliers_email_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_store_id_code_key'
  ) THEN
    ALTER TABLE suppliers ADD CONSTRAINT suppliers_store_id_code_key UNIQUE (store_id, code);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_store_tax_id
  ON suppliers(store_id, tax_id) WHERE tax_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_store_email
  ON suppliers(store_id, email) WHERE email IS NOT NULL;

-- ============== products ==============
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_sku_key;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_barcode_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_store_id_sku_key'
  ) THEN
    ALTER TABLE products ADD CONSTRAINT products_store_id_sku_key UNIQUE (store_id, sku);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_store_barcode
  ON products(store_id, barcode) WHERE barcode IS NOT NULL;

-- ============== product_units ==============
-- product_units no tenía store_id propio (se heredaba de su producto padre),
-- pero el índice único de barcode (004_product_units.sql) era global. Se agrega
-- store_id denormalizado para poder acotar correctamente la unicidad por tienda.
ALTER TABLE product_units ADD COLUMN IF NOT EXISTS store_id TEXT REFERENCES stores(id);

UPDATE product_units pu
SET store_id = p.store_id
FROM products p
WHERE p.id = pu.product_id
  AND pu.store_id IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'product_units' AND column_name = 'store_id' AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE product_units ALTER COLUMN store_id SET NOT NULL;
  END IF;
END $$;

DROP INDEX IF EXISTS idx_product_units_barcode;
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_units_store_barcode
  ON product_units(store_id, barcode) WHERE barcode IS NOT NULL;
