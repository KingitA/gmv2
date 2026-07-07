-- Migration: Auditoría de la ficha del cliente — quién y cuándo la modificó
-- Mismo patrón que 20260417_auditoria.sql (FK opcional a auth.users, sin cascade).

ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS actualizado_por UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS actualizado_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_clientes_actualizado_por ON clientes (actualizado_por);
