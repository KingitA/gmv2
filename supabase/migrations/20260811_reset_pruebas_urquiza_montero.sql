-- ============================================================================
-- RESET QUIRÚRGICO — pruebas de DISTRIBUIDORA URQUIZA y MONTERO DANIEL
-- (11/08/2026, tarde — segunda ronda de pruebas)
--
-- BORRA:
--   · Todos los comprobantes internos PV 0001 (PRES/REV) — son todos de estos
--     dos clientes (pre-assert lo verifica) — con detalles, comisiones e
--     imputaciones.
--   · Todos los pagos de ambos clientes (recibos, detalles, fotos, cheques,
--     billetera, rendiciones si hubiera).
--   · TODOS sus movimientos de cuenta corriente → cuentas en $0.
--   · Los movimientos del kardex de HOY (la Caja del Día queda vacía).
--   · Numeración interna PRES/REV vuelve a 0.
--
-- NO TOCA:
--   · saldos_financieros — los saldos de cajas/bancos quedan TAL CUAL están
--     (assert: la suma antes == después).
--   · Los 8 documentos reales PV 0007 y el resto de los clientes.
--
-- Transaccional: si un assert falla, no se aplica nada.
-- ============================================================================

BEGIN;

-- ── 0. Pre-asserts ──
DO $$
DECLARE v_otros int;
BEGIN
  -- Todos los comprobantes PV 0001 deben ser de Urquiza o Montero
  SELECT count(*) INTO v_otros
  FROM comprobantes_venta cv
  WHERE cv.punto_venta = '0001'
    AND cv.cliente_id NOT IN (
      SELECT id FROM clientes WHERE razon_social IN ('DISTRIBUIDORA URQUIZA', 'MONTERO DANIEL')
    );
  IF v_otros > 0 THEN
    RAISE EXCEPTION 'Hay % comprobantes PV 0001 de OTROS clientes — revisar antes de resetear', v_otros;
  END IF;
END $$;

CREATE TEMP TABLE _clientes_reset AS
  SELECT id FROM clientes WHERE razon_social IN ('DISTRIBUIDORA URQUIZA', 'MONTERO DANIEL');
CREATE TEMP TABLE _comprobantes_reset AS
  SELECT id FROM comprobantes_venta WHERE punto_venta = '0001';
CREATE TEMP TABLE _pagos_reset AS
  SELECT id FROM pagos_clientes WHERE cliente_id IN (SELECT id FROM _clientes_reset);
CREATE TEMP TABLE _cheques_reset AS
  SELECT cheque_id AS id FROM pagos_detalle WHERE cheque_id IS NOT NULL AND pago_id IN (SELECT id FROM _pagos_reset)
  UNION
  SELECT pdi.cheque_id FROM pago_deposito_items pdi
    JOIN pagos_detalle pd ON pd.id = pdi.pago_detalle_id
  WHERE pdi.cheque_id IS NOT NULL AND pd.pago_id IN (SELECT id FROM _pagos_reset);
CREATE TEMP TABLE _saldos_antes AS
  SELECT COALESCE(sum(saldo), 0) AS total FROM saldos_financieros;

-- ── 1. Circuito de pagos de ambos clientes ──
CREATE TEMP TABLE _rendiciones_reset AS
  SELECT DISTINCT rendicion_id AS id FROM rendicion_items
  WHERE pago_id IN (SELECT id FROM _pagos_reset);
DELETE FROM rendicion_items WHERE pago_id IN (SELECT id FROM _pagos_reset);
-- Solo las rendiciones de ESTOS pagos, y solo si quedaron vacías
DELETE FROM rendiciones r
WHERE r.id IN (SELECT id FROM _rendiciones_reset)
  AND NOT EXISTS (SELECT 1 FROM rendicion_items ri WHERE ri.rendicion_id = r.id);

DELETE FROM imputaciones
WHERE pago_id IN (SELECT id FROM _pagos_reset)
   OR comprobante_id IN (SELECT id FROM _comprobantes_reset)
   OR credito_comprobante_id IN (SELECT id FROM _comprobantes_reset);

DELETE FROM recibos WHERE pago_id IN (SELECT id FROM _pagos_reset);
UPDATE pedidos SET pago_contado_10 = false
WHERE cliente_id IN (SELECT id FROM _clientes_reset) AND pago_contado_10;

DELETE FROM pago_deposito_items WHERE pago_detalle_id IN
  (SELECT id FROM pagos_detalle WHERE pago_id IN (SELECT id FROM _pagos_reset));
