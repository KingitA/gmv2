-- ─────────────────────────────────────────────────────────────────────────────
-- Los renglones leídos de un comprobante se guardan JUNTO con lo que suman a la recepción
-- (Tanda 2-C, 19/11/2026; pendiente de la Tanda 1).
--
-- Qué pasaba: al leer una factura, el servidor primero sumaba la cantidad documentada de cada
-- línea de recepción (una por una) y recién al final guardaba los renglones del comprobante.
-- Si el servidor se cortaba en el medio quedaban sumas sin renglón: la recepción decía
-- "documentado 36" y el comprobante no tenía ese renglón.
--
-- comprobante_detalle_cargar(comprobante, recepción, filas): en UNA transacción, por cada fila
--   · si el artículo no tenía línea en la recepción, la crea (fuera de la orden);
--   · inserta el renglón del comprobante;
--   · suma lo documentado de la línea de recepción (recepcion_item_sumar_documentado, 20261118e).
-- Renglón y suma van juntos: o quedan los dos, o ninguno. Un renglón que la base rechaza no
-- frena a los demás: vuelve en "descartados" con el motivo, para avisarlo en pantalla.
--
-- VA DESPUÉS de 20261118e (corta con mensaje si falta). El código funciona con o sin esta
-- migración (sin ella sigue el camino anterior). No toca datos. Se puede correr más de una vez.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF to_regprocedure('public.recepcion_item_sumar_documentado(uuid, numeric, jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Falta aplicar ANTES la migración 20261118e_recepcion_documentado_atomico.sql. No se cambió nada.';
  END IF;
END $$;

-- p_filas: [ { "detalle": { articulo_id, articulo_sugerido_id, cantidad_facturada, precio_unitario,
--                           descuento1, descripcion_proveedor, codigo_proveedor, iva_porcentaje,
--                           match_score, match_estado, tipo_cantidad, costo_final, recepcion_item_id },
--              "crear_linea": true|false,          ← el artículo no tiene línea en la recepción
--              "documentado": { delta, precio_documentado, precio_real, cantidad_base,
--                               factor_conversion, conversion_source, requires_review } | null } ]
CREATE OR REPLACE FUNCTION public.comprobante_detalle_cargar(
  p_comprobante_id uuid,
  p_recepcion_id   uuid,
  p_filas          jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  c            record;
  f            jsonb;
  d            jsonb;
  doc          jsonb;
  v_item       uuid;
  v_articulo   uuid;
  v_guardados  int := 0;
  v_descartes  jsonb := '[]'::jsonb;
  v_lineas     jsonb := '[]'::jsonb;
BEGIN
  SELECT id, estado INTO c FROM comprobantes_compra WHERE id = p_comprobante_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El comprobante no existe.' USING ERRCODE = 'P0002', DETAIL = 'no_encontrado';
  END IF;
  IF c.estado IN ('validado', 'cerrado') THEN
    RAISE EXCEPTION 'El comprobante ya está validado: no se le pueden cargar renglones.' USING ERRCODE = 'P0001', DETAIL = 'validado';
  END IF;
  IF jsonb_typeof(p_filas) <> 'array' THEN
    RETURN jsonb_build_object('guardados', 0, 'descartados', '[]'::jsonb, 'lineas', '[]'::jsonb);
  END IF;

  FOR f IN SELECT * FROM jsonb_array_elements(p_filas) LOOP
    d := f -> 'detalle';
    doc := CASE WHEN jsonb_typeof(f -> 'documentado') = 'object' THEN f -> 'documentado' ELSE NULL END;
    -- Renglón + suma: juntos o ninguno
    BEGIN
      v_articulo := nullif(d ->> 'articulo_id', '')::uuid;
      v_item := nullif(d ->> 'recepcion_item_id', '')::uuid;

      IF v_item IS NULL AND v_articulo IS NOT NULL AND coalesce((f ->> 'crear_linea')::boolean, false) AND p_recepcion_id IS NOT NULL THEN
        -- Otro renglón (o otro documento) puede haberla creado recién: se reutiliza
        SELECT id INTO v_item FROM recepciones_items
         WHERE recepcion_id = p_recepcion_id AND articulo_id = v_articulo
         ORDER BY coalesce(fuera_de_oc, false), id LIMIT 1;
        IF v_item IS NULL THEN
          INSERT INTO recepciones_items (recepcion_id, articulo_id, cantidad_oc, cantidad_fisica, estado_linea, fuera_de_oc)
          VALUES (p_recepcion_id, v_articulo, 0, 0, 'pendiente', true)
          RETURNING id INTO v_item;
        END IF;
      END IF;

      INSERT INTO comprobantes_compra_detalle (
        comprobante_id, articulo_id, articulo_sugerido_id, cantidad_facturada, precio_unitario, descuento1,
        descripcion_proveedor, codigo_proveedor, iva_porcentaje, match_score, match_estado,
        recepcion_item_id, tipo_cantidad, costo_final
      ) VALUES (
        p_comprobante_id, v_articulo, nullif(d ->> 'articulo_sugerido_id', '')::uuid,
        coalesce(nullif(d ->> 'cantidad_facturada', '')::numeric, 1),
        coalesce(nullif(d ->> 'precio_unitario', '')::numeric, 0),
        coalesce(nullif(d ->> 'descuento1', '')::numeric, 0),
        d ->> 'descripcion_proveedor', d ->> 'codigo_proveedor',
        coalesce(nullif(d ->> 'iva_porcentaje', '')::numeric, 21),
        nullif(d ->> 'match_score', '')::numeric,
        coalesce(nullif(d ->> 'match_estado', ''), 'sin_match'),
        v_item,
        coalesce(nullif(d ->> 'tipo_cantidad', ''), 'unidad'),
        coalesce(nullif(d ->> 'costo_final', '')::numeric, 0)
      );

      IF v_item IS NOT NULL AND doc IS NOT NULL THEN
        PERFORM public.recepcion_item_sumar_documentado(v_item, coalesce(nullif(doc ->> 'delta', '')::numeric, 0), doc - 'delta');
      END IF;

      v_guardados := v_guardados + 1;
      IF v_articulo IS NOT NULL THEN
        v_lineas := v_lineas || jsonb_build_object('articulo_id', v_articulo, 'recepcion_item_id', v_item);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_descartes := v_descartes || jsonb_build_object(
        'descripcion', coalesce(d ->> 'descripcion_proveedor', d ->> 'codigo_proveedor', '(sin descripción)'),
        'motivo', SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('guardados', v_guardados, 'descartados', v_descartes, 'lineas', v_lineas);
END;
$$;

COMMENT ON FUNCTION public.comprobante_detalle_cargar(uuid, uuid, jsonb) IS
  'Guarda los renglones leídos de un comprobante de compra junto con lo que suman a la recepción, en una transacción. Devuelve los que no se pudieron guardar, con el motivo.';

REVOKE ALL ON FUNCTION public.comprobante_detalle_cargar(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.comprobante_detalle_cargar(uuid, uuid, jsonb) TO service_role;
