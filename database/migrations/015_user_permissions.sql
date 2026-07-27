-- Migration: 015_user_permissions.sql
-- Agregar columna permissions a la tabla users para control granular de permisos por página

ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT NULL;
