-- ============================================================================
-- playroom_comisiones_viajantes v2 — "cobrada" lee la tabla comisiones
-- ============================================================================
-- Antes, para p_tipo='cobrada' se sumaba kardex.comision_viajante_monto de las
-- líneas con comprobante_cobrado: es la comisión VENDIDA (antes del 10% de
-- contado). La comisión efectivamente cobrada vive en comisiones tipo
-- 'cobrada' (filas por línea + el débito −10% cuando hubo NC/REV de contado).
-- Ej. Fitterer PRES 10: vendida 17.219,56 → cobrada 15.497,60.
--
-- 'vendida' sigue saliendo del kardex (fuente de verdad de la venta); el flag
-- pagado se toma de la comisión 'vendida' vinculada (antes el join sin tipo
-- podía duplicar filas cuando la 'cobrada' también apuntaba al kardex).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.playroom_comisiones_viajantes(
  p_from date, p_to date, p_prev_from date, p_prev_to date,
  p_tipo text DEFAULT 'vendida'::text, p_viajante_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  vendedor_id uuid, devengado numeric, devengado_prev numeric, cobrable numeric,
  pagado numeric, pendiente numeric, cantidad_pedidos bigint, cantidad_clientes bigint, por_segmento jsonb
)
LANGUAGE sql
STABLE
AS $function$
  WITH base AS (
    -- VENDIDA: kardex
    SELECT
      k.vendedor_id,
      k.pedido_id,
      k.cliente_id,
      COALESCE(k.articulo_categoria, 'sin_segmento') AS segmento,
      COALESCE(k.comision_viajante_monto, 0) AS monto,
      k.comprobante_cobrado,
      COALESCE(co.pagado, false) AS esta_pagado,
      (k.fecha AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS f
    FROM kardex k
    LEFT JOIN comisiones co ON co.kardex_id = k.id AND co.tipo = 'vendida'
    WHERE p_tipo <> 'cobrada'
      AND k.tipo_movimiento = 'venta'
      AND k.comision_viajante_monto IS NOT NULL
      AND k.comision_viajante_monto <> 0
      AND k.pedido_eliminado = false
      AND (p_viajante_id IS NULL OR k.vendedor_id = p_viajante_id)
      AND k.fecha >= (LEAST(p_prev_from, p_from)::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires')
      AND k.fecha <  ((GREATEST(p_prev_to, p_to) + 1)::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires')

    UNION ALL

    -- COBRADA: comisiones (incluye el −10% de contado como fila negativa)
    SELECT
      c.viajante_id,
      c.pedido_id,
      COALESCE(k.cliente_id, p.cliente_id),
      COALESCE(k.articulo_categoria, CASE WHEN c.monto < 0 THEN 'dto. 10% contado' ELSE 'sin_segmento' END) AS segmento,
      COALESCE(c.monto, 0) AS monto,
      true AS comprobante_cobrado,
      COALESCE(c.pagado, false) AS esta_pagado,
      (COALESCE(c.fecha_comprobante_cobrado, c.created_at) AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS f
    FROM comisiones c
    LEFT JOIN kardex k ON k.id = c.kardex_id
    LEFT JOIN pedidos p ON p.id = c.pedido_id
    WHERE p_tipo = 'cobrada'
      AND c.tipo = 'cobrada'
      AND c.monto <> 0
      AND (p_viajante_id IS NULL OR c.viajante_id = p_viajante_id)
      AND COALESCE(c.fecha_comprobante_cobrado, c.created_at)
            >= (LEAST(p_prev_from, p_from)::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires')
      AND COALESCE(c.fecha_comprobante_cobrado, c.created_at)
            <  ((GREATEST(p_prev_to, p_to) + 1)::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires')
  ),
  seg AS (
    SELECT b.vendedor_id AS v_id, b.segmento, SUM(b.monto) AS monto_seg
    FROM base b
    WHERE b.f BETWEEN p_from AND p_to
    GROUP BY b.vendedor_id, b.segmento
  ),
  seg_json AS (
    SELECT s.v_id, jsonb_object_agg(s.segmento, s.monto_seg) AS por_segmento
    FROM seg s
    GROUP BY s.v_id
  )
  SELECT
    b.vendedor_id,
    COALESCE(SUM(b.monto) FILTER (WHERE b.f BETWEEN p_from AND p_to), 0),
    COALESCE(SUM(b.monto) FILTER (WHERE b.f BETWEEN p_prev_from AND p_prev_to), 0),
    COALESCE(SUM(b.monto) FILTER (WHERE b.f BETWEEN p_from AND p_to AND b.comprobante_cobrado), 0),
    COALESCE(SUM(b.monto) FILTER (WHERE b.f BETWEEN p_from AND p_to AND b.esta_pagado), 0),
    COALESCE(SUM(b.monto) FILTER (WHERE b.f BETWEEN p_from AND p_to AND b.comprobante_cobrado AND NOT b.esta_pagado), 0),
    COUNT(DISTINCT b.pedido_id) FILTER (WHERE b.f BETWEEN p_from AND p_to),
    COUNT(DISTINCT b.cliente_id) FILTER (WHERE b.f BETWEEN p_from AND p_to),
    COALESCE(MAX(sj.por_segmento::text)::jsonb, '{}'::jsonb)
  FROM base b
  LEFT JOIN seg_json sj ON sj.v_id = b.vendedor_id
  GROUP BY b.vendedor_id
$function$;
