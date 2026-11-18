-- ─────────────────────────────────────────────────────────────────────────────
-- Dos documentos de la misma orden leídos a la vez no se pisan (18/11/2026).
-- Prueba en producción: subiendo una factura y una adquisición juntas, una se pisaba con la
-- otra. La pantalla de la oficina ya sube de a un archivo, pero la app Depósito, dos pestañas
-- o el mail seguían expuestos. Esto lo resuelve en la base, para todos:
--
--   1. recepcion_item_sumar_documentado(línea, unidades, datos)
--      Suma (o resta) lo documentado de una línea de recepción en UN solo UPDATE
--      (cantidad_documentada = cantidad_documentada + n): dos lecturas simultáneas suman las dos.
--      Antes era leer, sumar en el servidor y escribir: la segunda pisaba a la primera.
--
--   2. comprobante_provisorio_obtener(orden, proveedor, tipo, datos)
--      Un documento sin número legible se suma al comprobante provisorio ("PENDIENTE-…") de la
--      orden, o crea uno. Ahora lo decide la base con la orden bloqueada: dos hojas leídas a la
--      vez ya no crean dos provisorios.
--
-- El código funciona con o sin esta migración (sin ella sigue el camino anterior).
-- No toca datos. Se puede correr más de una vez. No depende de ninguna otra de la tanda.
-- ─────────────────────────────────────────────────────────────────────────────

-- p_datos (todo opcional): { precio_documentado, precio_real, cantidad_base, factor_conversion,
--                            conversion_source, requires_review }
CREATE OR REPLACE FUNCTION public.recepcion_item_sumar_documentado(
  p_item_id uuid,
  p_delta   numeric,
  p_datos   jsonb DEFAULT '{}'::jsonb
) RETURNS numeric
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_nueva numeric;
  d       jsonb := coalesce(p_datos, '{}'::jsonb);
BEGIN
  UPDATE recepciones_items ri
     SET cantidad_documentada = greatest(0, round(coalesce(ri.cantidad_documentada, 0) + coalesce(p_delta, 0), 4)),
         precio_documentado = CASE
           WHEN greatest(0, round(coalesce(ri.cantidad_documentada, 0) + coalesce(p_delta, 0), 4)) = 0 THEN 0
           WHEN d ? 'precio_documentado' THEN (d ->> 'precio_documentado')::numeric
           ELSE ri.precio_documentado END,
         precio_real       = CASE WHEN d ? 'precio_real'       THEN (d ->> 'precio_real')::numeric       ELSE ri.precio_real END,
         cantidad_base     = CASE WHEN d ? 'cantidad_base'     THEN (d ->> 'cantidad_base')::numeric     ELSE ri.cantidad_base END,
         factor_conversion = CASE WHEN d ? 'factor_conversion' THEN (d ->> 'factor_conversion')::numeric ELSE ri.factor_conversion END,
         conversion_source = CASE WHEN d ? 'conversion_source' THEN d ->> 'conversion_source'            ELSE ri.conversion_source END,
         requires_review   = CASE WHEN d ? 'requires_review'   THEN (d ->> 'requires_review')::boolean   ELSE ri.requires_review END
   WHERE ri.id = p_item_id
  RETURNING ri.cantidad_documentada INTO v_nueva;
  RETURN v_nueva;   -- NULL = la línea ya no existe
END;
$$;

COMMENT ON FUNCTION public.recepcion_item_sumar_documentado(uuid, numeric, jsonb) IS
  'Suma (o resta) unidades a lo documentado de una línea de recepción en un solo UPDATE: dos documentos leídos a la vez no se pisan.';

