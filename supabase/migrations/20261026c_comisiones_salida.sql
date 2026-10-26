-- Comisiones en la prueba de salida (#10, #11) — cuentas corrientes, 26/10/2026
--
-- #10  "sin cobrar" inflado: 41 pedidos ELIMINADOS (agosto, antes de que la
--      baja marcara el kardex) siguen con kardex.pedido_eliminado = false, y la
--      función del Playroom suma también los pedidos en SISTEMA_VIEJO (esas
--      comisiones se liquidan en el sistema viejo, regla 36).
-- #11  kardex.numero_pedido null en 50.076 de 54.557 renglones con pedido: el
--      alta del ERP/app no lo pasaba. Se rellena y un trigger lo completa
--      siempre al insertar (cualquier camino).
--
-- Idempotente: se puede correr dos veces.

SET statement_timeout = '15min';

-- ── 1. Kardex de pedidos eliminados → pedido_eliminado = true ──────────────
-- Con el trigger de comisiones ACTIVO: borra las comisiones 'vendida' no
-- pagadas de esos renglones (lo mismo que hace hoy la baja de un pedido).
UPDATE public.kardex k
SET pedido_eliminado = true
FROM public.pedidos p
WHERE p.id = k.pedido_id
  AND p.estado = 'eliminado'
  AND k.pedido_eliminado IS DISTINCT FROM true;

-- ── 2. Número de pedido en el kardex (relleno) ─────────────────────────────
-- Sin el trigger de comisiones: cambiar el número no toca comisiones y son
-- ~50.000 renglones (cada disparo hacía un UPDATE en comisiones).
ALTER TABLE public.kardex DISABLE TRIGGER trg_sync_comision_update;

UPDATE public.kardex k
SET numero_pedido = p.numero_pedido
FROM public.pedidos p
WHERE p.id = k.pedido_id
  AND k.numero_pedido IS NULL
  AND p.numero_pedido IS NOT NULL;

ALTER TABLE public.kardex ENABLE TRIGGER trg_sync_comision_update;

-- ── 3. Trigger: completar numero_pedido al insertar ────────────────────────
CREATE OR REPLACE FUNCTION public.kardex_completar_numero_pedido()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.pedido_id IS NOT NULL AND NEW.numero_pedido IS NULL THEN
    SELECT p.numero_pedido INTO NEW.numero_pedido FROM public.pedidos p WHERE p.id = NEW.pedido_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_kardex_numero_pedido ON public.kardex;
CREATE TRIGGER trg_kardex_numero_pedido
  BEFORE INSERT ON public.kardex
  FOR EACH ROW
  WHEN (NEW.pedido_id IS NOT NULL AND NEW.numero_pedido IS NULL)
  EXECUTE FUNCTION public.kardex_completar_numero_pedido();

-- ── 4. Playroom: comisiones vendidas sin pedidos eliminados ni sistema viejo ─
-- La rama 'cobrada' queda por compatibilidad: el ERP ya no la usa (lee la
-- cuenta personal, lib/comisiones/ganadas.ts, #42).
CREATE OR REPLACE FUNCTION public.playroom_comisiones_viajantes(p_from date, p_to date, p_prev_from date, p_prev_to date, p_tipo text DEFAULT 'vendida'::text, p_viajante_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(vendedor_id uuid, devengado numeric, devengado_prev numeric, cobrable numeric, pagado numeric, pendiente numeric, cantidad_pedidos bigint, cantidad_clientes bigint, por_segmento jsonb)
 LANGUAGE sql
 STABLE
AS $function$
  WITH base AS (
    -- VENDIDA: kardex
    SELECT
      k.vendedor_id, k.pedido_id, k.cliente_id,
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
      AND NOT EXISTS (
        SELECT 1 FROM pedidos pe
        WHERE pe.id = k.pedido_id AND pe.estado IN ('eliminado', 'sistema_viejo')
      )
      AND (p_viajante_id IS NULL OR k.vendedor_id = p_viajante_id)
      AND k.fecha >= (LEAST(p_prev_from, p_from)::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires')
      AND k.fecha <  ((GREATEST(p_prev_to, p_to) + 1)::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires')

    UNION ALL

    -- COBRADA: tabla comisiones (incluye el −10% de contado como fila negativa)
    SELECT
      c.viajante_id, c.pedido_id,
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
    FROM base b WHERE b.f BETWEEN p_from AND p_to
    GROUP BY b.vendedor_id, b.segmento
  ),
  seg_json AS (
    SELECT s.v_id, jsonb_object_agg(s.segmento, s.monto_seg) AS por_segmento
    FROM seg s GROUP BY s.v_id
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

-- ── Verificación (tiene que dar 0 y 0) ──
SELECT
  (SELECT count(*) FROM kardex k JOIN pedidos p ON p.id = k.pedido_id
    WHERE p.estado = 'eliminado' AND k.pedido_eliminado = false) AS eliminados_sin_marcar,
  (SELECT count(*) FROM kardex k JOIN pedidos p ON p.id = k.pedido_id
    WHERE k.numero_pedido IS NULL AND p.numero_pedido IS NOT NULL) AS sin_numero;