DELETE FROM pago_comprobantes WHERE pago_id IN (SELECT id FROM _pagos_reset);
DELETE FROM pagos_detalle WHERE pago_id IN (SELECT id FROM _pagos_reset);
DELETE FROM billetera_movimientos
WHERE referencia_id IN (SELECT id FROM _pagos_reset)
   OR viajante_id IN (SELECT vendedor_id FROM clientes WHERE id IN (SELECT id FROM _clientes_reset) AND vendedor_id IS NOT NULL);
DELETE FROM pagos_clientes WHERE id IN (SELECT id FROM _pagos_reset);

DELETE FROM cheques ch
WHERE ch.id IN (SELECT id FROM _cheques_reset)
  AND NOT EXISTS (SELECT 1 FROM pagos_proveedores_items ppi WHERE ppi.cheque_id = ch.id);

-- ── 2. Comprobantes internos PV 0001 ──
UPDATE kardex SET comprobante_venta_id = NULL
WHERE comprobante_venta_id IN (SELECT id FROM _comprobantes_reset);
DELETE FROM comisiones WHERE comprobante_venta_id IN (SELECT id FROM _comprobantes_reset);
DELETE FROM comprobantes_venta_detalle WHERE comprobante_id IN (SELECT id FROM _comprobantes_reset);
DELETE FROM comprobantes_venta WHERE id IN (SELECT id FROM _comprobantes_reset);

-- ── 3. Cuentas corrientes de ambos clientes → $0 ──
DELETE FROM cuenta_corriente_clientes WHERE cliente_id IN (SELECT id FROM _clientes_reset);

-- ── 4. Kardex de HOY vacío (los SALDOS no se tocan) ──
UPDATE banco_extractos_movimientos SET kardex_id = NULL
WHERE kardex_id IN (SELECT id FROM kardex_contable WHERE fecha::date = CURRENT_DATE);
DELETE FROM cierres_caja
WHERE fecha = CURRENT_DATE
   OR ajuste_kardex_id IN (SELECT id FROM kardex_contable WHERE fecha::date = CURRENT_DATE);
DELETE FROM kardex_contable WHERE fecha::date = CURRENT_DATE;

-- ── 5. Numeración interna a 0 ──
UPDATE numeracion_comprobantes SET ultimo_numero = 0
WHERE punto_venta = '0001' AND tipo_comprobante IN ('PRES', 'REV');

-- ── 6. Asserts finales ──
DO $$
DECLARE v_n int; v_saldos_despues numeric; v_saldos_antes numeric; r record;
BEGIN
  SELECT count(*) INTO v_n FROM comprobantes_venta WHERE punto_venta = '0001';
  IF v_n <> 0 THEN RAISE EXCEPTION 'Quedaron % comprobantes PV 0001', v_n; END IF;

  SELECT count(*) INTO v_n FROM pagos_clientes WHERE cliente_id IN (SELECT id FROM _clientes_reset);
  IF v_n <> 0 THEN RAISE EXCEPTION 'Quedaron % pagos de los clientes reseteados', v_n; END IF;

  SELECT count(*) INTO v_n FROM cuenta_corriente_clientes WHERE cliente_id IN (SELECT id FROM _clientes_reset);
  IF v_n <> 0 THEN RAISE EXCEPTION 'Quedaron % movimientos de cta cte de los clientes reseteados', v_n; END IF;

  -- Los saldos de cajas NO deben haber cambiado
  SELECT COALESCE(sum(saldo), 0) INTO v_saldos_despues FROM saldos_financieros;
  SELECT total INTO v_saldos_antes FROM _saldos_antes;
  IF v_saldos_despues <> v_saldos_antes THEN
    RAISE EXCEPTION 'Los saldos financieros cambiaron (% → %) — no debían tocarse', v_saldos_antes, v_saldos_despues;
  END IF;

  -- Reconciliación limpia en toda la base
  SELECT count(*) INTO v_n FROM v_cc_reconciliacion WHERE abs(diferencia) > 0.01;
  IF v_n > 0 THEN RAISE EXCEPTION 'Quedaron % cliente(s) con descuadre', v_n; END IF;

  RAISE NOTICE 'RESET OK — Urquiza y Montero en $0, kardex de hoy vacío, saldos de cajas intactos, numeración en 0';
END $$;

DROP TABLE _rendiciones_reset;
DROP TABLE _clientes_reset;
DROP TABLE _comprobantes_reset;
DROP TABLE _pagos_reset;
DROP TABLE _cheques_reset;
DROP TABLE _saldos_antes;

COMMIT;
