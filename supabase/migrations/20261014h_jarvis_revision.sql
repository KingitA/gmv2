-- ═══════════════════════════════════════════════════════════════════════
-- JARVIS · Correcciones de la revisión de código (14/10/2026).
--
-- 1. SEGURIDAD: ai_agenda_events, ai_conversations y ai_messages tenían la
--    seguridad por fila APAGADA. La migración 0 borró la regla abierta, pero con
--    RLS apagado no cambiaba nada: con la clave pública se podían leer las
--    charlas y tocar la agenda (hasta falsificar un "Sí" a nombre de otro).
--    Se prende RLS sin reglas (solo el servidor, con la service key, entra) y se
--    sacan los permisos a anon/authenticated. Lo mismo para las tablas nuevas.
-- 2. La bitácora pone SIEMPRE la hora real (no la que mande quien inserta).
-- 3. Una sola propuesta/aviso "vivo" por clave (índice único parcial).
-- 4. Paradas: se recuerda si "cobrar lo anterior" lo puso la retención.
-- 5. Retener/liberar: si quien cambia no dejó su usuario, queda vacío (no se
--    culpa al último que tocó el cliente).
-- 6. Consultas: ventas con notas de débito; proveedores con deuda real (sin
--    estimados), costo con signo, "aumento" = solo subas; perfil de insumos con
--    notas de crédito. Índice para el historial de precios.
-- 7. Las funciones jarvis_* las llama solo el servidor.
--
-- IDEMPOTENTE.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. Seguridad ──────────────────────────────────────────────────────
ALTER TABLE public.ai_agenda_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_messages      ENABLE ROW LEVEL SECURITY;
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ai_agenda_events','ai_conversations','ai_messages','ai_registro','ai_ajustes','ai_uso',
                           'ai_insumos','ai_articulo_insumos','ai_indicadores_externos'] LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
  END LOOP;
END
$do$;

-- ─── 2. Hora real en la bitácora ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ai_registro_hora_real() RETURNS trigger
LANGUAGE plpgsql AS $f$
BEGIN
  NEW.created_at := now();
  RETURN NEW;
END;
$f$;
DROP TRIGGER IF EXISTS trg_ai_registro_hora_real ON public.ai_registro;
CREATE TRIGGER trg_ai_registro_hora_real BEFORE INSERT ON public.ai_registro
  FOR EACH ROW EXECUTE FUNCTION public.ai_registro_hora_real();

-- ─── 3. Una sola propuesta / aviso vivo por clave ──────────────────────
-- (si hoy hubiera duplicados vivos, se cierran los más nuevos antes de crear el índice)
UPDATE public.ai_agenda_events e SET status = 'completada', cierre_nota = 'Duplicado (limpieza 14/10)', cerrado_at = now()
WHERE e.clave IS NOT NULL AND e.status IN ('pendiente', 'en_progreso')
  AND EXISTS (SELECT 1 FROM public.ai_agenda_events o
              WHERE o.clave = e.clave AND o.event_type = e.event_type AND o.status IN ('pendiente', 'en_progreso')
                AND (o.created_at < e.created_at OR (o.created_at = e.created_at AND o.id < e.id)));
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_agenda_clave_viva ON public.ai_agenda_events (event_type, clave)
  WHERE clave IS NOT NULL AND status IN ('pendiente', 'en_progreso');

-- ─── 4. Paradas: quién puso "cobrar lo anterior" ───────────────────────
ALTER TABLE public.viajes_paradas ADD COLUMN IF NOT EXISTS retencion_puso_cobro BOOLEAN NOT NULL DEFAULT false;
UPDATE public.viajes_paradas SET retencion_puso_cobro = true
  WHERE bloquear_entrega AND motivo_bloqueo LIKE 'Retenido: %' AND exigir_cobro_anterior;

-- ─── 5. Retener / liberar: no culpar a quien no fue ────────────────────
CREATE OR REPLACE FUNCTION public.clientes_registrar_retencion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE quien uuid;
BEGIN
  IF NEW.retener_entregas IS DISTINCT FROM OLD.retener_entregas THEN
    -- Solo se toma el usuario si ESTE cambio lo dejó (si no, queda vacío = "sin usuario")
    quien := CASE
      WHEN NEW.retener_entregas AND NEW.retener_por IS DISTINCT FROM OLD.retener_por THEN NEW.retener_por
      WHEN NEW.actualizado_por IS DISTINCT FROM OLD.actualizado_por OR NEW.actualizado_at IS DISTINCT FROM OLD.actualizado_at THEN NEW.actualizado_por
      ELSE NULL END;
    INSERT INTO ai_registro (usuario_id, accion, entidad_tipo, entidad_id, detalle)
    VALUES (quien,
      CASE WHEN NEW.retener_entregas THEN 'cliente_retenido' ELSE 'cliente_liberado' END,
      'cliente', NEW.id::text,
      jsonb_build_object(
        'titulo', CASE WHEN NEW.retener_entregas THEN 'Retener entregas a ' ELSE 'Liberar entregas a ' END || COALESCE(NEW.nombre, ''),
        'nota', CASE WHEN NEW.retener_entregas THEN NEW.retener_motivo ELSE 'Tenía: ' || COALESCE(OLD.retener_motivo, '—') END,
        'entidad', jsonb_build_object('tipo', 'cliente', 'id', NEW.id)));
  END IF;
  RETURN NEW;
