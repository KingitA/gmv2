-- ════════════════════════════════════════════════════════════════════════════════════════
-- ENTRADA DE MERCADERÍA — limpieza de los DATOS DE PRUEBA de compras, antes de producción
-- ════════════════════════════════════════════════════════════════════════════════════════
-- NO es una migración. NO SE EJECUTÓ NUNCA: está escrito sin poder probarlo contra la base.
-- Se corre a mano, una sola vez, en el editor SQL de Supabase, DESPUÉS de mirar el PASO 1.
--
-- Qué es "prueba" (CRITERIO PROPUESTO — confirmarlo con lo que liste el PASO 1 antes de usarlo):
--   · las órdenes de compra OC-000010, OC-000011, OC-000012 y OC-000013, y
--   · cualquier otra orden de compra creada desde el 16/11/2026 (hora argentina).
--   Todo lo demás se deriva de esas órdenes: sus recepciones, documentos, comprobantes (y las
--   notas de crédito / débito esperadas), provisiones y movimientos de cuenta corriente, kardex,
--   diferencias resueltas, correcciones de conteo, cargos al transporte y vencimientos.
--   Para cambiar el criterio, editar las DOS listas "oc_prueba" (una en el PASO 1 y otra en el
--   PASO 2): tienen que decir lo mismo.
--
-- Qué NO toca, a propósito:
--   · Los vencimientos anotados a mano por Juan (sin referencia) y cualquier vencimiento que no
--     cuelgue de una orden / comprobante / movimiento de prueba.
--   · La cuenta corriente real: los movimientos que no son de esas órdenes ni de sus comprobantes
--     (las 62 facturas de Gmail de marzo-abril 2026 no tienen orden: no entran).
--   · Comprobantes SIN orden de compra, aunque sean posteriores al 16/11: pueden ser reales. El
--     PASO 1 los lista aparte para decidir a mano.
--   · Órdenes de pago: NO se borran (tienen numeración, caja, cheques y retenciones). Las de prueba
--     hay que ANULARLAS antes desde la pantalla (usa op_anular, que deshace todo). El PASO 2 corta
--     con un mensaje si queda alguna orden de pago confirmada que pagó algo de prueba.
--   · Artículos, proveedores, listas de precios y precios de venta.
--
-- Los VENCIMIENTOS de prueba (los estimados de las órdenes, las cuotas de sus comprobantes; entre
-- ellos HORNAL $218.969,34 al 17/12/2026 y las cuotas de OC-000012 y OC-000013) se CANCELAN
-- (estado = 'cancelado', con el motivo en observaciones). Nunca se borran: el historial de
-- vencimientos es inmutable.
--
-- DOS COSAS QUE ESTE SCRIPT NO HACE Y HAY QUE DECIDIR (el PASO 1 las muestra):
--   1. STOCK. Las recepciones de prueba sumaron stock. Borrar el kardex NO baja el stock. La
--      sección "stock" del PASO 1 dice cuánto sumó cada artículo; el bloque para descontarlo está
--      al final, COMENTADO, porque si esa mercadería existe de verdad no hay que tocarlo.
--   2. COSTOS. Validar las facturas de prueba cambió el último costo de esos artículos (y "la
--      empresa asume" pudo cambiar el precio de lista). El script borra el historial de costo de
--      prueba pero NO devuelve los costos a como estaban: la sección "costos" lista los artículos.
-- ════════════════════════════════════════════════════════════════════════════════════════


-- ───────────────────────── PASO 1 — MIRAR (no cambia nada) ─────────────────────────
-- Una sola consulta: lista todo lo que el PASO 2 va a tocar, por sección, con sus importes.
WITH oc_prueba AS (
  SELECT oc.id, oc.numero_orden, oc.proveedor_id, oc.estado, oc.fecha_orden
    FROM ordenes_compra oc
   WHERE oc.numero_orden IN ('OC-000010', 'OC-000011', 'OC-000012', 'OC-000013')
      OR oc.fecha_orden >= timestamptz '2026-11-16 00:00:00-03'
), rec AS (
  SELECT r.id, r.orden_compra_id FROM recepciones r WHERE r.orden_compra_id IN (SELECT id FROM oc_prueba)
), comp AS (
  SELECT c.* FROM comprobantes_compra c WHERE c.orden_compra_id IN (SELECT id FROM oc_prueba)
), cc AS (
  SELECT m.* FROM cuenta_corriente_proveedores m
   WHERE (m.referencia_tipo = 'orden_compra' AND m.referencia_id IN (SELECT id FROM oc_prueba))
      OR (m.referencia_tipo = 'comprobante_compra' AND m.referencia_id IN (SELECT id FROM comp))
), venc AS (
  SELECT v.* FROM vencimientos v
   WHERE (v.referencia_tipo = 'orden_compra' AND v.referencia_id IN (SELECT id FROM oc_prueba))
      OR (v.referencia_tipo = 'comprobante_compra' AND v.referencia_id IN (SELECT id FROM comp))
      OR (v.referencia_tipo = 'cuenta_corriente' AND v.referencia_id IN (SELECT id FROM cc))
), kx AS (
  SELECT k.* FROM kardex k
   WHERE k.orden_compra_id IN (SELECT id FROM oc_prueba)
      OR k.recepcion_id IN (SELECT id FROM rec)
      OR k.comprobante_compra_id IN (SELECT id FROM comp)
), op AS (
  SELECT DISTINCT o.id, o.estado, o.created_at
    FROM ordenes_pago o
    JOIN ordenes_pago_imputaciones i ON i.orden_pago_id = o.id
   WHERE i.movimiento_cc_id IN (SELECT id FROM cc)
      OR i.vencimiento_id IN (SELECT id FROM venc)
      OR i.comprobante_compra_id IN (SELECT id FROM comp)
)
SELECT '01 órdenes de compra (se borran)' AS seccion, o.numero_orden AS que,
       (SELECT nombre FROM proveedores p WHERE p.id = o.proveedor_id) AS proveedor,
       NULL::numeric AS importe, o.estado AS estado, to_char(o.fecha_orden AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY') AS fecha
  FROM oc_prueba o
UNION ALL
SELECT '02 recepciones (se borran, con sus renglones y documentos)', (SELECT numero_orden FROM oc_prueba o WHERE o.id = r.orden_compra_id), NULL, NULL, NULL, NULL
  FROM rec r
UNION ALL
SELECT '03 comprobantes de compra (se borran; "esperada" = NC / ND esperadas)', c.tipo_comprobante || ' ' || c.numero_comprobante,
       (SELECT nombre FROM proveedores p WHERE p.id = c.proveedor_id), c.total_factura_declarado, c.estado, to_char(c.fecha_comprobante, 'DD/MM/YYYY')
  FROM comp c
UNION ALL
SELECT '04 cuenta corriente de proveedores (se borran: provisiones, facturas y notas de esas órdenes)', m.tipo_movimiento || ' — ' || coalesce(m.descripcion, ''),
       (SELECT nombre FROM proveedores p WHERE p.id = m.proveedor_id), m.monto, m.referencia_tipo, to_char(m.fecha AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY')
  FROM cc m
UNION ALL
SELECT '05 vencimientos (se CANCELAN, no se borran)', v.concepto, (SELECT nombre FROM proveedores p WHERE p.id = v.proveedor_id), v.monto, v.estado, to_char(v.fecha_vencimiento, 'DD/MM/YYYY')
  FROM venc v
UNION ALL
SELECT '06 kardex (se borra)', k.tipo_movimiento || ' ' || coalesce(k.articulo_sku, '') || ' × ' || k.cantidad, NULL, k.subtotal_neto, k.estado, to_char(k.fecha AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY')
  FROM kx k
UNION ALL
SELECT '07 stock que sumaron esas recepciones (NO se toca: decidir)', coalesce(k.articulo_sku, k.articulo_id::text),
       NULL, sum(k.signo * k.cantidad), 'unidades (neto)', NULL
  FROM kx k WHERE k.estado = 'confirmado' GROUP BY 2
UNION ALL
SELECT '08 órdenes de pago que pagaron algo de prueba (ANULARLAS antes desde la pantalla)', o.id::text, NULL, NULL, o.estado, to_char(o.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY')
  FROM op o
UNION ALL
SELECT '09 cargos al transporte por faltantes de esas recepciones (se borran)', t.descripcion, NULL, t.monto, t.tipo_movimiento, NULL
  FROM cuenta_corriente_transportes t
 WHERE t.referencia_tipo = 'recepcion' AND t.referencia_id IN (SELECT id FROM rec)
UNION ALL
SELECT '10 costos: artículos con historial de costo de esas órdenes (el historial se borra; el costo NO se devuelve)', a.sku || ' — ' || a.descripcion, NULL, a.ultimo_costo, 'último costo de hoy', NULL
  FROM articulos a
 WHERE a.id IN (SELECT h.articulo_id FROM precios_compra_historial h
                 WHERE h.orden_compra_id IN (SELECT id FROM oc_prueba) OR h.comprobante_compra_id IN (SELECT id FROM comp))
UNION ALL
SELECT '11 PARA DECIDIR A MANO: comprobantes SIN orden creados desde el 16/11 (NO se tocan)', c.tipo_comprobante || ' ' || c.numero_comprobante,
       (SELECT nombre FROM proveedores p WHERE p.id = c.proveedor_id), c.total_factura_declarado, c.estado, to_char(c.fecha_comprobante, 'DD/MM/YYYY')
  FROM comprobantes_compra c
 WHERE c.orden_compra_id IS NULL AND c.created_at >= timestamptz '2026-11-16 00:00:00-03'
UNION ALL
SELECT '12 PARA DECIDIR A MANO: órdenes de compra anteriores (OC-000001 a 000009) que quedaron abiertas (NO se tocan)', o.numero_orden,
       (SELECT nombre FROM proveedores p WHERE p.id = o.proveedor_id), NULL, o.estado, to_char(o.fecha_orden AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY')
  FROM ordenes_compra o
 WHERE o.id NOT IN (SELECT id FROM oc_prueba) AND o.estado NOT IN ('finalizada', 'cancelada')
ORDER BY 1, 2;

-- Totales del PASO 1 (correr aparte si se quiere el resumen):
--   mismas definiciones; contar por sección con  SELECT seccion, count(*), sum(importe) FROM (…la consulta de arriba…) x GROUP BY 1 ORDER BY 1;


-- ───────────────────────── PASO 2 — LIMPIAR ─────────────────────────
-- Todo en una sola transacción. Termina en ROLLBACK: así como está, NO cambia nada (sirve para
-- ver que corre y los totales). Cuando esté revisado, cambiar el ROLLBACK del final por COMMIT.
-- Si algo falla en el medio (una clave foránea que este script no conoce), se deshace todo.
BEGIN;

-- El mismo criterio del PASO 1 (si se cambia allá, cambiarlo acá)
CREATE TEMP TABLE _oc ON COMMIT DROP AS
  SELECT oc.id FROM ordenes_compra oc
   WHERE oc.numero_orden IN ('OC-000010', 'OC-000011', 'OC-000012', 'OC-000013')
      OR oc.fecha_orden >= timestamptz '2026-11-16 00:00:00-03';
CREATE TEMP TABLE _rec ON COMMIT DROP AS
  SELECT r.id FROM recepciones r WHERE r.orden_compra_id IN (SELECT id FROM _oc);
CREATE TEMP TABLE _comp ON COMMIT DROP AS
  SELECT c.id FROM comprobantes_compra c WHERE c.orden_compra_id IN (SELECT id FROM _oc);
CREATE TEMP TABLE _cc ON COMMIT DROP AS
  SELECT m.id FROM cuenta_corriente_proveedores m
   WHERE (m.referencia_tipo = 'orden_compra' AND m.referencia_id IN (SELECT id FROM _oc))
      OR (m.referencia_tipo = 'comprobante_compra' AND m.referencia_id IN (SELECT id FROM _comp));
CREATE TEMP TABLE _venc ON COMMIT DROP AS
  SELECT v.id FROM vencimientos v
   WHERE (v.referencia_tipo = 'orden_compra' AND v.referencia_id IN (SELECT id FROM _oc))
      OR (v.referencia_tipo = 'comprobante_compra' AND v.referencia_id IN (SELECT id FROM _comp))
      OR (v.referencia_tipo = 'cuenta_corriente' AND v.referencia_id IN (SELECT id FROM _cc));
CREATE TEMP TABLE _resumen (paso int, que text, filas bigint) ON COMMIT DROP;

-- 0. Freno: no puede quedar una orden de pago CONFIRMADA que haya pagado algo de prueba
DO $$
DECLARE n int;
BEGIN
  SELECT count(DISTINCT o.id) INTO n
    FROM ordenes_pago o JOIN ordenes_pago_imputaciones i ON i.orden_pago_id = o.id
   WHERE o.estado = 'pagada'
     AND (i.movimiento_cc_id IN (SELECT id FROM _cc) OR i.vencimiento_id IN (SELECT id FROM _venc) OR i.comprobante_compra_id IN (SELECT id FROM _comp));
  IF n > 0 THEN
    RAISE EXCEPTION 'Hay % orden(es) de pago CONFIRMADA(S) que pagaron comprobantes de prueba. Anularlas primero desde la pantalla de órdenes de pago (sección 08 del PASO 1) y volver a correr. No se cambió nada.', n;
  END IF;
END $$;

-- 1. Vencimientos de prueba: se CANCELAN (nunca se borran)
WITH x AS (
  UPDATE vencimientos v
     SET estado = 'cancelado',
         observaciones = left(coalesce(nullif(v.observaciones, '') || ' · ', '') || 'Cancelado: dato de prueba de compras (limpieza antes de producción).', 1000),
         updated_at = now()
   WHERE v.id IN (SELECT id FROM _venc) AND v.estado <> 'cancelado'
  RETURNING 1)
INSERT INTO _resumen SELECT 1, 'vencimientos cancelados', count(*) FROM x;

-- 2. Imputaciones de órdenes de pago (ya anuladas o en borrador) contra lo de prueba
WITH x AS (
  DELETE FROM ordenes_pago_imputaciones i
   WHERE i.movimiento_cc_id IN (SELECT id FROM _cc) OR i.comprobante_compra_id IN (SELECT id FROM _comp)
  RETURNING 1)
INSERT INTO _resumen SELECT 2, 'imputaciones de órdenes de pago borradas', count(*) FROM x;
WITH x AS (
  DELETE FROM imputaciones_proveedores i
   WHERE i.id_movimiento_documento IN (SELECT id FROM _cc) OR i.id_movimiento_pago IN (SELECT id FROM _cc)
  RETURNING 1)
INSERT INTO _resumen SELECT 2, 'imputaciones de cuenta corriente borradas', count(*) FROM x;

-- 3. Kardex de esas órdenes, recepciones y comprobantes
WITH x AS (
  DELETE FROM kardex k
   WHERE k.orden_compra_id IN (SELECT id FROM _oc) OR k.recepcion_id IN (SELECT id FROM _rec) OR k.comprobante_compra_id IN (SELECT id FROM _comp)
  RETURNING 1)
INSERT INTO _resumen SELECT 3, 'kardex de prueba borrado', count(*) FROM x;

-- 3.b Lo de scripts/entrada-limpieza-kardex-en-camino.sql (vale para TODAS las órdenes, no solo las de prueba):
--     compras duplicadas por la validación vieja, "en camino" de órdenes cerradas y "en camino" que ya llegó
WITH x AS (
  DELETE FROM kardex k
   WHERE (k.tipo_movimiento = 'compra' AND k.estado = 'confirmado' AND k.orden_compra_id IS NOT NULL AND k.recepcion_id IS NULL
          AND EXISTS (SELECT 1 FROM kardex g JOIN recepciones r ON r.id = g.recepcion_id
                       WHERE r.orden_compra_id = k.orden_compra_id AND g.articulo_id = k.articulo_id
                         AND g.tipo_movimiento = 'compra' AND g.estado = 'confirmado'))
      OR (k.tipo_movimiento = 'compra' AND k.estado = 'pendiente' AND k.orden_compra_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM ordenes_compra oc WHERE oc.id = k.orden_compra_id AND oc.estado NOT IN ('finalizada', 'cancelada', 'recibida_completa')))
  RETURNING 1)
INSERT INTO _resumen SELECT 3, 'kardex duplicado o "en camino" que ya no corresponde, borrado', count(*) FROM x;

-- 4. Historial de costo de prueba (los costos de los artículos NO se devuelven: ver la cabecera)
WITH x AS (
  DELETE FROM precios_compra_historial h
   WHERE h.orden_compra_id IN (SELECT id FROM _oc) OR h.comprobante_compra_id IN (SELECT id FROM _comp)
  RETURNING 1)
INSERT INTO _resumen SELECT 4, 'historial de costo de prueba borrado', count(*) FROM x;

-- 5. Cargos al transporte por faltantes de esas recepciones
WITH x AS (
  DELETE FROM cuenta_corriente_transportes t
   WHERE t.referencia_tipo = 'recepcion' AND t.referencia_id IN (SELECT id FROM _rec)
  RETURNING 1)
INSERT INTO _resumen SELECT 5, 'cargos al transporte borrados', count(*) FROM x;

-- 6. Cuenta corriente de proveedores: provisiones, facturas y notas de esas órdenes
WITH x AS (
  DELETE FROM cuenta_corriente_proveedores m WHERE m.id IN (SELECT id FROM _cc)
  RETURNING 1)
INSERT INTO _resumen SELECT 6, 'movimientos de cuenta corriente de proveedores borrados', count(*) FROM x;

-- 7. Comprobantes de compra (con sus renglones, el registro de renglones tocados a mano y sus documentos)
WITH x AS (DELETE FROM comprobantes_compra_cambios h WHERE h.comprobante_id IN (SELECT id FROM _comp) RETURNING 1)
INSERT INTO _resumen SELECT 7, 'registro de renglones tocados a mano borrado', count(*) FROM x;
WITH x AS (DELETE FROM comprobantes_compra_detalle d WHERE d.comprobante_id IN (SELECT id FROM _comp) RETURNING 1)
INSERT INTO _resumen SELECT 7, 'renglones de comprobantes borrados', count(*) FROM x;
WITH x AS (
  DELETE FROM recepciones_documentos d
   WHERE d.recepcion_id IN (SELECT id FROM _rec) OR d.comprobante_id IN (SELECT id FROM _comp)
  RETURNING 1)
INSERT INTO _resumen SELECT 7, 'documentos (fotos / PDF) borrados de la base — los archivos quedan en el almacenamiento', count(*) FROM x;
-- una nota esperada apunta a su factura: primero se suelta ese enlace
UPDATE comprobantes_compra SET comprobante_asociado_id = NULL
 WHERE comprobante_asociado_id IN (SELECT id FROM _comp);
WITH x AS (DELETE FROM comprobantes_compra c WHERE c.id IN (SELECT id FROM _comp) RETURNING 1)
INSERT INTO _resumen SELECT 7, 'comprobantes de compra borrados (incluye NC / ND esperadas)', count(*) FROM x;

-- 8. Recepciones (sus diferencias y correcciones se van solas: ON DELETE CASCADE)
WITH x AS (DELETE FROM ocr_conversion_warnings w WHERE w.recepcion_id IN (SELECT id FROM _rec) RETURNING 1)
INSERT INTO _resumen SELECT 8, 'avisos de conversión de bultos borrados', count(*) FROM x;
WITH x AS (DELETE FROM recepciones_items i WHERE i.recepcion_id IN (SELECT id FROM _rec) RETURNING 1)
INSERT INTO _resumen SELECT 8, 'renglones de recepción borrados', count(*) FROM x;
WITH x AS (DELETE FROM recepciones r WHERE r.id IN (SELECT id FROM _rec) RETURNING 1)
INSERT INTO _resumen SELECT 8, 'recepciones borradas', count(*) FROM x;

-- 9. Órdenes de compra (sus envíos por mail se van solos: ON DELETE CASCADE)
WITH x AS (DELETE FROM ordenes_compra_detalle d WHERE d.orden_compra_id IN (SELECT id FROM _oc) RETURNING 1)
INSERT INTO _resumen SELECT 9, 'renglones de órdenes de compra borrados', count(*) FROM x;
WITH x AS (DELETE FROM ordenes_compra o WHERE o.id IN (SELECT id FROM _oc) RETURNING 1)
INSERT INTO _resumen SELECT 9, 'órdenes de compra borradas', count(*) FROM x;

-- Lo que se hizo (tiene que coincidir con lo que listó el PASO 1)
SELECT paso, que, filas FROM _resumen ORDER BY paso, que;

ROLLBACK;   -- ← cambiar por COMMIT cuando esté revisado. Con ROLLBACK no cambia nada.


-- ───────────────────────── OPCIONAL — descontar el stock que sumaron las pruebas ─────────────────────────
-- SOLO si esa mercadería no existe. Hay que correrlo ANTES del PASO 2 (después ya no está el kardex
-- para saber cuánto fue), también dentro de BEGIN … ROLLBACK / COMMIT. Deja el stock en 0 como
-- mínimo (no lo deja negativo) y no escribe kardex.
--
-- BEGIN;
-- WITH oc_prueba AS (
--   SELECT oc.id FROM ordenes_compra oc
--    WHERE oc.numero_orden IN ('OC-000010', 'OC-000011', 'OC-000012', 'OC-000013')
--       OR oc.fecha_orden >= timestamptz '2026-11-16 00:00:00-03'
-- ), neto AS (
--   SELECT k.articulo_id, sum(k.signo * k.cantidad) AS unidades
--     FROM kardex k
--    WHERE k.estado = 'confirmado'
--      AND (k.orden_compra_id IN (SELECT id FROM oc_prueba)
--        OR k.recepcion_id IN (SELECT r.id FROM recepciones r WHERE r.orden_compra_id IN (SELECT id FROM oc_prueba)))
--    GROUP BY 1
-- )
-- UPDATE articulos a
--    SET stock_actual = greatest(0, coalesce(a.stock_actual, 0) - n.unidades)
--   FROM neto n
--  WHERE a.id = n.articulo_id AND n.unidades <> 0
-- RETURNING a.sku, a.descripcion, n.unidades AS descontado, a.stock_actual AS stock_que_quedo;
-- ROLLBACK;   -- ← COMMIT cuando esté revisado
