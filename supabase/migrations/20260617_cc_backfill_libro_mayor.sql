-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill idempotente del libro mayor de clientes (cuenta_corriente_clientes)
-- desde el estado actual del sistema. Debe correrse DESPUÉS de
-- 20260617_cc_libro_mayor_helper.sql.
--
-- Reglas (verdad económica):
--   1. Comprobantes de venta: FA/FB/FC = debe ; PRES = debe (presupuesto) ;
--      NC*/REV = haber (vienen con total_factura NEGATIVO) ; ND* = debe.
--      Se postea TANTO la factura anulada COMO su NC: el neteo da 0 y queda el
--      rastro completo en el extracto.
--   2. Pagos de clientes CONFIRMADOS = haber. Los 'pendiente' y 'anulado' NO
--      postean (un pendiente no impacta el saldo real; un anulado nunca existió).
--   3. cuenta_corriente_ajustes: NO se migra. Las únicas filas existentes
--      ("Anulación") duplican el haber que ya aporta la NCA correspondiente;
--      migrarlas doble-contaría el crédito. Quedan como legacy.
--
-- Idempotente: cada bloque se saltea las referencias ya posteadas, así puede
-- re-ejecutarse sin duplicar (y no choca con los posteos en runtime, que usan
-- las mismas referencia_tipo/referencia_id).
--
-- Saldos esperados tras correrlo (reconciliar contra v_saldo_clientes):
--   07fd06f3… = 0           | 99885d15… = 116255.40
--   0bf32ca0… = 377.51      | 069757b3… = -535000.00
--   40bd3ddb… = -1328488.01 | 5fe84b76… = -339327.20
--   1b44aa30…/417ebee8…/91300b1e… = 0  (solo pagos pendientes)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Comprobantes de venta
INSERT INTO cuenta_corriente_clientes
  (cliente_id, fecha, tipo_movimiento, debe, haber, saldo,
   referencia_tipo, referencia_id, numero_comprobante, observaciones)
SELECT
  cv.cliente_id,
  cv.fecha,
  CASE
    WHEN cv.tipo_comprobante LIKE 'NC%' OR cv.tipo_comprobante = 'REV' THEN 'nota_credito'
    WHEN cv.tipo_comprobante LIKE 'ND%' THEN 'nota_debito'
    WHEN cv.tipo_comprobante = 'PRES' THEN 'presupuesto'
    ELSE 'factura'
  END,
  GREATEST(cv.total_factura, 0),
  GREATEST(-cv.total_factura, 0),
  0,
  'comprobante_venta',
  cv.id,
  cv.numero_comprobante,
  '[BACKFILL] ' || cv.tipo_comprobante
FROM comprobantes_venta cv
WHERE NOT EXISTS (
  SELECT 1 FROM cuenta_corriente_clientes m
  WHERE m.referencia_tipo = 'comprobante_venta' AND m.referencia_id = cv.id
);

-- 2. Pagos de clientes confirmados
INSERT INTO cuenta_corriente_clientes
  (cliente_id, fecha, tipo_movimiento, debe, haber, saldo,
   referencia_tipo, referencia_id, numero_comprobante, observaciones)
SELECT
  p.cliente_id,
  p.fecha_pago,
  'pago',
  0,
  p.monto,
  0,
  'pago_cliente',
  p.id,
  NULL,
  '[BACKFILL] pago confirmado'
FROM pagos_clientes p
WHERE p.estado = 'confirmado'
AND NOT EXISTS (
  SELECT 1 FROM cuenta_corriente_clientes m
  WHERE m.referencia_tipo = 'pago_cliente' AND m.referencia_id = p.id
);

-- Verificación (readonly) — debe coincidir con los saldos esperados de arriba:
--   SELECT cliente_id, saldo_actual FROM v_saldo_clientes WHERE saldo_actual <> 0 ORDER BY 1;
