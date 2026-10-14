-- ═══════════════════════════════════════════════════════════════════════
-- JARVIS · Etapa 1: consultas que usa el chat (y después los vigías).
-- Todas son de SOLO LECTURA (STABLE) y agregan en la base: a la IA le llega
-- el resumen, nunca miles de renglones (docs/playroom-cerebro/PLAN.md §6).
--
-- Fuentes (las mismas que el tablero, para que nunca digan números distintos):
--   ventas  = kardex, tipo 'venta'/'nota_credito_venta', pedido_eliminado = false
--             (coincide con pedidos no eliminados; mismo costo que
--             playroom_articulos_vendidos)
--   deuda   = libro mayor cuenta_corriente_clientes (= v_saldo_clientes, fuente
--             única). La antigüedad se reparte por FIFO: lo que se pagó cancela
--             lo más viejo, lo que queda debiendo son las compras más nuevas.
--             (v_aging_clientes NO se usa: sale de comprobantes_venta y no
--             coincide con el libro, y su zona sale de clientes_zonas, que está
--             casi vacía.)
--   zona    = clientes.localidad_id → localidades.zona_id
--
-- ADITIVA e IDEMPOTENTE.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── Ventas agrupadas ──────────────────────────────────────────────────
-- p_agrupar: cliente | articulo | vendedor | zona | proveedor | categoria |
--            dia | semana | mes | total
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
    WHERE k.tipo_movimiento IN ('venta', 'nota_credito_venta')
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

-- ─── Deuda por antigüedad (libro mayor + FIFO) ─────────────────────────
CREATE OR REPLACE FUNCTION public.jarvis_deuda_antiguedad(
  p_zona_id uuid DEFAULT NULL, p_vendedor_id uuid DEFAULT NULL, p_cliente_id uuid DEFAULT NULL)
RETURNS TABLE(cliente_id uuid, cliente text, localidad text, zona text, vendedor text,
              saldo numeric, d0_29 numeric, d30_59 numeric, d60_89 numeric, d90_mas numeric,
              dias_mas_vieja integer, ultima_compra date, ultimo_pago date)
