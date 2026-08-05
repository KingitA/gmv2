-- ─────────────────────────────────────────────────────────────────────────────
-- OP: origen de fondos por medio de pago (elegido al crear la orden)
-- La Nueva OP guarda desde qué banco sale la transferencia y de qué caja el
-- efectivo; el confirmar los lee y no vuelve a preguntar.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE ordenes_pago_detalle
  ADD COLUMN IF NOT EXISTS cuenta_origen_tipo varchar,
  ADD COLUMN IF NOT EXISTS cuenta_origen_id uuid;

ALTER TABLE ordenes_pago_detalle
  DROP CONSTRAINT IF EXISTS ordenes_pago_detalle_cuenta_origen_tipo_check;
ALTER TABLE ordenes_pago_detalle
  ADD CONSTRAINT ordenes_pago_detalle_cuenta_origen_tipo_check
  CHECK (cuenta_origen_tipo IS NULL OR cuenta_origen_tipo IN ('CAJA', 'BANCO'));

COMMENT ON COLUMN ordenes_pago_detalle.cuenta_origen_tipo IS 'CAJA (efectivo) o BANCO (transferencia): de dónde sale la plata de este medio';
COMMENT ON COLUMN ordenes_pago_detalle.cuenta_origen_id IS 'FK lógica a cajas_financieras.id o cuentas_bancarias.id según cuenta_origen_tipo';
