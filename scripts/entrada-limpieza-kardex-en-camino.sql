-- ════════════════════════════════════════════════════════════════════════════════════════
-- ENTRADA DE MERCADERÍA — limpieza ÚNICA del kardex de compras (17/11/2026)
-- ════════════════════════════════════════════════════════════════════════════════════════
-- NO es una migración: se corre UNA vez, a mano, en el editor SQL de Supabase.
-- No toca stock, cuentas corrientes, vencimientos ni comprobantes: solo borra renglones del
-- kardex que están de más. Antes de borrar guarda una copia en `kardex_respaldo_entrada_20261117`.
--
-- Qué limpia:
--   A. Compras DUPLICADAS. Hasta hoy, validar una factura pasaba a "confirmado" el kardex "en
--      camino" de la orden (el que se crea con la orden, con fecha estimada de llegada). Como la
--      recepción del depósito ya había anotado su propia compra, quedaban DOS compras del mismo
--      artículo: la de la recepción (la buena, con la fecha en que entró) y esta (muchas veces con
--      fecha futura). Se borra la segunda, SOLO cuando existe la de la recepción.
--   B. "En camino" de órdenes CERRADAS. Kardex de compra pendiente de órdenes finalizadas o
--      canceladas: esa mercadería ya no va a llegar por esa orden.
--   C. "En camino" que ya llegó. Kardex pendiente de órdenes abiertas cuyo artículo ya se recibió
--      completo. (Para las recibidas en parte, la cantidad se acomoda sola con la próxima
--      recepción o validación de esa orden: acá no se toca.)
--
-- Cómo usarlo: correr el PASO 1 y mirar lo que lista. Si está bien, correr el PASO 2 completo.
-- ════════════════════════════════════════════════════════════════════════════════════════