LANGUAGE sql STABLE AS $$
  WITH saldos AS (
    SELECT cc.cliente_id, SUM(COALESCE(cc.debe, 0)) - SUM(COALESCE(cc.haber, 0)) AS s
    FROM cuenta_corriente_clientes cc
    WHERE p_cliente_id IS NULL OR cc.cliente_id = p_cliente_id
    GROUP BY cc.cliente_id
    HAVING SUM(COALESCE(cc.debe, 0)) - SUM(COALESCE(cc.haber, 0)) > 0.5
  ), debitos AS (
    SELECT cc.cliente_id, (cc.fecha AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS f, cc.debe,
      SUM(cc.debe) OVER (PARTITION BY cc.cliente_id ORDER BY cc.fecha DESC, cc.id DESC) AS acum
    FROM cuenta_corriente_clientes cc
    JOIN saldos s ON s.cliente_id = cc.cliente_id
    WHERE COALESCE(cc.debe, 0) > 0
  ), pendiente AS (
    SELECT d.cliente_id, d.f, GREATEST(0, LEAST(d.debe, s.s - (d.acum - d.debe))) AS monto,
      public.hoy_ar() - d.f AS dias
    FROM debitos d JOIN saldos s ON s.cliente_id = d.cliente_id
  ), por_cliente AS (
    SELECT p.cliente_id,
      SUM(p.monto) FILTER (WHERE p.dias < 30)               AS d0,
      SUM(p.monto) FILTER (WHERE p.dias BETWEEN 30 AND 59)  AS d30,
      SUM(p.monto) FILTER (WHERE p.dias BETWEEN 60 AND 89)  AS d60,
      SUM(p.monto) FILTER (WHERE p.dias >= 90)              AS d90,
      MAX(p.dias)  FILTER (WHERE p.monto > 0.5)             AS mas_vieja
    FROM pendiente p GROUP BY p.cliente_id
  )
  SELECT c.id AS cliente_id, COALESCE(c.nombre, c.nombre_razon_social)::text AS cliente, l.nombre::text AS localidad, z.nombre::text AS zona, v.nombre::text AS vendedor,
    ROUND(s.s, 2) AS saldo,
    ROUND(COALESCE(pc.d0, 0), 2) AS d0_29, ROUND(COALESCE(pc.d30, 0), 2) AS d30_59,
    ROUND(COALESCE(pc.d60, 0), 2) AS d60_89, ROUND(COALESCE(pc.d90, 0), 2) AS d90_mas,
    pc.mas_vieja AS dias_mas_vieja,
    (SELECT MAX(pe.fecha) FROM pedidos pe WHERE pe.cliente_id = c.id AND pe.estado <> 'eliminado') AS ultima_compra,
    (SELECT MAX((cc.fecha AT TIME ZONE 'America/Argentina/Buenos_Aires')::date) FROM cuenta_corriente_clientes cc
      WHERE cc.cliente_id = c.id AND cc.tipo_movimiento = 'pago') AS ultimo_pago
  FROM saldos s
  JOIN clientes c ON c.id = s.cliente_id
  LEFT JOIN por_cliente pc ON pc.cliente_id = s.cliente_id
  LEFT JOIN localidades l ON l.id = c.localidad_id
  LEFT JOIN zonas z ON z.id = l.zona_id
  LEFT JOIN vendedores v ON v.id = c.vendedor_id
  WHERE (p_zona_id IS NULL OR l.zona_id = p_zona_id)
    AND (p_vendedor_id IS NULL OR c.vendedor_id = p_vendedor_id)
  ORDER BY s.s DESC
$$;

-- ─── Hábitos de compra por cliente ─────────────────────────────────────
-- Para "clientes habituales que dejaron de comprar" y para la ficha de un
-- cliente. Mira los últimos p_meses meses de pedidos no eliminados.
CREATE OR REPLACE FUNCTION public.jarvis_clientes_habitos(
  p_meses integer DEFAULT 4, p_zona_id uuid DEFAULT NULL,
  p_vendedor_id uuid DEFAULT NULL, p_cliente_id uuid DEFAULT NULL)
RETURNS TABLE(cliente_id uuid, cliente text, localidad text, zona text, vendedor text,
              pedidos bigint, meses_con_compra bigint, venta_mensual_promedio numeric,
              dias_entre_compras numeric, ultima_compra date, dias_sin_comprar integer)
LANGUAGE sql STABLE AS $$
  WITH peds AS (
    SELECT pe.cliente_id, pe.fecha, pe.total
    FROM pedidos pe
    WHERE pe.estado <> 'eliminado'
      AND pe.fecha >= (public.hoy_ar() - make_interval(months => p_meses))::date
      AND (p_cliente_id IS NULL OR pe.cliente_id = p_cliente_id)
  ), fechas AS (
    SELECT DISTINCT cliente_id, fecha FROM peds
  ), gaps AS (
    SELECT cliente_id, fecha - LAG(fecha) OVER (PARTITION BY cliente_id ORDER BY fecha) AS gap FROM fechas
  ), agg AS (
    SELECT p.cliente_id, COUNT(*) AS n, COUNT(DISTINCT date_trunc('month', p.fecha)) AS meses,
      SUM(p.total) AS venta, MAX(p.fecha) AS ultima
    FROM peds p GROUP BY p.cliente_id
  )
  SELECT c.id AS cliente_id, COALESCE(c.nombre, c.nombre_razon_social)::text AS cliente, l.nombre::text AS localidad, z.nombre::text AS zona, v.nombre::text AS vendedor,
    a.n AS pedidos, a.meses AS meses_con_compra, ROUND(a.venta / GREATEST(p_meses, 1), 2) AS venta_mensual_promedio,
    (SELECT ROUND(AVG(g.gap), 1) FROM gaps g WHERE g.cliente_id = c.id AND g.gap IS NOT NULL) AS dias_entre_compras,
    a.ultima AS ultima_compra, public.hoy_ar() - a.ultima AS dias_sin_comprar
  FROM agg a
  JOIN clientes c ON c.id = a.cliente_id
  LEFT JOIN localidades l ON l.id = c.localidad_id
  LEFT JOIN zonas z ON z.id = l.zona_id
  LEFT JOIN vendedores v ON v.id = c.vendedor_id
  WHERE (p_zona_id IS NULL OR l.zona_id = p_zona_id)
    AND (p_vendedor_id IS NULL OR c.vendedor_id = p_vendedor_id)
  ORDER BY a.venta DESC
$$;

-- ─── Cobertura de stock (cuántos días alcanza al ritmo de venta) ───────
CREATE OR REPLACE FUNCTION public.jarvis_cobertura_stock(
  p_proveedor_id uuid DEFAULT NULL, p_categoria text DEFAULT NULL, p_dias_base integer DEFAULT 60,
  p_max_dias numeric DEFAULT NULL, p_limite integer DEFAULT 50)
RETURNS TABLE(articulo_id uuid, sku text, articulo text, proveedor text, categoria text,
              stock numeric, vendido numeric, venta_diaria numeric, dias_cobertura numeric, costo_unitario numeric)
-- Stock NEGATIVO = el stock de ese artículo no está bien cargado: dias_cobertura
-- sale NULL (sin dato) y queda al final. No se inventa cobertura.
LANGUAGE sql STABLE AS $$
  WITH vend AS (
    SELECT k.articulo_id,
      SUM(CASE WHEN k.tipo_movimiento = 'nota_credito_venta' THEN -1 ELSE 1 END * COALESCE(k.cantidad, 0)) AS u
    FROM kardex k
    WHERE k.tipo_movimiento IN ('venta', 'nota_credito_venta')
      AND COALESCE(k.pedido_eliminado, false) = false
      AND k.fecha >= ((public.hoy_ar() - p_dias_base)::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires')
    GROUP BY k.articulo_id
  )
  , calc AS (
    SELECT a.id AS articulo_id, a.sku::text AS sku, a.descripcion::text AS articulo, p.nombre::text AS proveedor,
      a.categoria::text AS categoria,
      COALESCE(a.stock_actual, 0) AS stock, v.u AS vendido,
      ROUND(v.u / GREATEST(p_dias_base, 1)::numeric, 2) AS venta_diaria,
      CASE WHEN COALESCE(a.stock_actual, 0) >= 0
        THEN ROUND(COALESCE(a.stock_actual, 0) / (v.u / GREATEST(p_dias_base, 1)::numeric), 1) END AS dias_cobertura,
      COALESCE(NULLIF(a.ultimo_costo, 0), a.precio_compra) AS costo_unitario
    FROM articulos a
    JOIN vend v ON v.articulo_id = a.id AND v.u > 0
    LEFT JOIN proveedores p ON p.id = a.proveedor_id
    WHERE a.activo IS NOT FALSE
      AND (p_proveedor_id IS NULL OR a.proveedor_id = p_proveedor_id)
      AND (p_categoria IS NULL OR a.categoria ILIKE p_categoria)
  )
  SELECT * FROM calc
  WHERE p_max_dias IS NULL OR dias_cobertura <= p_max_dias
  ORDER BY dias_cobertura ASC NULLS LAST, vendido DESC
  LIMIT p_limite
$$;

-- ─── Resumen por proveedor ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.jarvis_proveedores_resumen(p_proveedor_id uuid DEFAULT NULL)
RETURNS TABLE(proveedor_id uuid, proveedor text, articulos_activos bigint,
              venta_30d numeric, costo_30d numeric, ultimo_aumento date, dias_sin_aumento integer,
              articulos_aumentados_90d bigint, aumento_promedio_pct_90d numeric,
              deuda_pendiente numeric, deuda_vencida numeric, proximo_vencimiento date, oc_abiertas bigint)
LANGUAGE sql STABLE AS $$
  WITH v30 AS (
    SELECT k.articulo_proveedor_id AS pid,
      SUM(CASE WHEN k.tipo_movimiento = 'nota_credito_venta' THEN -1 ELSE 1 END * COALESCE(k.subtotal_neto, k.subtotal_total, 0)) AS neto,
      SUM(COALESCE(NULLIF(k.precio_costo, 0), a.ultimo_costo, a.precio_compra, 0) * ABS(COALESCE(k.cantidad, 0))) AS costo
    FROM kardex k LEFT JOIN articulos a ON a.id = k.articulo_id
    WHERE k.tipo_movimiento IN ('venta', 'nota_credito_venta')
      AND COALESCE(k.pedido_eliminado, false) = false
      AND k.fecha >= ((public.hoy_ar() - 30)::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires')
      AND (p_proveedor_id IS NULL OR k.articulo_proveedor_id = p_proveedor_id)
    GROUP BY 1
  ), versiones AS (
    -- Historial de precios de artículos (desde 18/09/2026; la versión del
    -- 01/01/2000 es la foto inicial, no un cambio). Aumento = cambió precio_compra.
    SELECT h.datos->>'proveedor_id' AS pid, h.vigente_desde,
      (h.datos->>'precio_compra')::numeric AS pc,
      LAG((h.datos->>'precio_compra')::numeric) OVER (PARTITION BY h.registro_id ORDER BY h.vigente_desde) AS pc_ant
    FROM precio_insumos_historial h
    WHERE h.tabla = 'articulos'
  ), aumentos AS (
    SELECT pid,
      MAX(vigente_desde) AS ultimo,
      COUNT(*) FILTER (WHERE vigente_desde >= (public.hoy_ar() - 90)) AS n90,
      AVG((pc / pc_ant - 1) * 100) FILTER (WHERE vigente_desde >= (public.hoy_ar() - 90)) AS pct90
    FROM versiones
    WHERE pc_ant > 0 AND pc IS DISTINCT FROM pc_ant
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
       AND o.estado NOT IN ('recibida_completa', 'cancelada', 'anulada')) AS oc_abiertas
  FROM proveedores p
  LEFT JOIN v30 v ON v.pid = p.id
  LEFT JOIN aumentos au ON au.pid = p.id::text
  LEFT JOIN LATERAL (
    SELECT SUM(vc.monto) AS pend,
      SUM(vc.monto) FILTER (WHERE vc.fecha_vencimiento < public.hoy_ar()) AS venc,
      MIN(vc.fecha_vencimiento) FILTER (WHERE vc.fecha_vencimiento >= public.hoy_ar()) AS prox
    FROM vencimientos vc WHERE vc.proveedor_id = p.id AND vc.estado = 'pendiente'
  ) ve ON true
  WHERE (p_proveedor_id IS NULL OR p.id = p_proveedor_id)
  ORDER BY v.neto DESC NULLS LAST
$$;

GRANT EXECUTE ON FUNCTION public.jarvis_ventas(date, date, text, uuid, uuid, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.jarvis_deuda_antiguedad(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.jarvis_clientes_habitos(integer, uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.jarvis_cobertura_stock(uuid, text, integer, numeric, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.jarvis_proveedores_resumen(uuid) TO service_role;
