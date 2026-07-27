-- Droguería - Costo por presentación (product_units)
-- Migration: 009_add_cost_to_product_units.sql
--
-- La tabla product_units (004_product_units.sql) solo tenía `price` (precio de
-- venta) para presentaciones como "Caja x10". No existía un costo propio por
-- presentación, así que no se podía calcular el margen de cada presentación
-- de forma independiente a la unidad base.
--
-- Esta migración agrega `cost` (costo de adquisición de esa presentación).
-- Se rellena con un valor por defecto razonable para filas existentes
-- (costo de la unidad base * factor) y luego se deja NOT NULL con default 0.

ALTER TABLE product_units ADD COLUMN IF NOT EXISTS cost DECIMAL(10, 2) NOT NULL DEFAULT 0;

-- Rellenar presentaciones existentes con una estimación (costo unidad base * factor)
UPDATE product_units pu
SET cost = ROUND(p.cost * pu.factor, 2)
FROM products p
WHERE p.id = pu.product_id
  AND pu.cost = 0;
