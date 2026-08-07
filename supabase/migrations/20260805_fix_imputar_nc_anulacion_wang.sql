-- ─────────────────────────────────────────────────────────────────────────────
-- Fix puntual (05/08/2026): cancelar entre sí la FA 0007-00000004 y su NC de
-- anulación 0007-00000003 (cliente WANG ZHI BIN), que quedaron ambas
-- "pendientes" con saldo porque la anulación no imputaba la NC inversa contra
-- el original. El código ya lo hace automáticamente para futuras anulaciones
-- (commit 9f8d4ca); esto arregla el par existente.
-- Usa cc_imputar_credito: solo aplica saldos (no toca libro mayor ni kardex).
-- Correr en el SQL Editor de Supabase. Idempotente: si ya están en 0, avisa.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_fa uuid;
  v_nc uuid;
  v_resultado jsonb;
BEGIN
  SELECT id INTO v_fa
  FROM comprobantes_venta
  WHERE tipo_comprobante = 'FA' AND numero_comprobante = '0007-00000004'
    AND anulado_en IS NOT NULL;

  SELECT id INTO v_nc
  FROM comprobantes_venta
  WHERE tipo_comprobante IN ('NC','NCA') AND numero_comprobante = '0007-00000003';

  IF v_fa IS NULL OR v_nc IS NULL THEN
    RAISE NOTICE 'No se encontró el par FA 0007-00000004 (anulada) / NC 0007-00000003 — nada que hacer.';
    RETURN;
  END IF;

  IF (SELECT saldo_pendiente FROM comprobantes_venta WHERE id = v_fa) <= 0 THEN
    RAISE NOTICE 'La FA ya está saldada — nada que hacer.';
    RETURN;
  END IF;

  v_resultado := cc_imputar_credito(v_nc, v_fa, NULL, NULL);
  RAISE NOTICE 'Imputado: %', v_resultado;
END $$;
