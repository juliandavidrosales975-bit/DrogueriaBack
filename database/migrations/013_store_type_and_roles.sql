-- =============================================
-- MIGRACIÓN 013: Soporte para Tiendas Generales (Multi-Tipo)
-- Ejecutar en el SQL Editor de Supabase
-- =============================================

-- 1. Agregar campo 'type' a la tabla stores
--    DEFAULT 'PHARMACY' para que las droguerías existentes no se vean afectadas
ALTER TABLE stores 
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'PHARMACY'
  CHECK (type IN ('PHARMACY', 'STORE'));

-- Comentario descriptivo
COMMENT ON COLUMN stores.type IS 'Tipo de establecimiento: PHARMACY = Droguería/Farmacia, STORE = Tienda General';

-- 2. Asegurarse que la tienda por defecto tenga type = PHARMACY
UPDATE stores SET type = 'PHARMACY' WHERE id = 'store-default';

-- 3. Insertar nuevos roles para Tiendas Generales (si no existen)
INSERT INTO roles (id, name)
SELECT 'role-store-admin', 'Administrador de Tienda'
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'Administrador de Tienda');

INSERT INTO roles (id, name)
SELECT 'role-seller', 'Vendedor'
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'Vendedor');

-- 4. Verificar resultado
SELECT id, name FROM roles ORDER BY name;
SELECT id, name, type, is_active FROM stores ORDER BY name;