-- ───────────────────────── PASO 1 — MIRAR (no cambia nada) ─────────────────────────
WITH a_borrar AS (
  -- A. compra confirmada de la orden, sin recepción, que tiene su gemela de la recepción
  SELECT k.id, 'A duplicada' AS motivo
    FROM kardex k
   WHERE k.tipo_movimiento = 'compra' AND k.estado = 'confirmado'
     AND k.orden_compra_id IS NOT NULL AND k.recepcion_id IS NULL
     AND EXISTS (
           SELECT 1 FROM kardex g
             JOIN recepciones r ON r.id = g.recepcion_id
            WHERE r.orden_compra_id = k.orden_compra_id
              AND g.articulo_id = k.articulo_id
              AND g.tipo_movimiento = 'compra' AND g.estado = 'confirmado')
  UNION ALL
  -- B. pendiente de una orden finalizada o cancelada (o de una orden que ya no existe)
  SELECT k.id, 'B orden cerrada'
    FROM kardex k
    LEFT JOIN ordenes_compra oc ON oc.id = k.orden_compra_id
   WHERE k.tipo_movimiento = 'compra' AND k.estado = 'pendiente'
     AND k.orden_compra_id IS NOT NULL
     AND (oc.id IS NULL OR oc.estado IN ('finalizada', 'cancelada'))
  UNION ALL
  -- C. pendiente de una orden recibida completa
  SELECT k.id, 'C ya llegó'
    FROM kardex k
    JOIN ordenes_compra oc ON oc.id = k.orden_compra_id
   WHERE k.tipo_movimiento = 'compra' AND k.estado = 'pendiente'
     AND oc.estado = 'recibida_completa'
)
SELECT b.motivo, oc.numero_orden, oc.estado AS estado_orden, a.sku, a.descripcion,
       k.cantidad, k.estado AS estado_kardex,
       to_char(k.fecha AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY') AS fecha,
       (k.fecha > now()) AS fecha_futura, k.id
  FROM a_borrar b
  JOIN kardex k ON k.id = b.id
  LEFT JOIN ordenes_compra oc ON oc.id = k.orden_compra_id
  LEFT JOIN articulos a ON a.id = k.articulo_id
 ORDER BY b.motivo, oc.numero_orden, a.sku;

-- Para revisar aparte (NO se borra): compras confirmadas de una orden, sin recepción y SIN gemela.
-- Si aparece algo acá, es una compra que solo existe en este renglón: avisar antes de tocarla.
SELECT oc.numero_orden, oc.estado AS estado_orden, a.sku, a.descripcion, k.cantidad,
       to_char(k.fecha AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY') AS fecha,
       (k.fecha > now()) AS fecha_futura, k.id
  FROM kardex k
  LEFT JOIN ordenes_compra oc ON oc.id = k.orden_compra_id
  LEFT JOIN articulos a ON a.id = k.articulo_id
 WHERE k.tipo_movimiento = 'compra' AND k.estado = 'confirmado'
   AND k.orden_compra_id IS NOT NULL AND k.recepcion_id IS NULL
   AND NOT EXISTS (
         SELECT 1 FROM kardex g
           JOIN recepciones r ON r.id = g.recepcion_id
          WHERE r.orden_compra_id = k.orden_compra_id
            AND g.articulo_id = k.articulo_id
            AND g.tipo_movimiento = 'compra' AND g.estado = 'confirmado')
 ORDER BY oc.numero_orden, a.sku;


-- ───────────────────────── PASO 2 — BORRAR (con copia de respaldo) ─────────────────────────
-- Todo junto, en una sola transacción: o se hace completo o no se hace nada.
-- Se puede correr dos veces: la segunda no encuentra nada para borrar.
BEGIN;

CREATE TABLE IF NOT EXISTS public.kardex_respaldo_entrada_20261117 AS
  SELECT k.*, ''::text AS motivo_limpieza, now() AS respaldado_at FROM kardex k WHERE false;
ALTER TABLE public.kardex_respaldo_entrada_20261117 ENABLE ROW LEVEL SECURITY;

CREATE TEMP TABLE _entrada_a_borrar ON COMMIT DROP AS
  SELECT k.id, 'A duplicada'::text AS motivo
    FROM kardex k
   WHERE k.tipo_movimiento = 'compra' AND k.estado = 'confirmado'
     AND k.orden_compra_id IS NOT NULL AND k.recepcion_id IS NULL
     AND EXISTS (
           SELECT 1 FROM kardex g
             JOIN recepciones r ON r.id = g.recepcion_id
            WHERE r.orden_compra_id = k.orden_compra_id
              AND g.articulo_id = k.articulo_id
              AND g.tipo_movimiento = 'compra' AND g.estado = 'confirmado')
  UNION
  SELECT k.id, 'B orden cerrada'
    FROM kardex k
    LEFT JOIN ordenes_compra oc ON oc.id = k.orden_compra_id
   WHERE k.tipo_movimiento = 'compra' AND k.estado = 'pendiente'
     AND k.orden_compra_id IS NOT NULL
     AND (oc.id IS NULL OR oc.estado IN ('finalizada', 'cancelada'))
  UNION
  SELECT k.id, 'C ya llegó'
    FROM kardex k
    JOIN ordenes_compra oc ON oc.id = k.orden_compra_id
   WHERE k.tipo_movimiento = 'compra' AND k.estado = 'pendiente'
     AND oc.estado = 'recibida_completa';

INSERT INTO public.kardex_respaldo_entrada_20261117
  SELECT k.*, b.motivo, now() FROM kardex k JOIN _entrada_a_borrar b ON b.id = k.id;

DELETE FROM kardex k USING _entrada_a_borrar b WHERE k.id = b.id;

COMMIT;

-- Cuántos renglones se borraron en total, por motivo (tiene que coincidir con lo que listó el PASO 1)
SELECT motivo_limpieza AS motivo, count(*) AS renglones_borrados
  FROM public.kardex_respaldo_entrada_20261117
 GROUP BY motivo_limpieza ORDER BY 1;

-- Si hiciera falta deshacerlo: lo borrado quedó completo en public.kardex_respaldo_entrada_20261117
-- (mismas columnas que kardex + motivo_limpieza y respaldado_at). Pedirle a sistemas que lo restaure.
