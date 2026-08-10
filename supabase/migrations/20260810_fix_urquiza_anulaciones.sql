-- ─────────────────────────────────────────────────────────────────────────────
-- Fix puntual DISTRIBUIDORA URQUIZA (10/08/2026) — doctrina del negocio:
-- "el pago es del cliente, no del comprobante": anular la venta no toca la
-- plata entregada; queda a su favor.
--
-- Qué pasó: se anularon PRES 10 y 11 (nacieron REV 3 y 4, correcto), pero
-- luego se anularon también las REV (nacieron los espejos PRES 12 y 13 —
-- whack-a-mole, ya bloqueado en código) y la anulación de PRES/REV no
-- posteaba el contra-asiento al libro (bug CC_MOVIMIENTO, ya corregido).
--
-- Este script deja el estado final correcto:
--  · PRES 10/11: anulados y saldados (ya están así) — sin cambios.
--  · PRES 12/13 (espejos accidentales): anulados, saldo 0. Sin libro (nunca
--    postearon; son ruido documental neutralizado).
--  · REV 3/4: REHABILITADAS como documentos de crédito vivos — sus saldos
--    (427.287,60 + 4.164.246,40 = 4.591.534) SON la plata del cliente.
--  · Libro mayor: se postean los contra-asientos que faltaron al anular los
--    PRES (haber por REV 3 y REV 4).
--  · REV 1 (bonificación 10%): se anula y se debita del libro — el descuento
--    por pago contado pertenecía a la venta anulada; si queda vivo se le
--    regalan $510.170,48 al cliente. (Si preferís dejárselo, borrá el BLOQUE
--    REV1 antes de correr.)
--  · Ajuste por redondeo de $0,36: se elimina (era de la operación anulada).
--
-- Resultado esperado: saldo real = 1.001.999,52 − 4.591.534 = −3.589.534,48
-- (a favor del cliente, exactamente la plata que entregó).
-- Correr en el SQL Editor. Idempotente por chequeos de estado.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_cli   uuid;
  v_rev3  uuid; v_rev4 uuid; v_rev1 uuid;
  v_saldo numeric;
BEGIN
  SELECT id INTO v_cli FROM clientes WHERE cuit = '30-71417161-1';
  IF v_cli IS NULL THEN RAISE EXCEPTION 'Cliente no encontrado'; END IF;

  SELECT id INTO v_rev3 FROM comprobantes_venta WHERE cliente_id = v_cli AND tipo_comprobante='REV' AND numero_comprobante='0001-00000003';
  SELECT id INTO v_rev4 FROM comprobantes_venta WHERE cliente_id = v_cli AND tipo_comprobante='REV' AND numero_comprobante='0001-00000004';
  SELECT id INTO v_rev1 FROM comprobantes_venta WHERE cliente_id = v_cli AND tipo_comprobante='REV' AND numero_comprobante='0001-00000001';

  -- 1. PRES 12/13: espejos accidentales → anulados, saldo 0
  UPDATE comprobantes_venta
  SET saldo_pendiente = 0, estado_pago = 'pagado', anulado_en = COALESCE(anulado_en, now()),
      observaciones = COALESCE(observaciones,'') || ' — Neutralizado: espejo accidental de anulación de reversa (10/08/2026)'
  WHERE cliente_id = v_cli AND tipo_comprobante = 'PRES'
    AND numero_comprobante IN ('0001-00000012','0001-00000013')
    AND saldo_pendiente <> 0;

  -- 2. REV 3/4: rehabilitar como crédito vivo del cliente
  UPDATE comprobantes_venta
  SET anulado_en = NULL,
      observaciones = COALESCE(observaciones,'') || ' — Rehabilitada: crédito del cliente por anulación de PRES (su pago no se anula)'
  WHERE id IN (v_rev3, v_rev4) AND anulado_en IS NOT NULL;

  -- 3. Libro: contra-asientos de la anulación de PRES 10/11 (faltaron por bug)
  IF NOT EXISTS (SELECT 1 FROM cuenta_corriente_clientes WHERE referencia_tipo='comprobante_venta' AND referencia_id = v_rev3) THEN
    PERFORM cc_postear(v_cli, 'nota_credito', 0, 427287.60, 'comprobante_venta', v_rev3,
      '0001-00000003', 'Anulación REV 0001-00000003 → PRES 0001-00000010 (contra-asiento faltante)', NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cuenta_corriente_clientes WHERE referencia_tipo='comprobante_venta' AND referencia_id = v_rev4) THEN
    PERFORM cc_postear(v_cli, 'nota_credito', 0, 4674417.24, 'comprobante_venta', v_rev4,
      '0001-00000004', 'Anulación REV 0001-00000004 → PRES 0001-00000011 (contra-asiento faltante)', NULL);
  END IF;

  -- 4. BLOQUE REV1: anular la bonificación 10% (la venta bonificada se anuló)
  IF EXISTS (SELECT 1 FROM comprobantes_venta WHERE id = v_rev1 AND anulado_en IS NULL) THEN
    UPDATE comprobantes_venta
    SET anulado_en = now(),
        observaciones = COALESCE(observaciones,'') || ' — Anulada: los PRES bonificados fueron anulados'
    WHERE id = v_rev1;
    PERFORM cc_postear(v_cli, 'nota_debito', 510170.48, 0, 'comprobante_venta', v_rev1,
      '0001-00000001', 'Reversa de bonificación 10% — los PRES bonificados fueron anulados', NULL);
  END IF;

  -- 5. Eliminar el ajuste por redondeo de $0,36 (era de la operación anulada)
  DELETE FROM cuenta_corriente_clientes
  WHERE cliente_id = v_cli AND tipo_movimiento = 'ajuste' AND referencia_tipo = 'ajuste_manual'
    AND haber = 0.36 AND observaciones LIKE 'Ajuste por redondeo — cobro $ 4.591.534%';

  SELECT saldo_actual INTO v_saldo FROM v_saldo_clientes WHERE cliente_id = v_cli;
  RAISE NOTICE 'Saldo real final: % (esperado: -3589534.48)', v_saldo;
END $$;
