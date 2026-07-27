-- Droguería - Apertura y cierre de caja
-- Migration: 012_cash_registers.sql
-- Ejecutar este script en el SQL Editor de Supabase

-- =============================================
-- TIPO ENUM: estado de la caja
-- =============================================
DO $$ BEGIN
  CREATE TYPE cash_register_status AS ENUM ('OPEN', 'CLOSED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- =============================================
-- TABLA: cash_registers
-- Cada fila representa un turno de caja: apertura -> ventas del turno -> cierre.
-- Solo puede existir UNA caja abierta por droguería a la vez (índice único parcial).
-- =============================================

CREATE TABLE IF NOT EXISTS cash_registers (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  store_id TEXT NOT NULL REFERENCES stores(id),
  opened_by_user_id TEXT NOT NULL REFERENCES users(id),
  closed_by_user_id TEXT NULL REFERENCES users(id),
  opening_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
  closing_amount DECIMAL(10, 2) NULL,
  expected_amount DECIMAL(10, 2) NULL, -- opening_amount + total de ventas del turno
  difference DECIMAL(10, 2) NULL,      -- closing_amount - expected_amount
  sales_total DECIMAL(10, 2) NULL,     -- total vendido durante el turno (calculado al cerrar)
  sales_count INT NULL,                -- cantidad de ventas durante el turno
  opening_note TEXT NULL,
  closing_note TEXT NULL,
  status cash_register_status NOT NULL DEFAULT 'OPEN',
  opened_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cash_registers_store_id ON cash_registers(store_id);
CREATE INDEX IF NOT EXISTS idx_cash_registers_opened_by ON cash_registers(opened_by_user_id);
CREATE INDEX IF NOT EXISTS idx_cash_registers_status ON cash_registers(status);

-- Solo una caja ABIERTA por droguería a la vez
CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_registers_one_open_per_store
  ON cash_registers(store_id)
  WHERE status = 'OPEN';

CREATE TRIGGER update_cash_registers_updated_at BEFORE UPDATE ON cash_registers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
