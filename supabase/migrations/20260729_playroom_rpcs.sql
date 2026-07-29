-- ============================================================================
-- PLAYROOM: RPCs de agregación en Postgres
-- 2026-07-29 — Los reportes dejan de traer filas crudas a Node: la DB agrega
-- con SUM/GROUP BY y devuelve solo el resultado. Escala a millones de filas.
-- Todas las fechas se clasifican en zona horaria Argentina.
-- Idempotente: se puede correr más de una vez (CREATE OR REPLACE / IF NOT EXISTS).
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. ARTÍCULOS VENDIDOS — agregado por artículo, período actual + comparativo
--    Reemplaza el escaneo paginado del kardex en /api/playroom/articulos-vendidos
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.playroom_articulos_vendidos(
  p_from date,
  p_to date,
  p_prev_from date,
  p_prev_to date,
  p_vendedor_ids uuid[] DEFAULT NULL,
  p_provincias text[] DEFAULT NULL,
  p_cliente_ids uuid[] DEFAULT NULL,
  p_tipos_comprobante text[] DEFAULT NULL,
  p_solo_comprobante boolean DEFAULT false,
  p_descuento text DEFAULT NULL
)
RETURNS TABLE (
  articulo_id uuid,
  sku text,
  descripcion text,
  categoria text,
  marca_id uuid,
  proveedor_id uuid,
  unidades numeric,
  unidades_prev numeric,
  neto numeric,
  neto_prev numeric,
  iva numeric,
  total numeric,
  costo numeric
)
LANGUAGE sql STABLE AS $$
  WITH movs AS (
    SELECT
      k.articulo_id,
      k.articulo_sku,
      k.articulo_descripcion,
      k.articulo_categoria,
      k.articulo_marca_id,
      k.articulo_proveedor_id,
      (k.fecha AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS f,
      CASE WHEN k.tipo_movimiento = 'nota_credito_venta' THEN -1 ELSE 1 END AS signo,
      COALESCE(k.cantidad, 0) AS cantidad,
      COALESCE(k.subtotal_neto, k.subtotal_total, 0) AS m_neto,
      COALESCE(k.subtotal_iva, 0) AS m_iva,
      COALESCE(k.subtotal_total, 0) AS m_total,
      CASE
        WHEN COALESCE(k.precio_costo, 0) > 0 THEN k.precio_costo
        WHEN COALESCE(a.ultimo_costo, 0) > 0 THEN a.ultimo_costo
        ELSE COALESCE(a.precio_compra, 0)
      END AS costo_unit
    FROM kardex k
    LEFT JOIN articulos a ON a.id = k.articulo_id
    WHERE k.tipo_movimiento IN ('venta', 'nota_credito_venta')
      AND k.articulo_id IS NOT NULL
      AND k.pedido_eliminado = false
      AND k.fecha >= (LEAST(p_prev_from, p_from)::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires')
      AND k.fecha <  ((GREATEST(p_prev_to, p_to) + 1)::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires')
      AND (p_vendedor_ids IS NULL OR k.vendedor_id = ANY(p_vendedor_ids))
      AND (p_provincias IS NULL OR k.provincia_destino = ANY(p_provincias))
      AND (p_cliente_ids IS NULL OR k.cliente_id = ANY(p_cliente_ids))
      AND (p_tipos_comprobante IS NULL OR k.tipo_comprobante = ANY(p_tipos_comprobante))
      AND (NOT p_solo_comprobante OR k.comprobante_venta_id IS NOT NULL)
      AND (
        p_descuento IS NULL
        OR (p_descuento = 'sin_descuento' AND NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(k.descuentos_json) = 'array' THEN k.descuentos_json ELSE '[]'::jsonb END) d
              WHERE COALESCE((d->>'porcentaje')::numeric, 0) > 0))
        OR (p_descuento <> 'sin_descuento' AND EXISTS (
              SELECT 1 FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(k.descuentos_json) = 'array' THEN k.descuentos_json ELSE '[]'::jsonb END) d
              WHERE d->>'tipo' = p_descuento AND COALESCE((d->>'porcentaje')::numeric, 0) > 0))
      )
  )
  SELECT
    m.articulo_id,
    MAX(m.articulo_sku)::text,
    MAX(m.articulo_descripcion)::text,
    MAX(m.articulo_categoria)::text,
    (ARRAY_AGG(m.articulo_marca_id) FILTER (WHERE m.articulo_marca_id IS NOT NULL))[1],
    (ARRAY_AGG(m.articulo_proveedor_id) FILTER (WHERE m.articulo_proveedor_id IS NOT NULL))[1],
    COALESCE(SUM(m.signo * m.cantidad) FILTER (WHERE m.f BETWEEN p_from AND p_to), 0),
    COALESCE(SUM(m.signo * m.cantidad) FILTER (WHERE m.f BETWEEN p_prev_from AND p_prev_to), 0),
    COALESCE(SUM(m.signo * m.m_neto)   FILTER (WHERE m.f BETWEEN p_from AND p_to), 0),
    COALESCE(SUM(m.signo * m.m_neto)   FILTER (WHERE m.f BETWEEN p_prev_from AND p_prev_to), 0),
    COALESCE(SUM(m.signo * m.m_iva)    FILTER (WHERE m.f BETWEEN p_from AND p_to), 0),
    COALESCE(SUM(m.signo * m.m_total)  FILTER (WHERE m.f BETWEEN p_from AND p_to), 0),
    COALESCE(SUM(m.costo_unit * ABS(m.cantidad)) FILTER (WHERE m.f BETWEEN p_from AND p_to), 0)
  FROM movs m
  GROUP BY m.articulo_id
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. CLIENTES QUE COMPRARON UN ARTÍCULO — drawer, mismos filtros que el reporte
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.playroom_articulo_clientes(
  p_articulo_id uuid,
  p_from date,
  p_to date,
  p_vendedor_ids uuid[] DEFAULT NULL,
  p_provincias text[] DEFAULT NULL,
  p_cliente_ids uuid[] DEFAULT NULL,
  p_tipos_comprobante text[] DEFAULT NULL,
  p_solo_comprobante boolean DEFAULT false,
  p_descuento text DEFAULT NULL
)
RETURNS TABLE (
  cliente_id uuid,
  nombre text,
  localidad text,
  unidades numeric,
  neto numeric,
  total numeric
)
LANGUAGE sql STABLE AS $$
  SELECT
    k.cliente_id,
    COALESCE(cl.nombre_razon_social, cl.nombre, k.cliente_id::text)::text,
    COALESCE(cl.localidad, '—')::text,
    COALESCE(SUM(CASE WHEN k.tipo_movimiento = 'nota_credito_venta' THEN -1 ELSE 1 END * COALESCE(k.cantidad, 0)), 0),
    COALESCE(SUM(CASE WHEN k.tipo_movimiento = 'nota_credito_venta' THEN -1 ELSE 1 END * COALESCE(k.subtotal_neto, k.subtotal_total, 0)), 0),
    COALESCE(SUM(CASE WHEN k.tipo_movimiento = 'nota_credito_venta' THEN -1 ELSE 1 END * COALESCE(k.subtotal_total, 0)), 0)
  FROM kardex k
  LEFT JOIN clientes cl ON cl.id = k.cliente_id
  WHERE k.articulo_id = p_articulo_id
    AND k.tipo_movimiento IN ('venta', 'nota_credito_venta')
    AND k.cliente_id IS NOT NULL
    AND k.pedido_eliminado = false
    AND k.fecha >= (p_from::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires')
    AND k.fecha <  ((p_to + 1)::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires')
    AND (p_vendedor_ids IS NULL OR k.vendedor_id = ANY(p_vendedor_ids))
    AND (p_provincias IS NULL OR k.provincia_destino = ANY(p_provincias))
    AND (p_cliente_ids IS NULL OR k.cliente_id = ANY(p_cliente_ids))
    AND (p_tipos_comprobante IS NULL OR k.tipo_comprobante = ANY(p_tipos_comprobante))
    AND (NOT p_solo_comprobante OR k.comprobante_venta_id IS NOT NULL)
    AND (
      p_descuento IS NULL
      OR (p_descuento = 'sin_descuento' AND NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(k.descuentos_json) = 'array' THEN k.descuentos_json ELSE '[]'::jsonb END) d
            WHERE COALESCE((d->>'porcentaje')::numeric, 0) > 0))
      OR (p_descuento <> 'sin_descuento' AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(k.descuentos_json) = 'array' THEN k.descuentos_json ELSE '[]'::jsonb END) d
            WHERE d->>'tipo' = p_descuento AND COALESCE((d->>'porcentaje')::numeric, 0) > 0))
    )
  GROUP BY k.cliente_id, cl.nombre_razon_social, cl.nombre, cl.localidad
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. ROTACIÓN — última venta, velocidad 90d y último costo por artículo
--    Reemplaza el escaneo del kardex completo en /api/playroom/rotacion
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.playroom_rotacion_kardex()
RETURNS TABLE (
  articulo_id uuid,
  ultima_venta timestamptz,
  unidades_90d numeric,
  costo_ultima_venta numeric
)
LANGUAGE sql STABLE AS $$
  SELECT
    k.articulo_id,
    MAX(k.fecha),
    COALESCE(SUM(k.cantidad) FILTER (WHERE k.fecha >= now() - interval '90 days'), 0),
    (ARRAY_AGG(k.precio_costo ORDER BY k.fecha DESC) FILTER (WHERE COALESCE(k.precio_costo, 0) > 0))[1]
  FROM kardex k
  WHERE k.tipo_movimiento = 'venta'
    AND k.articulo_id IS NOT NULL
    AND k.pedido_eliminado = false
  GROUP BY k.articulo_id
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. COMISIONES POR VIAJANTE — agregado con flag pagado y desglose por segmento
--    Reemplaza el escaneo paginado en /api/playroom/comisiones
--    p_tipo: 'vendida' (por fecha de venta) | 'cobrada' (por fecha de cobro)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.playroom_comisiones_viajantes(
  p_from date,
  p_to date,
  p_prev_from date,
  p_prev_to date,
  p_tipo text DEFAULT 'vendida',
  p_viajante_id uuid DEFAULT NULL
)
RETURNS TABLE (
  vendedor_id uuid,
  devengado numeric,
  devengado_prev numeric,
  cobrable numeric,
  pagado numeric,
  pendiente numeric,
  cantidad_pedidos bigint,
  cantidad_clientes bigint,
  por_segmento jsonb
)
LANGUAGE sql STABLE AS $$
  WITH base AS (
    SELECT
      k.vendedor_id,
      k.pedido_id,
      k.cliente_id,
      COALESCE(k.articulo_categoria, 'sin_segmento') AS segmento,
      COALESCE(k.comision_viajante_monto, 0) AS monto,
      k.comprobante_cobrado,
      COALESCE(co.pagado, false) AS esta_pagado,
      ((CASE WHEN p_tipo = 'cobrada' THEN k.fecha_comprobante_cobrado ELSE k.fecha END)
        AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS f
    FROM kardex k
    LEFT JOIN comisiones co ON co.kardex_id = k.id
    WHERE k.tipo_movimiento = 'venta'
      AND k.comision_viajante_monto IS NOT NULL
      AND k.comision_viajante_monto <> 0
      AND k.pedido_eliminado = false
      AND (p_tipo <> 'cobrada' OR k.comprobante_cobrado = true)
      AND (p_viajante_id IS NULL OR k.vendedor_id = p_viajante_id)
      AND (CASE WHEN p_tipo = 'cobrada' THEN k.fecha_comprobante_cobrado ELSE k.fecha END)
            >= (LEAST(p_prev_from, p_from)::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires')
      AND (CASE WHEN p_tipo = 'cobrada' THEN k.fecha_comprobante_cobrado ELSE k.fecha END)
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
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. CHAT: VENTAS AGRUPADAS — comprobantes_venta agregado en SQL
--    p_agrupar: 'cliente' | 'tipo_comprobante' | 'dia'
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.playroom_chat_ventas(
  p_from date,
  p_to date,
  p_solo_arca boolean DEFAULT true,
  p_agrupar text DEFAULT 'cliente'
)
RETURNS TABLE (
  clave text,
  total numeric,
  neto numeric,
  comprobantes bigint
)
LANGUAGE sql STABLE AS $$
  SELECT
    CASE p_agrupar
      WHEN 'cliente' THEN COALESCE(cl.nombre_razon_social, cl.nombre, 'sin cliente')
      WHEN 'tipo_comprobante' THEN cv.tipo_comprobante
      ELSE to_char(cv.fecha, 'YYYY-MM-DD')
    END::text AS clave,
    SUM((CASE WHEN cv.tipo_comprobante LIKE 'NC%' THEN -1 ELSE 1 END) * COALESCE(cv.total_factura, 0)),
    SUM((CASE WHEN cv.tipo_comprobante LIKE 'NC%' THEN -1 ELSE 1 END) * COALESCE(cv.total_neto, 0)),
    COUNT(*)
  FROM comprobantes_venta cv
  LEFT JOIN clientes cl ON cl.id = cv.cliente_id
  WHERE cv.fecha BETWEEN p_from AND p_to
    AND cv.tipo_comprobante = ANY(
      CASE WHEN p_solo_arca
        THEN ARRAY['FA','FB','FC','NCA','NCB','NCC']
        ELSE ARRAY['FA','FB','FC','NCA','NCB','NCC','PRES','REV']
      END)
  GROUP BY 1
  ORDER BY 2 DESC
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. CHAT: STOCK — artículos con última venta calculada en SQL
--    (la columna articulos.ultima_venta no existe; se calcula desde kardex)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.playroom_chat_stock(
  p_stock_min numeric DEFAULT 1,
  p_rubro text DEFAULT NULL,
  p_sin_movimiento_dias int DEFAULT NULL
)
RETURNS TABLE (
  sku text,
  descripcion text,
  rubro text,
  stock numeric,
  costo_unitario numeric,
  capital numeric,
  ultima_venta date
)
LANGUAGE sql STABLE AS $$
  WITH uv AS (
    SELECT k.articulo_id, MAX(k.fecha) AS ultima
    FROM kardex k
    WHERE k.tipo_movimiento = 'venta' AND k.pedido_eliminado = false
    GROUP BY k.articulo_id
  )
  SELECT
    a.sku::text,
    a.descripcion::text,
    a.rubro::text,
    COALESCE(a.stock_actual, 0),
    COALESCE(a.ultimo_costo, 0),
    COALESCE(a.stock_actual, 0) * COALESCE(a.ultimo_costo, 0),
    (uv.ultima AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
  FROM articulos a
  LEFT JOIN uv ON uv.articulo_id = a.id
  WHERE COALESCE(a.stock_actual, 0) >= p_stock_min
    AND (p_rubro IS NULL OR a.rubro ILIKE '%' || p_rubro || '%')
    AND (p_sin_movimiento_dias IS NULL
         OR uv.ultima IS NULL
         OR uv.ultima < now() - make_interval(days => p_sin_movimiento_dias))
  ORDER BY COALESCE(a.stock_actual, 0) * COALESCE(a.ultimo_costo, 0) DESC
$$;

-- NOTA: no hay RPC de comisiones para el chat basada en la tabla `comisiones`
-- porque esa tabla está congelada desde 2026-05-18 (kardex_id siempre NULL).
-- El chat usa playroom_comisiones_viajantes (kardex), la fuente viva.

-- ────────────────────────────────────────────────────────────────────────────
-- Permisos (el backend usa service_role; authenticated por si se llama directo)
-- ────────────────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION
  public.playroom_articulos_vendidos, public.playroom_articulo_clientes,
  public.playroom_rotacion_kardex, public.playroom_comisiones_viajantes,
  public.playroom_chat_ventas, public.playroom_chat_stock
TO service_role, authenticated;
