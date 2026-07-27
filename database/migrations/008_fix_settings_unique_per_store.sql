-- Droguería - Corrección de unicidad de settings (multi-tenant)
-- Migration: 008_fix_settings_unique_per_store.sql
--
-- La tabla `settings` fue creada con `key VARCHAR(100) UNIQUE NOT NULL` (001_initial_schema.sql),
-- una restricción GLOBAL. Al agregar multi-tenancy (006_multi_tenant.sql) se añadió store_id,
-- pero la unicidad de `key` sigue siendo global. Esto provoca que cualquier droguería distinta
-- a la primera en usar una key (ej. "theme", "branchName", "receipt.storeName") reciba:
--   "duplicate key value violates unique constraint "settings_key_key""
-- al intentar crear/guardar su configuración (POST /api/settings -> 500).
--
-- Esta migración reemplaza la restricción única global por una única compuesta (store_id, key),
-- que es el comportamiento correcto para multi-tenancy.

ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_key_key;

ALTER TABLE settings ADD CONSTRAINT settings_store_id_key_key UNIQUE (store_id, key);
