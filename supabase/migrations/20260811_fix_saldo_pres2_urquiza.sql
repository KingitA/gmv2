-- ============================================================================
-- FIX DE DATOS — restaurar $4,36 de saldo del PRES 0001-00000002 (Urquiza)
--
-- Residuo de la prueba del 11/08 (cobro con el total + 10% tildado, anulado):
-- el ajuste por redondeo de esa ronda todavía no nacía vinculado al pago, así
-- que su efecto sobre el saldo no se revirtió con la anulación. El libro está
-- perfecto (deuda completa $5.101.704,84); solo el saldo del comprobante quedó
-- corto. Idempotente + assert.
-- ============================================================================
BEGIN;

UPDATE comprobantes_venta
SET saldo_pendiente = total_factura, estado_pago = 'pendiente'
WHERE punto_venta = '0001' AND tipo_comprobante = 'PRES' AND numero_comprobante = '0001-00000002'
  AND cliente_id = (SELECT id FROM clientes WHERE razon_social = 'DISTRIBUIDORA URQUIZA')
  AND saldo_pendiente <> total_factura;

DO $$
DECLARE v_dif numeric;
BEGIN
  SELECT round(COALESCE(sum(cc.debe) - sum(cc.haber), 0) - (SELECT COALESCE(sum(cv.saldo_pendiente), 0)
           FROM comprobantes_venta cv WHERE cv.cliente_id = cc.cliente_id AND cv.anulado_en IS NULL AND cv.estado_pago <> 'anulado'), 2)
  INTO v_dif
  FROM cuenta_corriente_clientes cc
  WHERE cc.cliente_id = (SELECT id FROM clientes WHERE razon_social = 'DISTRIBUIDORA URQUIZA')
  GROUP BY cc.cliente_id;
  IF COALESCE(abs(v_dif), 0) > 0.005 THEN
    RAISE EXCEPTION 'URQUIZA sigue descuadrado (dif %)', v_dif;
  END IF;
  RAISE NOTICE 'URQUIZA OK — libro y documentos alineados';
END $$;

COMMIT;
