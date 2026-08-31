-- ============================================================================
-- Aging v2 + baja de imputaciones_clientes (auditoría cta cte 31/08)
--
-- Problema: v_aging_clientes y v_aging_clientes_simple leían la tabla
-- imputaciones_clientes (VACÍA, de un modelo viejo) y filtraban por
-- tipo_movimiento = 'factura', que cc_postear ya no usa (postea 'venta').
-- Resultado: "deudas fantasma" — mostraban facturas ya pagadas o anuladas
-- como deuda vencida (ej. Garbellini $1,3M que debía $0).
--
-- Fix: v_aging_clientes se reescribe desde comprobantes_venta VIVOS con
-- saldo_pendiente real (misma capa que usa el resto del sistema para el
-- detalle por comprobante). Mantiene exactamente las mismas columnas: la
-- consume /api/finanzas/tablero. v_aging_clientes_simple (sin consumidores)
-- y la tabla imputaciones_clientes se eliminan.
--
-- Verificación de dependencias (correr antes si hay dudas):
--   SELECT viewname FROM pg_views
--   WHERE schemaname = 'public'
--     AND (definition ILIKE '%imputaciones_clientes%'
--          OR definition ILIKE '%v_aging_clientes%');
--   -- Debe devolver solo v_aging_clientes y v_aging_clientes_simple.
-- ============================================================================

BEGIN;

DROP VIEW IF EXISTS public.v_aging_clientes;

CREATE VIEW public.v_aging_clientes AS
WITH docs_pendientes AS (
  SELECT
    cv.cliente_id,
    cv.saldo_pendiente,
    -- Antigüedad por vencimiento si existe, sino por fecha de emisión
    (CURRENT_DATE - COALESCE(cv.fecha_vencimiento, cv.fecha))::integer AS dias_antiguedad
  FROM comprobantes_venta cv
  WHERE cv.anulado_en IS NULL
    AND cv.estado_pago NOT IN ('anulado', 'pagado')
    AND COALESCE(cv.saldo_pendiente, 0) > 0.01
    -- Débitos: facturas, presupuestos y notas de débito
    AND cv.tipo_comprobante IN ('FA', 'FB', 'FC', 'PRES', 'ND', 'NDA', 'NDB', 'NDC')
)
SELECT
  c.id AS cliente_id,
  c.nombre AS cliente_nombre,
  c.vendedor_id,
  v.nombre AS vendedor_nombre,
  cz.zona_id,
  zo.nombre AS zona_nombre,
  COALESCE(sum(dp.saldo_pendiente) FILTER (WHERE dp.dias_antiguedad < 30), 0)  AS corriente,
  COALESCE(sum(dp.saldo_pendiente) FILTER (WHERE dp.dias_antiguedad BETWEEN 30 AND 59), 0) AS dias_30_59,
  COALESCE(sum(dp.saldo_pendiente) FILTER (WHERE dp.dias_antiguedad BETWEEN 60 AND 89), 0) AS dias_60_89,
  COALESCE(sum(dp.saldo_pendiente) FILTER (WHERE dp.dias_antiguedad >= 90), 0) AS mas_90,
  COALESCE(sum(dp.saldo_pendiente), 0) AS saldo_total,
  round(sum(dp.saldo_pendiente * dp.dias_antiguedad::numeric)
        / NULLIF(sum(dp.saldo_pendiente), 0), 1) AS dias_cobro_promedio
FROM clientes c
LEFT JOIN vendedores v ON v.id = c.vendedor_id
LEFT JOIN clientes_zonas cz ON cz.cliente_id = c.id
LEFT JOIN zonas zo ON zo.id = cz.zona_id
LEFT JOIN docs_pendientes dp ON dp.cliente_id = c.id
GROUP BY c.id, c.nombre, c.vendedor_id, v.nombre, cz.zona_id, zo.nombre;

DROP VIEW IF EXISTS public.v_aging_clientes_simple;

-- Tabla del modelo viejo de imputaciones: vacía, sin escritores ni lectores en
-- el código (las imputaciones reales viven en public.imputaciones).
-- Sin CASCADE a propósito: si algo inesperado depende, que falle y se revise.
DROP TABLE IF EXISTS public.imputaciones_clientes;

COMMIT;
