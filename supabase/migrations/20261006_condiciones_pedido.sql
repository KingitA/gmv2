-- ─────────────────────────────────────────────────────────────────────────────
-- Condiciones comerciales de pedidos (06/10/2026) — ADITIVA e IDEMPOTENTE.
--
-- 1. Contado como condición: el cliente puede tener 10% por pago contado en la
--    ficha (por segmento), por proveedor/marca, o solo para un pedido. Al
--    facturar un pedido de contado sale la NC/REV del 10% aparte.
-- 2. Condiciones CONGELADAS: el pedido guarda la ficha comercial con la que se
--    tomó (listas, métodos, bonificaciones) y sus condiciones por proveedor/marca.
--    Cambiar la ficha ya no toca pedidos tomados; "Repreciar" los lleva a
--    precios de hoy.
-- 3. Mercadería bonificada por CUPO: cada renglón guarda a qué cupo aporta
--    (todo / segmento / proveedor / marca) y con qué %; los artículos regalados,
--    a qué cupo pertenecen.
-- Las apps instaladas no leen estas columnas: no las afecta.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Contado ─────────────────────────────────────────────────────────────────
ALTER TABLE public.bonificaciones DROP CONSTRAINT IF EXISTS chk_tipo;
ALTER TABLE public.bonificaciones
  ADD CONSTRAINT chk_tipo CHECK (tipo IN ('mercaderia', 'general', 'viajante', 'contado'));

ALTER TABLE public.cliente_proveedor_condicion ADD COLUMN IF NOT EXISTS contado boolean;
ALTER TABLE public.cliente_marca_condicion     ADD COLUMN IF NOT EXISTS contado boolean;
ALTER TABLE public.pedido_proveedor_condicion  ADD COLUMN IF NOT EXISTS contado boolean;
ALTER TABLE public.pedido_marca_condicion      ADD COLUMN IF NOT EXISTS contado boolean;

-- 2. Pedido con condiciones congeladas ──────────────────────────────────────
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS condiciones_cliente jsonb;
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS precios_al timestamptz;

-- 3. Renglón: contado y cupo de mercadería ──────────────────────────────────
ALTER TABLE public.pedidos_detalle ADD COLUMN IF NOT EXISTS contado boolean NOT NULL DEFAULT false;
ALTER TABLE public.pedidos_detalle ADD COLUMN IF NOT EXISTS bonif_merc_origen text;
ALTER TABLE public.pedidos_detalle ADD COLUMN IF NOT EXISTS bonif_merc_pct numeric;

-- 4. Congelar los pedidos abiertos que ya existen ───────────────────────────
-- Pedidos todavía no facturados: se les congela la ficha ACTUAL (la misma con la
-- que hoy se calcularían) y se copian a pedido_*_condicion las condiciones por
-- proveedor/marca de la ficha que el pedido no tenga. Sus precios no cambian.
-- precios_al = cuando se tomó (created_at se guarda en UTC).
INSERT INTO public.pedido_proveedor_condicion
  (pedido_id, proveedor_id, lista_precio_id, metodo_facturacion, dto_general_pct, dto_viajante_pct, dto_mercaderia_pct, contado)
SELECT p.id, c.proveedor_id, c.lista_precio_id, c.metodo_facturacion, c.dto_general_pct, c.dto_viajante_pct, c.dto_mercaderia_pct, c.contado
  FROM public.pedidos p
  JOIN public.cliente_proveedor_condicion c ON c.cliente_id = p.cliente_id
 WHERE p.condiciones_cliente IS NULL
   AND p.eliminado_at IS NULL
   AND p.estado IN ('en_venta', 'pendiente', 'impreso', 'en_preparacion', 'pendiente_facturacion')
ON CONFLICT (pedido_id, proveedor_id) DO NOTHING;

INSERT INTO public.pedido_marca_condicion
  (pedido_id, marca_id, lista_precio_id, metodo_facturacion, dto_general_pct, dto_viajante_pct, dto_mercaderia_pct, contado)
SELECT p.id, c.marca_id, c.lista_precio_id, c.metodo_facturacion, c.dto_general_pct, c.dto_viajante_pct, c.dto_mercaderia_pct, c.contado
  FROM public.pedidos p
  JOIN public.cliente_marca_condicion c ON c.cliente_id = p.cliente_id
 WHERE p.condiciones_cliente IS NULL
   AND p.eliminado_at IS NULL
   AND p.estado IN ('en_venta', 'pendiente', 'impreso', 'en_preparacion', 'pendiente_facturacion')
ON CONFLICT (pedido_id, marca_id) DO NOTHING;

UPDATE public.pedidos p
   SET condiciones_cliente = jsonb_build_object(
         'cliente', jsonb_build_object(
           'metodo_facturacion', c.metodo_facturacion,
           'lista_precio_id',    c.lista_precio_id,
           'lista_limpieza_id',  c.lista_limpieza_id,
           'metodo_limpieza',    c.metodo_limpieza,
           'lista_perf0_id',     c.lista_perf0_id,
           'metodo_perf0',       c.metodo_perf0,
           'lista_perf_plus_id', c.lista_perf_plus_id,
           'metodo_perf_plus',   c.metodo_perf_plus
         ),
         'bonificaciones', COALESCE((
           SELECT jsonb_agg(jsonb_build_object('tipo', b.tipo, 'segmento', b.segmento, 'porcentaje', b.porcentaje))
             FROM public.bonificaciones b
            WHERE b.cliente_id = c.id AND b.activo AND b.proveedor_id IS NULL
         ), '[]'::jsonb),
         'tomado_at', to_jsonb(now()),
         'migracion', true
       ),
       precios_al = COALESCE(p.precios_al, p.created_at AT TIME ZONE 'UTC')
  FROM public.clientes c
 WHERE c.id = p.cliente_id
   AND p.condiciones_cliente IS NULL
   AND p.eliminado_at IS NULL
   AND p.estado IN ('en_venta', 'pendiente', 'impreso', 'en_preparacion', 'pendiente_facturacion');

-- Control
SELECT
  (SELECT count(*) FROM public.pedidos WHERE condiciones_cliente IS NOT NULL) AS pedidos_congelados,
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'pedidos_detalle' AND column_name IN ('contado', 'bonif_merc_origen', 'bonif_merc_pct')) AS columnas_renglon_ok,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'chk_tipo' AND conrelid = 'public.bonificaciones'::regclass) AS chk_tipo;
