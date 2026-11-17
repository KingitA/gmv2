-- ─────────────────────────────────────────────────────────────────────────────
-- Resolver una diferencia de la recepción (precio o cantidad) en UNA transacción,
-- una sola vez. Prueba en pantalla del 17/11/2026: E-90 y E-91 (más E-33, E-34).
--
-- Qué pasaba (app/api/recepciones/[id]/cerrar/route.ts, escrituras sueltas):
--   · E-90: resolver un FALTANTE contra el proveedor restaba stock. La recepción ya había
--     sumado solo lo que llegó: recibidos 150, facturados 200 → al resolver, el stock
--     bajó de 228 a 178 (se descontó mercadería que nunca entró).
--   · E-91: la nota de crédito esperada salía con el precio de LISTA, sin el descuento
--     y sin IVA: $2.097,12 en vez de $1.677,60 neto; $34.802,00 en vez de $27.841,50.
--   · Resolver dos veces la misma línea creaba dos notas de crédito esperadas.
--
-- Qué agrega:
--   1. Tabla recepciones_diferencias: una fila por línea y tipo (precio / cantidad) con
--      a quién se imputó, cuánto, quién y cuándo. UNIQUE (línea, tipo) ⇒ no hay dos
--      resoluciones de lo mismo.
--   2. Función recepcion_resolver_diferencia: bloquea la línea, y en la misma transacción
--      deja la resolución, la NC esperada (con neto, IVA y total), el cargo al transporte,
--      el costo del artículo (lista y descuentos, no el neto pisando la lista) y, SOLO si
--      se pide expresamente devolver mercadería que entró, la baja de stock.
--
-- Los importes los calcula el servidor (lib/compras/diferencias.ts, la misma cuenta que
-- muestra la pantalla) y vienen en p_datos; la función no confía en el navegador porque
-- solo la ejecuta el cliente de servicio.
--
-- No toca datos existentes (no corrige el stock ni las NC esperadas de la prueba del
-- 17/11). Se puede correr más de una vez. Sin esta migración el servidor aplica las
-- mismas reglas paso a paso (sin "todo o nada" y sin el registro de quién resolvió).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.recepciones_diferencias (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recepcion_item_id   uuid NOT NULL REFERENCES public.recepciones_items(id) ON DELETE CASCADE,
  recepcion_id        uuid NOT NULL REFERENCES public.recepciones(id) ON DELETE CASCADE,
  articulo_id         uuid NOT NULL,
  tipo                text NOT NULL CHECK (tipo IN ('precio', 'cantidad')),
  -- empresa = se asume · proveedor = NC esperada · transporte = cargo al transporte ·
  -- descuento_fuera_factura = NC esperada por descuento que llega aparte
  destino             text NOT NULL CHECK (destino IN ('empresa', 'proveedor', 'transporte', 'descuento_fuera_factura')),
  unidades            numeric(18,4) NOT NULL DEFAULT 0,   -- unidades base de la diferencia
  importe_neto        numeric(14,2) NOT NULL DEFAULT 0,
  importe_iva         numeric(14,2) NOT NULL DEFAULT 0,
  importe_total       numeric(14,2) NOT NULL DEFAULT 0,
  nc_esperada_id      uuid REFERENCES public.comprobantes_compra(id) ON DELETE SET NULL,
  movimiento_transporte_id uuid,
  unidades_devueltas  numeric(18,4) NOT NULL DEFAULT 0,   -- > 0 solo si se devolvió mercadería que había entrado
  stock_antes         numeric(18,4),
  descripcion         text,
  detalle             jsonb,                               -- la cuenta completa, tal como la vio quien resolvió
  usuario_id          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recepciones_diferencias_unica UNIQUE (recepcion_item_id, tipo)
);

CREATE INDEX IF NOT EXISTS idx_recepciones_diferencias_recepcion ON public.recepciones_diferencias (recepcion_id);

COMMENT ON TABLE public.recepciones_diferencias IS
  'Cómo se resolvió cada diferencia de una recepción (precio o cantidad): destino, importe con IVA discriminado, NC esperada o cargo al transporte que generó, quién y cuándo. Una sola por línea y tipo.';

-- Se lee desde la oficina; solo escribe la función (cliente de servicio).
ALTER TABLE public.recepciones_diferencias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recepciones_diferencias_lectura ON public.recepciones_diferencias;
CREATE POLICY recepciones_diferencias_lectura ON public.recepciones_diferencias
  FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.recepciones_diferencias FROM anon;
GRANT SELECT ON public.recepciones_diferencias TO authenticated;
GRANT ALL ON public.recepciones_diferencias TO service_role;

