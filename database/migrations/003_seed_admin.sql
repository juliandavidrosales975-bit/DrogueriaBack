-- Droguería - Seed de datos iniciales
-- Migration: 003_seed_admin.sql
-- Ejecutar este script en el SQL Editor de Supabase (después de 001 y 002)

-- =============================================
-- ROLES
-- =============================================

INSERT INTO roles (id, name)
VALUES
  ('role-admin', 'Administrador'),
  ('role-cajero', 'Cajero')
ON CONFLICT (name) DO NOTHING;

-- =============================================
-- USUARIO ADMINISTRADOR
-- Email: admin@drogueria.com
-- Password: Admin123!
-- =============================================

INSERT INTO users (
  id, email, username, full_name,
  password_hash, role_id, status
)
SELECT
  'user-admin',
  'admin@drogueria.com',
  'admin',
  'Administrador',
  '$2a$10$MjlSgYToLBODNEB6eHp.9u3hO3HgW6qG8D.G41Vget.2H.ooOw5Du',
  r.id,
  'ACTIVE'
FROM roles r
WHERE r.name = 'Administrador'
ON CONFLICT (email) DO NOTHING;
