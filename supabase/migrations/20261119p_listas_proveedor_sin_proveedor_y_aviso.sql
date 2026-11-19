-- =====================================================================================
-- 20261119p — Listas de proveedor: sin proveedor no se aplican; la programada que no se
-- pudo aplicar entera avisa (rama salida-ia-listas, revisión antes de producción 19/11)
--
-- Parte de la definición VIGENTE en la base (leída el 19/11 con pg_get_functiondef) de
-- lista_proveedor_aplicar y listas_proveedores_aplicar_programadas (20261119a). Cambia:
--
--   1. lista_proveedor_aplicar: una lista SIN proveedor (llegó por mail de alguien que no se
--      identificó) no se aplica ni se programa: corta con P0001 / DETAIL 'sin_proveedor'
--      (la ruta /aplicar lo devuelve como 409 con el mensaje). Antes se aplicaba con los
--      descuentos "en cascada" por defecto y artículos que podían ser de cualquier proveedor.
--   2. listas_proveedores_aplicar_programadas: si la lista programada NO queda aplicada
--      (renglones sobre el tope, con error, o no se pudo ni empezar), deja un aviso en la
--      bandeja de Jarvis (ai_agenda_events, event_type 'aviso', tono 'atencion') con el enlace
--      a la lista. Antes volvía a "pendiente" sin que nadie se enterara.
--      El aviso va SIN clave a propósito: la revisión diaria cierra sola los avisos con clave
--      que ningún vigía vuelve a ver. Se evita repetirlo mirando metadata.lista_proveedor_id
--      entre los avisos pendientes.
--
-- Idempotente (CREATE OR REPLACE, misma firma). Necesita 20261119a aplicada.
-- No se corre sola: la aplica Juan.
-- =====================================================================================

