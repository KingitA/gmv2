-- ============================================================================
-- RESET DE DATOS DE PRUEBA — deja el sistema limpio para probar en serio
-- (aprobado 11/08/2026, pre-producción)
--
-- CONSERVA (lo único real):
--   · Los 8 documentos fiscales PV 0007: FA 0007-1/2/3/4 + NCA 0007-1/2/3/4
--     (con CAE), sus detalles, sus 6 imputaciones de cancelación FA↔NCA y sus
--     asientos en el libro mayor (netean $0 por cliente).
--   · La cartera de cheques real (~425) — solo se borran los 5 nacidos de
--     pagos de prueba.
--   · Pedidos, artículos, clientes, comisiones de pedidos reales, extractos.
--
-- BORRA (todo lo demás, que es prueba):
--   · 13 PRES + 4 REV (PV 0001) con detalles, comisiones y vínculos.
--   · Los 39 pagos con recibos, imputaciones, fotos, depósitos y billetera.
--   · Devoluciones de prueba (13).
--   · TODO el kardex contable y saldos financieros a $0 (los volvés a cargar
--     con tu ajuste manual diario de cajas, que sigue funcionando igual).
--   · Numeración interna PRES/REV (PV 0001) vuelve a 0. La fiscal NO se toca.
--
-- Transaccional: si un assert falla, no se aplica nada.
-- ============================================================================

BEGIN;

-- ── 0. Pre-asserts: el conjunto "real" es exactamente el esperado ──
DO $$
DECLARE v_reales int; v_otros_pv text;
BEGIN
  SELECT count(*) INTO v_reales FROM comprobantes_venta WHERE punto_venta = '0007';
  IF v_reales <> 8 THEN
    RAISE EXCEPTION 'Se esperaban 8 comprobantes PV 0007, hay % — revisar antes de resetear', v_reales;
  END IF;
  SELECT string_agg(DISTINCT punto_venta, ',') INTO v_otros_pv
  FROM comprobantes_venta WHERE punto_venta NOT IN ('0001', '0007');
  IF v_otros_pv IS NOT NULL THEN
    RAISE EXCEPTION 'Hay comprobantes en punto(s) de venta inesperado(s): % — revisar', v_otros_pv;
  END IF;
END $$;

-- Los comprobantes de prueba y los cheques de pagos, capturados ANTES de borrar
CREATE TEMP TABLE _prueba_comprobantes AS
  SELECT id FROM comprobantes_venta WHERE punto_venta <> '0007';
CREATE TEMP TABLE _cheques_de_pagos AS
  SELECT cheque_id AS id FROM pagos_detalle WHERE cheque_id IS NOT NULL
  UNION
  SELECT cheque_id FROM pago_deposito_items WHERE cheque_id IS NOT NULL;

-- ── 1. Circuito de pagos (todo es prueba) ──
-- Rendiciones primero: referencian pagos por FK. (Tienen RLS: el usuario
-- readonly de la auditoría las veía vacías, pero acá corre como admin.)
DELETE FROM rendicion_items;
DELETE FROM rendiciones;

DELETE FROM imputaciones
WHERE pago_id IS NOT NULL
   OR comprobante_id IN (SELECT id FROM _prueba_comprobantes)
   OR credito_comprobante_id IN (SELECT id FROM _prueba_comprobantes);
-- (sobreviven solo las 6 imputaciones reales de los pares FA↔NCA)

DELETE FROM recibos;
UPDATE pedidos SET pago_contado_10 = false WHERE pago_contado_10;
-- anticipo_pago_id se limpia solo (FK ON DELETE SET NULL)

DELETE FROM pago_deposito_items;
DELETE FROM pago_comprobantes;
DELETE FROM pagos_detalle;
DELETE FROM pagos_clientes;

-- Cheques nacidos de pagos de prueba (la cartera real no se toca)
DELETE FROM cheques ch
WHERE ch.id IN (SELECT id FROM _cheques_de_pagos)
  AND NOT EXISTS (SELECT 1 FROM pagos_proveedores_items ppi WHERE ppi.cheque_id = ch.id);

-- ── 2. Comprobantes de prueba (PRES/REV PV 0001) ──
UPDATE kardex SET comprobante_venta_id = NULL
WHERE comprobante_venta_id IN (SELECT id FROM _prueba_comprobantes);
DELETE FROM comisiones WHERE comprobante_venta_id IN (SELECT id FROM _prueba_comprobantes);
DELETE FROM comprobantes_venta_detalle WHERE comprobante_id IN (SELECT id FROM _prueba_comprobantes);
DELETE FROM comprobantes_venta WHERE id IN (SELECT id FROM _prueba_comprobantes);

-- ── 3. Devoluciones de prueba ──
DELETE FROM devoluciones;  -- devoluciones_detalle cae por CASCADE

-- ── 4. Libro mayor: quedan SOLO los asientos de los 8 documentos reales ──
DELETE FROM cuenta_corriente_clientes
WHERE referencia_id IS NULL
   OR referencia_id NOT IN (SELECT id FROM comprobantes_venta WHERE punto_venta = '0007');

-- ── 5. Billetera de viajantes ──
DELETE FROM billetera_movimientos;

-- ── 6. Caja / tesorería a cero ──
UPDATE banco_extractos_movimientos SET kardex_id = NULL WHERE kardex_id IS NOT NULL;
DELETE FROM cierres_caja;
DELETE FROM kardex_contable;
UPDATE saldos_financieros SET saldo = 0;

-- ── 7. Numeración interna (PV 0001) vuelve a 0 — la fiscal no se toca ──
UPDATE numeracion_comprobantes SET ultimo_numero = 0
WHERE punto_venta = '0001' AND tipo_comprobante IN ('PRES', 'REV');

-- ── 8. Asserts finales ──
DO $$
DECLARE v_n int; v_saldos numeric; r record;
BEGIN
  SELECT count(*) INTO v_n FROM comprobantes_venta;
  IF v_n <> 8 THEN RAISE EXCEPTION 'Deberían quedar 8 comprobantes, quedaron %', v_n; END IF;

  SELECT count(*) INTO v_n FROM pagos_clientes;
  IF v_n <> 0 THEN RAISE EXCEPTION 'Deberían quedar 0 pagos, quedaron %', v_n; END IF;

  -- TODAS las cuentas corrientes en $0 exacto
  FOR r IN
    SELECT cliente_id, round(sum(debe) - sum(haber), 2) AS saldo
    FROM cuenta_corriente_clientes GROUP BY cliente_id
    HAVING abs(sum(debe) - sum(haber)) > 0.005
  LOOP
    RAISE EXCEPTION 'El cliente % quedó con saldo % — abortando', r.cliente_id, r.saldo;
  END LOOP;

  -- Reconciliación limpia en toda la base
  SELECT count(*) INTO v_n FROM v_cc_reconciliacion WHERE abs(diferencia) > 0.01;
  IF v_n > 0 THEN RAISE EXCEPTION 'Quedaron % cliente(s) con descuadre en v_cc_reconciliacion', v_n; END IF;

  SELECT COALESCE(sum(saldo), 0) INTO v_saldos FROM saldos_financieros;
  IF v_saldos <> 0 THEN RAISE EXCEPTION 'saldos_financieros no quedó en 0 (%)', v_saldos; END IF;

  RAISE NOTICE 'RESET OK — 8 documentos reales conservados, todas las cuentas en $0, caja en $0, numeración interna en 0';
END $$;

DROP TABLE _prueba_comprobantes;
DROP TABLE _cheques_de_pagos;

COMMIT;
