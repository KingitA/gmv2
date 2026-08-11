-- ============================================================================
-- v_cc_reconciliacion v2 — el control que ahora sí controla
--
-- La v1 (20260706_a2_cc_fixes.sql) comparaba libro vs Σ saldo_pendiente
-- filtrando estado_pago <> 'anulado', pero la anulación real marca
-- `anulado_en` (y suele dejar estado_pago='pagado'): los anulados seguían
-- sumando y la vista reportaba diferencias falsas. Tampoco descontaba la
-- plata a cuenta (pagos confirmados sin imputar), que es una diferencia
-- LEGÍTIMA entre libro y documentos.
--
-- v2: diferencia = saldo_libro − (saldo_documentos − pagos_a_cuenta).
-- En un sistema sano, diferencia = 0 para todos los clientes.
-- La consume GET /api/finanzas/reconciliacion (control diario).
-- ============================================================================

-- La v2 agrega la columna pagos_a_cuenta en el medio: hay que recrear la vista
-- (CREATE OR REPLACE no permite cambiar columnas de lugar).
DROP VIEW IF EXISTS v_cc_reconciliacion;

CREATE VIEW v_cc_reconciliacion AS
SELECT
  cl.id  AS cliente_id,
  cl.razon_social AS cliente_nombre,
  COALESCE(lib.saldo, 0)  AS saldo_libro,
  COALESCE(doc.saldo, 0)  AS saldo_documentos,
  COALESCE(ac.a_cuenta, 0) AS pagos_a_cuenta,
  round(COALESCE(lib.saldo, 0) - (COALESCE(doc.saldo, 0) - COALESCE(ac.a_cuenta, 0)), 2) AS diferencia
FROM clientes cl
LEFT JOIN (
  SELECT cliente_id, SUM(debe) - SUM(haber) AS saldo
  FROM cuenta_corriente_clientes
  GROUP BY cliente_id
) lib ON lib.cliente_id = cl.id
LEFT JOIN (
  SELECT cliente_id, SUM(saldo_pendiente) AS saldo
  FROM comprobantes_venta
  WHERE anulado_en IS NULL AND estado_pago <> 'anulado'
  GROUP BY cliente_id
) doc ON doc.cliente_id = cl.id
LEFT JOIN (
  SELECT p.cliente_id,
         SUM(GREATEST(0, p.monto - COALESCE(imp.imputado, 0))) AS a_cuenta
  FROM pagos_clientes p
  LEFT JOIN (
    SELECT pago_id, SUM(monto_imputado) AS imputado
    FROM imputaciones
    WHERE estado = 'confirmado'
    GROUP BY pago_id
  ) imp ON imp.pago_id = p.id
  WHERE p.estado = 'confirmado'
  GROUP BY p.cliente_id
) ac ON ac.cliente_id = cl.id
WHERE COALESCE(lib.saldo, 0) <> 0
   OR COALESCE(doc.saldo, 0) <> 0
   OR COALESCE(ac.a_cuenta, 0) <> 0;

GRANT SELECT ON v_cc_reconciliacion TO authenticated, service_role;