CREATE OR REPLACE FUNCTION public.lista_proveedor_aplicar(p_lista_id uuid, p_usuario_id uuid, p_forzar_hoy boolean DEFAULT false, p_limite integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  l            record;
  it           record;
  a            record;
  v_tipo       text;
  v_tope       numeric;
  v_factor     numeric;
  v_precio     numeric;
  v_d1         numeric;
  v_d2         numeric;
  v_d3         numeric;
  v_d4         numeric;
  v_neto_ant   numeric;
  v_neto_nuevo numeric;
  v_var        numeric;
  v_frena      text;
  v_posterior  text;
  v_proc       int := 0;
  v_aplicados  int := 0;
  v_sin_cambio int := 0;
  v_revisar    int := 0;
  v_salteados  int := 0;
  v_errores    jsonb := '[]'::jsonb;
  v_pendientes int;
  v_quedan     int;
BEGIN
  SELECT * INTO l FROM listas_proveedores WHERE id = p_lista_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La lista no existe (puede que la hayan eliminado).' USING ERRCODE = 'P0002', DETAIL = 'no_encontrada';
  END IF;
  IF l.estado = 'aplicada' THEN
    RETURN jsonb_build_object('success', true, 'ya_aplicada', true, 'aplicada', true, 'aplicados', 0, 'errores', '[]'::jsonb, 'quedan', 0);
  END IF;

  -- (20261119p) Sin proveedor no se aplica ni se programa: no se sabe de quién es la lista, ni cómo
  -- se aplican sus descuentos, ni si los artículos son suyos.
  IF l.proveedor_id IS NULL THEN
    RAISE EXCEPTION 'La lista no tiene proveedor: elegilo antes de aplicarla. No cambió ningún precio.' USING ERRCODE = 'P0001', DETAIL = 'sin_proveedor';
  END IF;

  -- Vigencia futura: queda programada. No se toca ningún artículo hasta ese día.
  IF l.fecha_vigencia > public.hoy_ar() AND NOT coalesce(p_forzar_hoy, false) THEN
    UPDATE listas_proveedores
       SET estado = 'programada', programada_at = now(), programada_por = p_usuario_id
     WHERE id = p_lista_id;
    RETURN jsonb_build_object('success', true, 'programada', true, 'fecha_vigencia', l.fecha_vigencia, 'quedan', 0,
                              'renglones', (SELECT count(*) FROM listas_proveedores_items WHERE lista_id = p_lista_id AND estado_item = 'pendiente' AND articulo_id IS NOT NULL));
  END IF;

  SELECT coalesce(p.tipo_descuento, 'cascada') INTO v_tipo FROM proveedores p WHERE p.id = l.proveedor_id;
  v_tipo := coalesce(v_tipo, 'cascada');
  v_tope := CASE WHEN coalesce(l.tope_pct, 0) > 0 THEN l.tope_pct ELSE 50 END;

  FOR it IN
    SELECT * FROM listas_proveedores_items
     WHERE lista_id = p_lista_id AND estado_item = 'pendiente' AND articulo_id IS NOT NULL
     ORDER BY created_at, id
  LOOP
    EXIT WHEN p_limite IS NOT NULL AND v_proc >= p_limite;
    v_proc := v_proc + 1;
    -- Cada renglón es todo o nada: si falla, queda con su motivo y no frena a los demás
    BEGIN
      SELECT id, precio_compra, descuento1, descuento2, descuento3, descuento4, unidades_por_bulto INTO a
        FROM articulos WHERE id = it.articulo_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'el artículo ya no existe';
      END IF;

      v_frena := NULL;
      -- El costo del artículo es SIEMPRE por unidad: si la lista viene por bulto, se divide
      v_factor := CASE WHEN l.precio_por = 'bulto' AND coalesce(a.unidades_por_bulto, 1) > 1 THEN a.unidades_por_bulto ELSE 1 END;
      IF l.precio_por = 'bulto' AND coalesce(it.precio_compra, 0) > 0 AND NOT (coalesce(a.unidades_por_bulto, 1) > 1) THEN
        v_frena := 'La lista viene por bulto y el artículo no tiene unidades por bulto cargadas: no se puede saber el precio por unidad.';
      END IF;

      -- precio vacío o 0 = no tocar; descuento vacío = no tocar; descuento 0 = pasa a 0
      v_precio := CASE WHEN coalesce(it.precio_compra, 0) > 0 THEN round(it.precio_compra / v_factor, 4) ELSE coalesce(a.precio_compra, 0) END;
      -- A 2 decimales, que es como los guarda el artículo (articulos.descuentoN es numeric(5,2)) y el
      -- historial: si no, un 12,3456 de la lista se guarda 12,35 y en cada reaplicación daría "distinto".
      v_d1 := round(coalesce(it.descuento1, a.descuento1, 0), 2);
      v_d2 := round(coalesce(it.descuento2, a.descuento2, 0), 2);
      v_d3 := round(coalesce(it.descuento3, a.descuento3, 0), 2);
      v_d4 := round(coalesce(it.descuento4, a.descuento4, 0), 2);
      IF v_d1 < 0 OR v_d1 > 100 OR v_d2 < 0 OR v_d2 > 100 OR v_d3 < 0 OR v_d3 > 100 OR v_d4 < 0 OR v_d4 > 100 THEN
        RAISE EXCEPTION 'un descuento está fuera de 0 a 100 %%';
      END IF;

      -- Una lista con vigencia ANTERIOR no pisa lo que dejó una POSTERIOR ya aplicada del mismo proveedor
      SELECT coalesce(lp.nombre, 'lista') || ' (rige desde ' || to_char(lp.fecha_vigencia, 'DD/MM/YYYY') || ')' INTO v_posterior
        FROM precios_compra_historial h
        JOIN listas_proveedores lp ON lp.id = h.lista_proveedor_id
       WHERE h.articulo_id = it.articulo_id
         AND lp.id <> p_lista_id
         AND lp.proveedor_id IS NOT DISTINCT FROM l.proveedor_id
         AND lp.fecha_vigencia > l.fecha_vigencia
       ORDER BY lp.fecha_vigencia DESC
       LIMIT 1;

      -- Tope de cambio del costo neto (con los descuentos como los aplica el proveedor)
      v_neto_ant   := public.oc_neto_unitario(coalesce(a.precio_compra, 0), a.descuento1, a.descuento2, a.descuento3, a.descuento4, v_tipo);
      v_neto_nuevo := public.oc_neto_unitario(v_precio, v_d1, v_d2, v_d3, v_d4, v_tipo);
      v_var := CASE WHEN v_neto_ant > 0 THEN round((v_neto_nuevo - v_neto_ant) / v_neto_ant * 100, 1) ELSE NULL END;
      IF v_frena IS NULL AND v_var IS NOT NULL AND abs(v_var) > v_tope AND NOT coalesce(it.confirmado_tope, false) THEN
        v_frena := 'El costo ' || CASE WHEN v_var > 0 THEN 'sube ' ELSE 'baja ' END || replace(abs(v_var)::text, '.', ',')
                   || ' %: supera el tope de ' || replace(v_tope::text, '.', ',') || ' %. No se aplica sin confirmarlo.';
      END IF;

      IF v_posterior IS NOT NULL THEN
        UPDATE listas_proveedores_items
           SET estado_item = 'ignorado', error = 'No se aplicó: ya hay una lista posterior aplicada para este artículo — ' || v_posterior
         WHERE id = it.id;
        v_salteados := v_salteados + 1;
      ELSIF v_frena IS NOT NULL THEN
        UPDATE listas_proveedores_items SET estado_item = 'revisar', error = v_frena WHERE id = it.id;
        v_revisar := v_revisar + 1;
      ELSE
        IF v_precio IS DISTINCT FROM coalesce(a.precio_compra, 0)
           OR v_d1 IS DISTINCT FROM coalesce(a.descuento1, 0) OR v_d2 IS DISTINCT FROM coalesce(a.descuento2, 0)
           OR v_d3 IS DISTINCT FROM coalesce(a.descuento3, 0) OR v_d4 IS DISTINCT FROM coalesce(a.descuento4, 0) THEN
          UPDATE articulos
             SET precio_compra = v_precio, descuento1 = v_d1, descuento2 = v_d2, descuento3 = v_d3, descuento4 = v_d4,
                 actualizado_por = coalesce(p_usuario_id, actualizado_por)
           WHERE id = it.articulo_id;

          INSERT INTO precios_compra_historial (
            articulo_id, proveedor_id, precio_compra, descuento1, descuento2, descuento3, descuento4,
            precio_compra_anterior, descuento1_anterior, descuento2_anterior, descuento3_anterior, descuento4_anterior,
            origen, lista_proveedor_id, usuario_id, detalle
          ) VALUES (
            it.articulo_id, l.proveedor_id, round(v_precio, 2), v_d1, v_d2, v_d3, v_d4,
            coalesce(a.precio_compra, 0), coalesce(a.descuento1, 0), coalesce(a.descuento2, 0), coalesce(a.descuento3, 0), coalesce(a.descuento4, 0),
            'lista', p_lista_id, p_usuario_id,
            'Lista ' || coalesce(l.nombre, to_char(l.fecha_vigencia, 'DD/MM/YYYY')) || ' — rige desde ' || to_char(l.fecha_vigencia, 'DD/MM/YYYY')
              || CASE WHEN v_factor > 1 THEN ' — precio por bulto de ' || v_factor::text || ' u' ELSE '' END
          );
          v_aplicados := v_aplicados + 1;
        ELSE
          v_sin_cambio := v_sin_cambio + 1;
        END IF;

        UPDATE listas_proveedores_items
           SET estado_item = 'aplicado', error = NULL, aplicado_at = now(),
               precio_anterior = coalesce(a.precio_compra, 0),
               descuento1_anterior = coalesce(a.descuento1, 0), descuento2_anterior = coalesce(a.descuento2, 0),
               descuento3_anterior = coalesce(a.descuento3, 0), descuento4_anterior = coalesce(a.descuento4, 0)
         WHERE id = it.id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      UPDATE listas_proveedores_items SET estado_item = 'error', error = SQLERRM WHERE id = it.id;
      v_errores := v_errores || jsonb_build_object('item_id', it.id, 'codigo', it.codigo_proveedor, 'descripcion', it.descripcion_proveedor, 'error', SQLERRM);
    END;
  END LOOP;

  -- Renglones que todavía faltan procesar (se llamó con límite) y los que quedaron por resolver
  SELECT count(*) INTO v_pendientes FROM listas_proveedores_items
   WHERE lista_id = p_lista_id AND estado_item = 'pendiente' AND articulo_id IS NOT NULL;
  SELECT count(*) INTO v_quedan FROM listas_proveedores_items
   WHERE lista_id = p_lista_id AND estado_item IN ('error', 'revisar');

  -- Aplicada SOLO si no quedó nada pendiente, con error ni por revisar
  UPDATE listas_proveedores
     SET estado = CASE WHEN v_pendientes = 0 AND v_quedan = 0 THEN 'aplicada'
                       WHEN v_pendientes > 0 THEN estado
                       ELSE 'pendiente' END,
         errores = (SELECT count(*) FROM listas_proveedores_items WHERE lista_id = p_lista_id AND estado_item = 'error'),
         aplicada_at = CASE WHEN v_pendientes = 0 AND v_quedan = 0 THEN now() ELSE aplicada_at END,
         aplicada_por = CASE WHEN v_pendientes = 0 AND v_quedan = 0 THEN p_usuario_id ELSE aplicada_por END
   WHERE id = p_lista_id;

  RETURN jsonb_build_object('success', true, 'programada', false,
                            'aplicada', v_pendientes = 0 AND v_quedan = 0,
                            'procesados', v_proc, 'aplicados', v_aplicados, 'sin_cambio', v_sin_cambio,
                            'para_revisar', v_revisar, 'salteados_por_lista_posterior', v_salteados,
                            'errores', v_errores, 'quedan', v_pendientes, 'quedan_por_resolver', v_quedan);
END;
$function$;


CREATE OR REPLACE FUNCTION public.listas_proveedores_aplicar_programadas()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  l       record;
  n       int := 0;
  r       jsonb;
  v_falla text;
  v_por_revisar int;
  v_con_error   int;
BEGIN
  FOR l IN
    SELECT id, nombre, programada_por, fecha_vigencia, proveedor_id FROM listas_proveedores
     WHERE estado = 'programada' AND fecha_vigencia <= public.hoy_ar()
     ORDER BY fecha_vigencia, created_at
  LOOP
    v_falla := NULL;
    r := NULL;
    BEGIN
      -- Mismos controles que al aplicar a mano: lo que supera el tope queda "para revisar" (y la
      -- lista vuelve a "pendiente" para que alguien lo mire), no se aplica solo.
      r := public.lista_proveedor_aplicar(l.id, l.programada_por, true, NULL);
      n := n + 1;
    EXCEPTION WHEN OTHERS THEN
      -- no se pudo ni empezar: vuelve a pendiente para que alguien la mire
      v_falla := SQLERRM;
      UPDATE listas_proveedores SET estado = 'pendiente', observaciones = left(coalesce(observaciones || ' · ', '') || 'No se pudo aplicar sola: ' || SQLERRM, 1000) WHERE id = l.id;
    END;

    -- (20261119p) No quedó aplicada entera: aviso en la bandeja de Jarvis con el enlace a la lista.
    -- Nunca rompe el programador: si el aviso no se puede dejar, la lista igual quedó en pendiente.
    IF v_falla IS NOT NULL OR coalesce((r ->> 'aplicada')::boolean, false) = false THEN
      BEGIN
        SELECT count(*) FILTER (WHERE estado_item = 'revisar'), count(*) FILTER (WHERE estado_item = 'error')
          INTO v_por_revisar, v_con_error
          FROM listas_proveedores_items WHERE lista_id = l.id;
        IF NOT EXISTS (
          SELECT 1 FROM ai_agenda_events e
           WHERE e.event_type = 'aviso' AND e.status = 'pendiente'
             AND e.metadata ->> 'lista_proveedor_id' = l.id::text
        ) THEN
          INSERT INTO ai_agenda_events (title, description, event_type, priority, status, source, tono, severidad, acciones,
                                        related_entity_type, related_entity_id, metadata)
          VALUES (
            'La lista programada ' || coalesce('"' || l.nombre || '"', '') || ' no se aplicó entera',
            CASE WHEN v_falla IS NOT NULL
                 THEN 'El ' || to_char(l.fecha_vigencia, 'DD/MM/YYYY') || ' tenía que aplicarse sola y no se pudo: ' || v_falla || '. Volvió a pendiente: no cambió ningún precio.'
                 ELSE 'El ' || to_char(l.fecha_vigencia, 'DD/MM/YYYY') || ' se aplicó lo que se podía y quedaron '
                      || v_por_revisar || ' renglón(es) por revisar (cambio de costo mayor al tope o sin unidades por bulto)'
                      || CASE WHEN v_con_error > 0 THEN ' y ' || v_con_error || ' con error' ELSE '' END
                      || '. La lista volvió a pendiente: esos renglones no cambiaron el costo hasta que alguien los confirme.'
            END,
            'aviso', 'alta', 'pendiente', 'sistema', 'atencion', 70,
            jsonb_build_array(jsonb_build_object('texto', 'Ver la lista', 'pregunta', '', 'href', '/listas-proveedores/' || l.id::text)),
            'proveedor', l.proveedor_id::text,
            jsonb_build_object('lista_proveedor_id', l.id, 'por_revisar', v_por_revisar, 'con_error', v_con_error, 'falla', v_falla,
                               'url', '/listas-proveedores/' || l.id::text, 'url_texto', 'Ver la lista')
          );
        END IF;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'listas_proveedores_aplicar_programadas: no se pudo dejar el aviso de la lista %: %', l.id, SQLERRM;
      END;
    END IF;
  END LOOP;
  RETURN n;
END;
$function$;

-- Mismos permisos que 20261119a (CREATE OR REPLACE los conserva; se repiten por si acaso)
REVOKE ALL ON FUNCTION public.lista_proveedor_aplicar(uuid, uuid, boolean, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lista_proveedor_aplicar(uuid, uuid, boolean, int) TO service_role;
REVOKE ALL ON FUNCTION public.listas_proveedores_aplicar_programadas() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.listas_proveedores_aplicar_programadas() TO service_role;

-- Control después de aplicar (debe dar las dos en true):
-- SELECT position('sin_proveedor' in pg_get_functiondef('public.lista_proveedor_aplicar(uuid,uuid,boolean,integer)'::regprocedure)) > 0 AS sin_proveedor,
--        position('ai_agenda_events' in pg_get_functiondef('public.listas_proveedores_aplicar_programadas()'::regprocedure)) > 0 AS aviso;