-- p_datos: { numero_provisorio, fecha_comprobante, fecha_leida, total_factura_declarado, total_neto,
--            total_iva, percepcion_iva_monto, percepcion_iibb_monto, retencion_ganancias_monto,
--            impuestos_internos, otros_impuestos, total_calculado, foto_url, descuento_fuera_factura }
-- Devuelve { id, sumado, otro_provisorio }.
CREATE OR REPLACE FUNCTION public.comprobante_provisorio_obtener(
  p_orden_id     uuid,
  p_proveedor_id uuid,
  p_tipo         text,
  p_datos        jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  d        jsonb := coalesce(p_datos, '{}'::jsonb);
  v_total  numeric := coalesce(nullif(d ->> 'total_factura_declarado', '')::numeric, 0);
  v_fecha  date := nullif(d ->> 'fecha_leida', '')::date;
  v_prov   record;
  v_otro   boolean := false;
  v_id     uuid;
  n        numeric;
BEGIN
  -- De a uno por orden: la segunda lectura espera a que termine la primera
  PERFORM 1 FROM ordenes_compra WHERE id = p_orden_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La orden de compra no existe.' USING ERRCODE = 'P0002', DETAIL = 'no_encontrada';
  END IF;

  SELECT c.id, c.total_factura_declarado, c.fecha_comprobante, c.created_at INTO v_prov
    FROM comprobantes_compra c
   WHERE c.orden_compra_id = p_orden_id
     AND c.tipo_comprobante = p_tipo
     AND c.estado NOT IN ('validado', 'cerrado', 'esperada')
     AND c.numero_comprobante ILIKE 'PENDIENTE-%'
   ORDER BY c.created_at
   LIMIT 1;

  IF FOUND THEN
    -- ¿Puede ser OTRA HOJA del mismo documento? Si lo leído dice otro total u otra fecha, es otro
    -- comprobante sin número: va aparte. (La fecha del provisorio solo vale si se leyó del papel,
    -- no si es el día en que se cargó.)
    IF coalesce(v_prov.total_factura_declarado, 0) > 0 AND v_total > 0
       AND abs(v_prov.total_factura_declarado - v_total) > 0.01 THEN
      v_otro := true;
    ELSIF v_fecha IS NOT NULL AND v_prov.fecha_comprobante IS NOT NULL
       AND v_prov.fecha_comprobante::date <> (v_prov.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
       AND v_prov.fecha_comprobante::date <> v_fecha THEN
      v_otro := true;
    END IF;

    IF NOT v_otro THEN
      -- La hoja con los totales suele ser la última: se toman si el provisorio no los tenía
      IF NOT (coalesce(v_prov.total_factura_declarado, 0) > 0) AND v_total > 0 THEN
        UPDATE comprobantes_compra SET
          total_factura_declarado   = v_total,
          total_neto                = coalesce(nullif(d ->> 'total_neto', '')::numeric, 0),
          total_iva                 = coalesce(nullif(d ->> 'total_iva', '')::numeric, 0),
          percepcion_iva_monto      = coalesce(nullif(d ->> 'percepcion_iva_monto', '')::numeric, 0),
          percepcion_iibb_monto     = coalesce(nullif(d ->> 'percepcion_iibb_monto', '')::numeric, 0),
          retencion_ganancias_monto = coalesce(nullif(d ->> 'retencion_ganancias_monto', '')::numeric, 0),
          impuestos_internos        = coalesce(nullif(d ->> 'impuestos_internos', '')::numeric, 0),
          otros_impuestos           = coalesce(nullif(d ->> 'otros_impuestos', '')::numeric, 0),
          total_calculado           = coalesce(nullif(d ->> 'total_calculado', '')::numeric, 0)
        WHERE id = v_prov.id;
      END IF;
      RETURN jsonb_build_object('id', v_prov.id, 'sumado', true, 'otro_provisorio', false);
    END IF;
  END IF;

  INSERT INTO comprobantes_compra (
    orden_compra_id, proveedor_id, tipo_comprobante, numero_comprobante, fecha_comprobante,
    total_factura_declarado, total_neto, total_iva, percepcion_iva_monto, percepcion_iibb_monto,
    retencion_ganancias_monto, impuestos_internos, otros_impuestos, total_calculado,
    foto_url, estado, ajusta_stock, descuento_fuera_factura
  ) VALUES (
    p_orden_id, p_proveedor_id, p_tipo,
    coalesce(nullif(d ->> 'numero_provisorio', ''), 'PENDIENTE-' || (extract(epoch FROM clock_timestamp()) * 1000)::bigint),
    coalesce(nullif(d ->> 'fecha_comprobante', '')::date, public.hoy_ar()),
    v_total,
    coalesce(nullif(d ->> 'total_neto', '')::numeric, 0),
    coalesce(nullif(d ->> 'total_iva', '')::numeric, 0),
    coalesce(nullif(d ->> 'percepcion_iva_monto', '')::numeric, 0),
    coalesce(nullif(d ->> 'percepcion_iibb_monto', '')::numeric, 0),
    coalesce(nullif(d ->> 'retencion_ganancias_monto', '')::numeric, 0),
    coalesce(nullif(d ->> 'impuestos_internos', '')::numeric, 0),
    coalesce(nullif(d ->> 'otros_impuestos', '')::numeric, 0),
    coalesce(nullif(d ->> 'total_calculado', '')::numeric, 0),
    nullif(d ->> 'foto_url', ''), 'pendiente_recepcion', true,
    coalesce(nullif(d ->> 'descuento_fuera_factura', '')::numeric, 0)
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'sumado', false, 'otro_provisorio', v_otro);
END;
$$;

COMMENT ON FUNCTION public.comprobante_provisorio_obtener(uuid, uuid, text, jsonb) IS
  'Comprobante provisorio (sin número leído) de una orden: devuelve el que hay o crea uno, con la orden bloqueada para que dos lecturas a la vez no creen dos.';

-- Solo las ejecuta el servidor
REVOKE ALL ON FUNCTION public.recepcion_item_sumar_documentado(uuid, numeric, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recepcion_item_sumar_documentado(uuid, numeric, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.comprobante_provisorio_obtener(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.comprobante_provisorio_obtener(uuid, uuid, text, jsonb) TO service_role;