-- p_datos (todo lo calcula el servidor):
--   { unidades, neto, iva, total,                      ← la diferencia, en unidades base y pesos
--     origen_nc: 'faltante' | 'diferencia_precio' | 'descuento_fuera_factura' | 'devolucion',
--     transporte_id, descripcion,
--     costo: { precio_compra, descuento1..descuento4 }, ← solo "la empresa asume" un precio
--     devolver_unidades,                                ← SOLO si se devuelve mercadería que entró
--     detalle: { … } }
CREATE OR REPLACE FUNCTION public.recepcion_resolver_diferencia(
  p_item_id    uuid,
  p_tipo       text,
  p_destino    text,
  p_usuario_id uuid,
  p_datos      jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_it        record;
  v_rec       record;
  v_prov      uuid;
  v_oc        uuid;
  v_prev      record;
  v_unidades  numeric := coalesce(nullif(p_datos ->> 'unidades', '')::numeric, 0);
  v_neto      numeric := round(coalesce(nullif(p_datos ->> 'neto', '')::numeric, 0), 2);
  v_iva       numeric := round(coalesce(nullif(p_datos ->> 'iva', '')::numeric, 0), 2);
  v_total     numeric := round(coalesce(nullif(p_datos ->> 'total', '')::numeric, 0), 2);
  v_devolver  numeric := coalesce(nullif(p_datos ->> 'devolver_unidades', '')::numeric, 0);
  v_transp    uuid := nullif(p_datos ->> 'transporte_id', '')::uuid;
  v_desc      text := nullif(btrim(coalesce(p_datos ->> 'descripcion', '')), '');
  v_costo     jsonb := p_datos -> 'costo';
  v_asociado  uuid;
  v_nc        uuid;
  v_mov       uuid;
  v_stock     numeric;
  v_id        uuid;
BEGIN
  IF p_tipo NOT IN ('precio', 'cantidad') THEN
    RAISE EXCEPTION 'Tipo de diferencia inválido: %', p_tipo USING ERRCODE = 'P0001', DETAIL = 'tipo_invalido';
  END IF;
  IF p_destino NOT IN ('empresa', 'proveedor', 'transporte', 'descuento_fuera_factura') THEN
    RAISE EXCEPTION 'Destino inválido: %', p_destino USING ERRCODE = 'P0001', DETAIL = 'destino_invalido';
  END IF;

  -- La línea queda bloqueada: dos personas resolviendo lo mismo, de a una
  SELECT * INTO v_it FROM recepciones_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La línea de la recepción ya no existe.' USING ERRCODE = 'P0002', DETAIL = 'no_encontrado';
  END IF;

  -- ── Ya resuelta: no se repite nada (ni otra NC, ni otro cargo) ──
  SELECT * INTO v_prev FROM recepciones_diferencias WHERE recepcion_item_id = p_item_id AND tipo = p_tipo;
  IF FOUND THEN
    RETURN jsonb_build_object('success', true, 'ya_resuelta', true, 'id', v_prev.id, 'destino', v_prev.destino,
                              'neto', v_prev.importe_neto, 'iva', v_prev.importe_iva, 'total', v_prev.importe_total,
                              'nc_esperada_id', v_prev.nc_esperada_id, 'unidades_devueltas', v_prev.unidades_devueltas);
  END IF;
  -- Resuelta antes de esta migración (solo quedó la marca en la línea)
  IF (p_tipo = 'precio' AND coalesce(v_it.precio_verificado, false))
     OR (p_tipo = 'cantidad' AND v_it.cantidad_diferencia_destino IS NOT NULL) THEN
    RETURN jsonb_build_object('success', true, 'ya_resuelta', true, 'id', NULL,
                              'destino', CASE WHEN p_tipo = 'cantidad' THEN v_it.cantidad_diferencia_destino ELSE NULL END);
  END IF;

  SELECT r.id, r.proveedor_id, r.orden_compra_id, r.transporte_id INTO v_rec FROM recepciones r WHERE r.id = v_it.recepcion_id;
  v_oc := v_rec.orden_compra_id;
  v_prov := v_rec.proveedor_id;
  IF v_prov IS NULL AND v_oc IS NOT NULL THEN
    SELECT proveedor_id INTO v_prov FROM ordenes_compra WHERE id = v_oc;
  END IF;

  -- ── Proveedor: nota de crédito ESPERADA (la cuenta corriente se acredita cuando llega el documento) ──
  IF p_destino IN ('proveedor', 'descuento_fuera_factura') THEN
    IF v_prov IS NULL THEN
      RAISE EXCEPTION 'La recepción no tiene proveedor: no se puede dejar la nota de crédito esperada.' USING ERRCODE = 'P0001', DETAIL = 'sin_proveedor';
    END IF;
    IF v_total <= 0 THEN
      RAISE EXCEPTION 'La diferencia no tiene importe: no hay nada para reclamarle al proveedor.' USING ERRCODE = 'P0001', DETAIL = 'sin_importe';
    END IF;
    -- Factura contra la que se va a imputar: el último comprobante de deuda de la orden
    IF v_oc IS NOT NULL THEN
      SELECT id INTO v_asociado FROM comprobantes_compra
       WHERE orden_compra_id = v_oc
         AND tipo_comprobante NOT IN ('NC', 'NCA', 'NCB', 'NCC', 'Reversa', 'Remito')
         AND estado <> 'esperada'
       ORDER BY fecha_comprobante DESC, created_at DESC
       LIMIT 1;
    END IF;
    INSERT INTO comprobantes_compra (
      orden_compra_id, proveedor_id, tipo_comprobante, numero_comprobante, fecha_comprobante,
      total_factura_declarado, total_neto, total_iva, estado, origen_nc, comprobante_asociado_id, ajusta_stock
    ) VALUES (
      v_oc, v_prov, 'NC',
      'ESPERADA-' || to_char(clock_timestamp() AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYMMDDHH24MISSMS'),
      public.hoy_ar(), v_total, v_neto, v_iva, 'esperada',
      coalesce(nullif(p_datos ->> 'origen_nc', ''), CASE WHEN p_tipo = 'precio' THEN 'diferencia_precio' ELSE 'faltante' END),
      v_asociado, false
    ) RETURNING id INTO v_nc;
  END IF;

  -- ── Transporte: cargo en su cuenta corriente ──
  IF p_destino = 'transporte' THEN
    v_transp := coalesce(v_transp, v_rec.transporte_id);
    IF v_transp IS NULL THEN
      RAISE EXCEPTION 'Elegí el transporte al que se le carga la diferencia.' USING ERRCODE = 'P0001', DETAIL = 'sin_transporte';
    END IF;
    IF v_total <= 0 THEN
      RAISE EXCEPTION 'La diferencia no tiene importe: no hay nada para cargarle al transporte.' USING ERRCODE = 'P0001', DETAIL = 'sin_importe';
    END IF;
    INSERT INTO cuenta_corriente_transportes (transporte_id, tipo_movimiento, monto, descripcion, referencia_id, referencia_tipo, creado_por)
    VALUES (v_transp, 'faltante_mercaderia', v_total, coalesce(v_desc, 'Faltante de mercadería'), v_it.recepcion_id, 'recepcion', p_usuario_id)
    RETURNING id INTO v_mov;
  END IF;

  -- ── La empresa asume un precio: el costo del artículo pasa a ser el facturado ──
  -- (lista y descuentos del renglón de la factura; nunca el neto pisando la lista: E-34)
  IF p_destino = 'empresa' AND p_tipo = 'precio' AND v_costo IS NOT NULL AND coalesce(nullif(v_costo ->> 'precio_compra', '')::numeric, 0) > 0 THEN
    UPDATE articulos
       SET precio_compra = (v_costo ->> 'precio_compra')::numeric,
           descuento1 = coalesce(nullif(v_costo ->> 'descuento1', '')::numeric, 0),
           descuento2 = coalesce(nullif(v_costo ->> 'descuento2', '')::numeric, 0),
           descuento3 = coalesce(nullif(v_costo ->> 'descuento3', '')::numeric, 0),
           descuento4 = coalesce(nullif(v_costo ->> 'descuento4', '')::numeric, 0),
           actualizado_por = p_usuario_id
     WHERE id = v_it.articulo_id;
  END IF;

  -- ── Stock: SOLO si se devuelve mercadería que había entrado (opción explícita). ──
  -- Un faltante NO baja stock: la recepción sumó únicamente lo que llegó (E-90).
  IF v_devolver > 0 THEN
    UPDATE articulos
       SET stock_actual = coalesce(stock_actual, 0) - v_devolver
     WHERE id = v_it.articulo_id
     RETURNING stock_actual + v_devolver INTO v_stock;
  END IF;

  INSERT INTO recepciones_diferencias (
    recepcion_item_id, recepcion_id, articulo_id, tipo, destino, unidades,
    importe_neto, importe_iva, importe_total, nc_esperada_id, movimiento_transporte_id,
    unidades_devueltas, stock_antes, descripcion, detalle, usuario_id
  ) VALUES (
    p_item_id, v_it.recepcion_id, v_it.articulo_id, p_tipo, p_destino, v_unidades,
    v_neto, v_iva, v_total, v_nc, v_mov,
    greatest(v_devolver, 0), v_stock, v_desc, p_datos -> 'detalle', p_usuario_id
  ) RETURNING id INTO v_id;

  -- Marcas de siempre en la línea (las lee la verificación)
  IF p_tipo = 'precio' THEN
    UPDATE recepciones_items SET precio_verificado = true WHERE id = p_item_id;
  ELSE
    UPDATE recepciones_items SET cantidad_diferencia_destino = CASE WHEN p_destino = 'descuento_fuera_factura' THEN 'proveedor' ELSE p_destino END WHERE id = p_item_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'ya_resuelta', false, 'id', v_id, 'destino', p_destino,
                            'neto', v_neto, 'iva', v_iva, 'total', v_total,
                            'nc_esperada_id', v_nc, 'movimiento_transporte_id', v_mov,
                            'unidades_devueltas', greatest(v_devolver, 0), 'stock_antes', v_stock);
END;
$$;

COMMENT ON FUNCTION public.recepcion_resolver_diferencia(uuid, text, text, uuid, jsonb) IS
  'Resuelve una diferencia de precio o de cantidad de una línea de recepción, todo o nada y una sola vez (E-90/E-91). No toca stock salvo devolución explícita.';

-- Solo la llama el servidor (cliente de servicio).
REVOKE ALL ON FUNCTION public.recepcion_resolver_diferencia(uuid, text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recepcion_resolver_diferencia(uuid, text, text, uuid, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
