-- ============================================================================
-- FIX DE DATOS — DI LUCA ARNALDO ADRIAN: cancelar el par FA ↔ NCA de anulación
--
-- Detectado por el control nuevo (v_cc_reconciliacion v2) apenas se activó:
-- la FA 0007-00000003 fue anulada (15/07) y su NCA espejo 0007-00000004 quedó
-- viva con saldo completo SIN imputarse contra la factura — el mismo bug
-- pre-9f8d4ca que ya se corrigió para Wang (20260805). El libro está bien
-- (debe y haber netean 0); solo falta la imputación que deja ambos saldos en 0.
--
-- Transaccional, idempotente y con asserts. Correr en el SQL Editor.
-- Resultado esperado: Di Luca desaparece de v_cc_reconciliacion (diferencia 0).
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_cliente uuid;
  v_fa   uuid;
  v_nca  uuid;
  v_saldo_fa numeric;
  v_saldo_nca numeric;
  v_dif numeric;
BEGIN
  SELECT id INTO STRICT v_cliente FROM clientes WHERE razon_social = 'DI LUCA ARNALDO ADRIAN';
  SELECT id, saldo_pendiente INTO STRICT v_fa, v_saldo_fa
  FROM comprobantes_venta
  WHERE cliente_id = v_cliente AND tipo_comprobante = 'FA' AND numero_comprobante = '0007-00000003';
  SELECT id, saldo_pendiente INTO STRICT v_nca, v_saldo_nca
  FROM comprobantes_venta
  WHERE cliente_id = v_cliente AND tipo_comprobante = 'NCA' AND numero_comprobante = '0007-00000004';

  -- Idempotencia: si el par ya está cancelado, no hay nada que hacer
  IF v_saldo_fa = 0 AND v_saldo_nca = 0 THEN
    RAISE NOTICE 'DI LUCA: el par ya estaba cancelado — sin cambios';
    RETURN;
  END IF;

  IF v_saldo_fa <> 196436.16 OR v_saldo_nca <> -196436.16 THEN
    RAISE EXCEPTION 'DI LUCA: saldos inesperados (FA %, NCA %) — revisar antes de aplicar', v_saldo_fa, v_saldo_nca;
  END IF;

  -- Cancela FA ↔ NCA: ambos saldos a 0 + rastro en imputaciones (no toca libro)
  PERFORM cc_imputar_credito(v_nca, v_fa, 196436.16, NULL);

  -- Assert: reconciliación en 0 para el cliente
  SELECT diferencia INTO v_dif FROM v_cc_reconciliacion WHERE cliente_id = v_cliente;
  IF COALESCE(abs(v_dif), 0) > 0.005 THEN
    RAISE EXCEPTION 'DI LUCA: la diferencia no quedó en 0 (quedó %)', v_dif;
  END IF;

  RAISE NOTICE 'DI LUCA OK — par cancelado, reconciliación en 0';
END $$;

-- Control global: no debe quedar NINGÚN cliente con descuadre
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM v_cc_reconciliacion WHERE abs(diferencia) > 0.01;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'Quedan % cliente(s) con descuadre — revisar v_cc_reconciliacion', v_n;
  END IF;
  RAISE NOTICE 'Reconciliación limpia: libro == documentos - a cuenta en TODOS los clientes';
END $$;

COMMIT;