END;
$f$;

-- ─── 6. Consultas corregidas ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.jarvis_ventas(
  p_desde date, p_hasta date, p_agrupar text DEFAULT 'total',
  p_zona_id uuid DEFAULT NULL, p_vendedor_id uuid DEFAULT NULL,
  p_cliente_id uuid DEFAULT NULL, p_proveedor_id uuid DEFAULT NULL,
  p_categoria text DEFAULT NULL)
RETURNS TABLE(clave text, clave_id text, total numeric, neto numeric, costo numeric,
              unidades numeric, clientes bigint, pedidos bigint)
LANGUAGE sql STABLE AS $$
  WITH movs AS (
    SELECT k.*,
      (k.fecha AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS f,
      CASE WHEN k.tipo_movimiento = 'nota_credito_venta' THEN -1 ELSE 1 END AS sg,
      CASE WHEN COALESCE(k.precio_costo, 0) > 0 THEN k.precio_costo
           WHEN COALESCE(a.ultimo_costo, 0) > 0 THEN a.ultimo_costo
           ELSE COALESCE(a.precio_compra, 0) END AS costo_unit,
      l.zona_id
    FROM kardex k
    LEFT JOIN articulos a ON a.id = k.articulo_id
    LEFT JOIN clientes c ON c.id = k.cliente_id
    LEFT JOIN localidades l ON l.id = c.localidad_id
    WHERE k.tipo_movimiento IN ('venta', 'nota_credito_venta', 'nota_debito_venta')
      AND COALESCE(k.pedido_eliminado, false) = false
      AND k.fecha >= (p_desde::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires')
      AND k.fecha <  ((p_hasta + 1)::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires')
      AND (p_zona_id IS NULL OR l.zona_id = p_zona_id)
      AND (p_vendedor_id IS NULL OR k.vendedor_id = p_vendedor_id)
      AND (p_cliente_id IS NULL OR k.cliente_id = p_cliente_id)
      AND (p_proveedor_id IS NULL OR k.articulo_proveedor_id = p_proveedor_id)
      AND (p_categoria IS NULL OR k.articulo_categoria ILIKE p_categoria)
  ), agrup AS (
    SELECT m.*,
      CASE p_agrupar
        WHEN 'cliente'   THEN m.cliente_id::text
        WHEN 'articulo'  THEN m.articulo_id::text
        WHEN 'vendedor'  THEN m.vendedor_id::text
        WHEN 'zona'      THEN m.zona_id::text
        WHEN 'proveedor' THEN m.articulo_proveedor_id::text
        WHEN 'categoria' THEN COALESCE(m.articulo_categoria, 'Sin categoría')
        WHEN 'dia'       THEN to_char(m.f, 'YYYY-MM-DD')
        WHEN 'semana'    THEN to_char(date_trunc('week', m.f), 'YYYY-MM-DD')
        WHEN 'mes'       THEN to_char(m.f, 'YYYY-MM')
        ELSE 'total'
      END AS k_id
    FROM movs m
  )
  SELECT
    COALESCE(
      CASE p_agrupar
        WHEN 'cliente'   THEN (SELECT COALESCE(c.nombre, c.nombre_razon_social) FROM clientes c WHERE c.id::text = g.k_id)
        WHEN 'articulo'  THEN MAX(g.articulo_descripcion)
        WHEN 'vendedor'  THEN (SELECT v.nombre FROM vendedores v WHERE v.id::text = g.k_id)
        WHEN 'zona'      THEN (SELECT z.nombre FROM zonas z WHERE z.id::text = g.k_id)
        WHEN 'proveedor' THEN (SELECT p.nombre FROM proveedores p WHERE p.id::text = g.k_id)
        ELSE g.k_id
      END, 'Sin dato')::text AS clave,
    g.k_id AS clave_id,
    ROUND(SUM(g.sg * COALESCE(g.subtotal_total, 0)), 2) AS total,
    ROUND(SUM(g.sg * COALESCE(g.subtotal_neto, g.subtotal_total, 0)), 2) AS neto,
    ROUND(SUM(g.sg * g.costo_unit * ABS(COALESCE(g.cantidad, 0))), 2) AS costo,
    SUM(g.sg * COALESCE(g.cantidad, 0)) AS unidades,
    COUNT(DISTINCT g.cliente_id) AS clientes,
    COUNT(DISTINCT g.pedido_id) AS pedidos
  FROM agrup g
  GROUP BY g.k_id
  ORDER BY 3 DESC NULLS LAST
$$;

DROP FUNCTION IF EXISTS public.jarvis_proveedores_resumen(uuid);
CREATE OR REPLACE FUNCTION public.jarvis_proveedores_resumen(p_proveedor_id uuid DEFAULT NULL)
RETURNS TABLE(proveedor_id uuid, proveedor text, articulos_activos bigint,
              venta_30d numeric, costo_30d numeric, ultimo_aumento date, dias_sin_aumento integer,
              articulos_aumentados_90d bigint, aumento_promedio_pct_90d numeric,
              deuda_pendiente numeric, deuda_vencida numeric, proximo_vencimiento date, oc_abiertas bigint,
              deuda_estimada numeric)
LANGUAGE sql STABLE AS $$
  WITH v30 AS (
    SELECT k.articulo_proveedor_id AS pid,
      SUM(CASE WHEN k.tipo_movimiento = 'nota_credito_venta' THEN -1 ELSE 1 END * COALESCE(k.subtotal_neto, k.subtotal_total, 0)) AS neto,
      SUM(CASE WHEN k.tipo_movimiento = 'nota_credito_venta' THEN -1 ELSE 1 END
          * CASE WHEN COALESCE(k.precio_costo, 0) > 0 THEN k.precio_costo
                 WHEN COALESCE(a.ultimo_costo, 0) > 0 THEN a.ultimo_costo
                 ELSE COALESCE(a.precio_compra, 0) END
          * ABS(COALESCE(k.cantidad, 0))) AS costo
    FROM kardex k LEFT JOIN articulos a ON a.id = k.articulo_id
    WHERE k.tipo_movimiento IN ('venta', 'nota_credito_venta')
      AND COALESCE(k.pedido_eliminado, false) = false
      AND k.fecha >= ((public.hoy_ar() - 30)::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires')
      AND (p_proveedor_id IS NULL OR k.articulo_proveedor_id = p_proveedor_id)
    GROUP BY 1
  ), versiones AS (
    -- Historial de precios de artículos (desde 18/09/2026; la versión del
    -- 01/01/2000 es la foto inicial, no un cambio). Aumento = cambió precio_compra.
    -- Solo versiones CON precio: así una versión sin precio no corta la comparación
    SELECT h.registro_id, h.datos->>'proveedor_id' AS pid, h.vigente_desde,
      (h.datos->>'precio_compra')::numeric AS pc,
      LAG((h.datos->>'precio_compra')::numeric) OVER (PARTITION BY h.registro_id ORDER BY h.vigente_desde) AS pc_ant
    FROM precio_insumos_historial h
    WHERE h.tabla = 'articulos' AND NULLIF(h.datos->>'precio_compra', '')::numeric > 0
  ), aumentos AS (
    SELECT pid,
      MAX(vigente_desde) AS ultimo,
      COUNT(DISTINCT registro_id) FILTER (WHERE vigente_desde >= (public.hoy_ar() - 90)) AS n90,
      AVG((pc / pc_ant - 1) * 100) FILTER (WHERE vigente_desde >= (public.hoy_ar() - 90)) AS pct90
    FROM versiones
    WHERE pc_ant > 0 AND pc > pc_ant   -- solo subas (una baja no es "aumentó")
    GROUP BY pid
  )
  SELECT p.id AS proveedor_id, p.nombre::text AS proveedor,
    (SELECT COUNT(*) FROM articulos a WHERE a.proveedor_id = p.id AND a.activo IS NOT FALSE) AS articulos_activos,
    ROUND(COALESCE(v.neto, 0), 2) AS venta_30d, ROUND(COALESCE(v.costo, 0), 2) AS costo_30d,
    (au.ultimo AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS ultimo_aumento,
    public.hoy_ar() - (au.ultimo AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS dias_sin_aumento,
    COALESCE(au.n90, 0) AS articulos_aumentados_90d, ROUND(au.pct90, 1) AS aumento_promedio_pct_90d,
    ROUND(COALESCE(ve.pend, 0), 2) AS deuda_pendiente, ROUND(COALESCE(ve.venc, 0), 2) AS deuda_vencida, ve.prox AS proximo_vencimiento,
    (SELECT COUNT(*) FROM ordenes_compra o WHERE o.proveedor_id = p.id
       AND o.estado NOT IN ('recibida_completa', 'cancelada', 'anulada')) AS oc_abiertas,
    ROUND(COALESCE(ve.estimado, 0), 2) AS deuda_estimada
  FROM proveedores p
  LEFT JOIN v30 v ON v.pid = p.id
  LEFT JOIN aumentos au ON au.pid = p.id::text
  LEFT JOIN LATERAL (
    -- Deuda real = vencimientos NO estimados; los estimados van aparte
    SELECT SUM(vc.monto) FILTER (WHERE NOT COALESCE(vc.es_estimado, false)) AS pend,
      SUM(vc.monto) FILTER (WHERE NOT COALESCE(vc.es_estimado, false) AND vc.fecha_vencimiento < public.hoy_ar()) AS venc,
      SUM(vc.monto) FILTER (WHERE COALESCE(vc.es_estimado, false)) AS estimado,
      MIN(vc.fecha_vencimiento) FILTER (WHERE vc.fecha_vencimiento >= public.hoy_ar()) AS prox
    FROM vencimientos vc WHERE vc.proveedor_id = p.id AND vc.estado IN ('pendiente', 'vencido')
  ) ve ON true
  WHERE (p_proveedor_id IS NULL OR p.id = p_proveedor_id)
  ORDER BY v.neto DESC NULLS LAST
$$;
GRANT EXECUTE ON FUNCTION public.jarvis_proveedores_resumen(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.jarvis_proveedor_insumos(p_proveedor_id uuid DEFAULT NULL)
RETURNS TABLE(proveedor_id uuid, proveedor text, insumo text, articulos bigint, articulos_clasificados bigint,
              venta_90d numeric, participacion_pct numeric)
LANGUAGE sql STABLE AS $$
  WITH arts AS (
    SELECT a.id, a.proveedor_id, ai.insumo, a.activo IS NOT FALSE AS activo
    FROM articulos a
    LEFT JOIN ai_articulo_insumos ai ON ai.articulo_id = a.id
    WHERE a.proveedor_id IS NOT NULL
      AND (p_proveedor_id IS NULL OR a.proveedor_id = p_proveedor_id)
  ), venta AS (
    SELECT k.articulo_id, SUM(CASE WHEN k.tipo_movimiento = 'nota_credito_venta' THEN -1 ELSE 1 END * COALESCE(k.subtotal_neto, k.subtotal_total, 0)) AS neto
    FROM kardex k
    WHERE k.tipo_movimiento IN ('venta', 'nota_credito_venta', 'nota_debito_venta') AND COALESCE(k.pedido_eliminado, false) = false
      AND k.fecha >= ((public.hoy_ar() - 90)::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires')
    GROUP BY k.articulo_id
  ), por AS (
    SELECT a.proveedor_id, COALESCE(a.insumo, 'sin_clasificar') AS insumo,
      COUNT(*) FILTER (WHERE a.activo) AS n, COUNT(a.insumo) FILTER (WHERE a.activo) AS n_clas, COALESCE(SUM(v.neto), 0) AS neto
    FROM arts a LEFT JOIN venta v ON v.articulo_id = a.id
    GROUP BY 1, 2
  ), tot AS (
    SELECT proveedor_id, SUM(neto) AS neto, SUM(n) AS n FROM por GROUP BY 1
  )
  SELECT p.proveedor_id, pr.nombre::text, p.insumo, p.n, p.n_clas, ROUND(p.neto, 2),
    ROUND(100 * CASE WHEN t.neto > 0 THEN p.neto / t.neto ELSE p.n::numeric / NULLIF(t.n, 0) END, 1)
  FROM por p JOIN tot t ON t.proveedor_id = p.proveedor_id
  JOIN proveedores pr ON pr.id = p.proveedor_id
  ORDER BY pr.nombre, 7 DESC
$$;

CREATE INDEX IF NOT EXISTS idx_pih_tabla_registro_desde ON public.precio_insumos_historial (tabla, registro_id, vigente_desde);

-- ─── 7. Funciones jarvis_*: solo el servidor ───────────────────────────
REVOKE EXECUTE ON FUNCTION public.jarvis_ventas(date, date, text, uuid, uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.jarvis_deuda_antiguedad(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.jarvis_clientes_habitos(integer, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.jarvis_cobertura_stock(uuid, text, integer, numeric, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.jarvis_proveedores_resumen(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.jarvis_proveedor_insumos(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jarvis_ventas(date, date, text, uuid, uuid, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.jarvis_deuda_antiguedad(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.jarvis_clientes_habitos(integer, uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.jarvis_cobertura_stock(uuid, text, integer, numeric, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.jarvis_proveedor_insumos(uuid) TO service_role;
