-- ============================================================
-- MIGRACIÓN: Auditoría de pagos + soporte anulación
-- Fecha: 2026-05-27
-- ============================================================

-- ─── Extender pagos_clientes con auditoría ──────────────────
ALTER TABLE pagos_clientes
  ADD COLUMN IF NOT EXISTS creado_por    UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS anulado_por   UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS anulado_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS motivo_anulacion TEXT;

-- ─── Índices para consultas por operador ────────────────────
CREATE INDEX IF NOT EXISTS idx_pagos_clientes_creado_por  ON pagos_clientes (creado_por);
CREATE INDEX IF NOT EXISTS idx_pagos_clientes_anulado_por ON pagos_clientes (anulado_por);
CREATE INDEX IF NOT EXISTS idx_pagos_clientes_estado      ON pagos_clientes (estado);
