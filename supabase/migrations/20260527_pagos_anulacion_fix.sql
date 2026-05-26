-- ============================================================
-- MIGRACIÓN: Soporte completo para anulación de pagos
-- Fecha: 2026-05-27
-- ============================================================

-- ─── 1. imputaciones: agregar 'anulado' como estado válido ───
-- Primero eliminamos el CHECK constraint existente (puede llamarse distinto en cada instancia)
DO $$
DECLARE
  con_name TEXT;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'imputaciones'::regclass AND contype = 'c'
  LIMIT 1;
  IF con_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE imputaciones DROP CONSTRAINT ' || quote_ident(con_name);
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Volvemos a agregar con el set completo de valores
ALTER TABLE imputaciones
  ADD CONSTRAINT imputaciones_estado_check
  CHECK (estado IN ('pendiente', 'confirmado', 'rechazado', 'anulado'));

-- ─── 2. recibos: columnas de anulación ───────────────────────
ALTER TABLE recibos
  ADD COLUMN IF NOT EXISTS estado      VARCHAR(20) DEFAULT 'activo',
  ADD COLUMN IF NOT EXISTS anulado_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS anulado_por UUID REFERENCES auth.users(id);

-- ─── 3. cheques: agregar 'ANULADO' como estado válido ────────
DO $$
DECLARE
  con_name TEXT;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'cheques'::regclass AND contype = 'c'
    AND conname ILIKE '%estado%'
  LIMIT 1;
  IF con_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE cheques DROP CONSTRAINT ' || quote_ident(con_name);
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

ALTER TABLE cheques
  ADD CONSTRAINT cheques_estado_check
  CHECK (estado IN ('EN_CARTERA', 'DEPOSITADO', 'ACREDITADO', 'RECHAZADO', 'DEVUELTO', 'ANULADO'));

-- ─── 4. FK imputaciones.comprobante_id → comprobantes_venta ──
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'imputaciones'
      AND constraint_name = 'imputaciones_comprobante_id_fkey'
  ) THEN
    ALTER TABLE imputaciones
      ADD CONSTRAINT imputaciones_comprobante_id_fkey
      FOREIGN KEY (comprobante_id) REFERENCES comprobantes_venta(id);
  END IF;
END $$;

-- ─── 5. FK imputaciones.pago_id → pagos_clientes ─────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'imputaciones'
      AND constraint_name = 'imputaciones_pago_id_fkey'
  ) THEN
    ALTER TABLE imputaciones
      ADD CONSTRAINT imputaciones_pago_id_fkey
      FOREIGN KEY (pago_id) REFERENCES pagos_clientes(id);
  END IF;
END $$;
