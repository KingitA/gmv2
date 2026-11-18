-- ─────────────────────────────────────────────────────────────────────────────
-- Los vencimientos ESTIMADOS de una orden de compra se CANCELAN, no se borran (18/11/2026).
--
-- Qué pasaba (visto en producción al validar FA 0003-00045711 de la OC-000012):
--   "No se validó …: vencimientos_historial es un historial: no se modifica ni se borra".
-- Cada alta y cada cambio de un vencimiento deja una fila en vencimientos_historial (la
-- auditoría de 20261105_jarvis_quien_hizo.sql), que es inmutable y cuelga del vencimiento con
-- ON DELETE CASCADE. Borrar un vencimiento intenta borrar su historia y la base lo rechaza.
-- Las funciones de la orden de compra (20261117n) BORRABAN los estimados al reemplazarlos por
-- el real, al cancelar la orden y al editarla: fallaban siempre, y con ellas validar la
-- factura, finalizar, cancelar y editar una orden.
--
-- Qué cambia (NO se toca la historia ni su disparador: es la auditoría):
--   · oc_vencimientos_estimados_cancelar(orden, canal, motivo, usuario)  NUEVA: los estimados de
--     la orden que nadie pagó ni imputó pasan a estado = 'cancelado', con el motivo en
--     observaciones y el monto sin tocar.
--   · oc_vencimientos_estimados_borrar(orden, canal)   mismo nombre (lo llaman funciones ya
--     instaladas), ahora cancela.
--   · oc_vencimientos_estimados_sincronizar(orden, usuario)   al editar la orden cancela los
--     estimados viejos ("orden … editada") y crea los nuevos; al cancelarla, solo los cancela.
--   · oc_vencimiento_estimado_reemplazar(orden, canal, monto)   el estimado cubierto por la
--     factura queda 'cancelado' ("reemplazado por el vencimiento real de la factura …"); el
--     cubierto en parte baja su monto (un UPDATE: eso la historia lo acepta y lo registra).
-- Las firmas no cambian: comprobante_compra_validar, oc_cerrar_estimados, oc_guardar y
-- oc_cancelar siguen llamando igual.
--
-- No toca datos. Se puede correr más de una vez. Requiere 20261117n (ya aplicada).
-- El mismo texto quedó en 20261117n_oc_guardar.sql, para que volver a correr aquella no
-- reinstale las versiones que borraban.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.oc_vencimientos_estimados_cancelar(
  p_orden_id   uuid,
  p_canal      text DEFAULT NULL,
  p_motivo     text DEFAULT NULL,
  p_usuario_id uuid DEFAULT NULL
) RETURNS int
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_n int;
BEGIN
  UPDATE vencimientos v SET
    estado          = 'cancelado',
    observaciones   = left(coalesce(nullif(trim(v.observaciones), '') || ' ', '')
                        || '[Cancelado el ' || to_char(public.hoy_ar(), 'DD/MM/YYYY') || ': '
                        || coalesce(nullif(trim(p_motivo), ''), 'estimado de orden de compra sin efecto') || ']', 2000),
    actualizado_por = coalesce(p_usuario_id, v.actualizado_por),
    updated_at      = now()
   WHERE v.referencia_tipo = 'orden_compra'
     AND v.referencia_id = p_orden_id
     AND v.es_estimado = true
     AND v.estado IN ('pendiente', 'vencido')
     AND v.orden_pago_id IS NULL
     AND (p_canal IS NULL OR v.canal = p_canal)
     AND NOT EXISTS (SELECT 1 FROM ordenes_pago_imputaciones i WHERE i.vencimiento_id = v.id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- Nombre anterior (lo llaman funciones ya instaladas): ya no borra, cancela.
CREATE OR REPLACE FUNCTION public.oc_vencimientos_estimados_borrar(p_orden_id uuid, p_canal text DEFAULT NULL)
RETURNS int
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RETURN public.oc_vencimientos_estimados_cancelar(p_orden_id, p_canal, NULL, NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.oc_vencimientos_estimados_sincronizar(p_orden_id uuid, p_usuario_id uuid DEFAULT NULL)
RETURNS int
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  o          record;
  t          record;
  v_canal    text;
  v_total    numeric;
  v_ac       jsonb;
  v_base     date;
  v_dias     int[];
  v_n        int;
  v_i        int;
  v_monto    numeric;
  v_resto    numeric;
  v_fecha    date;
  v_medio    text;
  v_forma    text;
  v_modal    text;
  v_valid    date;
  v_plazo    int;
  v_creados  int := 0;
  v_sin_ac   boolean;
BEGIN
  SELECT id, numero_orden, proveedor_id, estado, fecha_estimada_recepcion, acuerdo_pago
    INTO o FROM ordenes_compra WHERE id = p_orden_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  -- Los estimados anteriores no se borran: quedan cancelados con el motivo (ver arriba)
  PERFORM public.oc_vencimientos_estimados_cancelar(
    p_orden_id, NULL,
    CASE WHEN o.estado = 'cancelada' THEN 'orden ' || o.numero_orden || ' cancelada'
         ELSE 'orden ' || o.numero_orden || ' editada: se recalculó el estimado' END,
    p_usuario_id);
  IF o.estado = 'cancelada' THEN RETURN 0; END IF;

  -- Si ya hay un estimado de esta orden que alguien pagó o imputó, no se generan otros
  IF EXISTS (SELECT 1 FROM vencimientos WHERE referencia_tipo = 'orden_compra' AND referencia_id = p_orden_id AND es_estimado = true AND estado <> 'cancelado') THEN
    RETURN 0;
  END IF;

  SELECT * INTO t FROM oc_totales(p_orden_id);
  -- Una orden vieja (fecha de entrega ya pasada) no genera vencimientos con fecha pasada:
  -- el plazo corre desde hoy.
  v_base := greatest(coalesce(o.fecha_estimada_recepcion, public.hoy_ar()), public.hoy_ar());

  FOREACH v_canal IN ARRAY ARRAY['blanco', 'negro'] LOOP
    v_total := CASE WHEN v_canal = 'blanco' THEN t.total_blanco ELSE t.total_negro END;
    IF coalesce(v_total, 0) <= 0 THEN CONTINUE; END IF;

    -- Acuerdo del canal; negro sin acuerdo propio = el de blanco
    v_ac := o.acuerdo_pago -> v_canal;
    IF v_canal = 'negro' AND (v_ac IS NULL OR jsonb_typeof(v_ac) <> 'object'
        OR (nullif(v_ac ->> 'medio', '') IS NULL AND nullif(v_ac ->> 'dias', '') IS NULL AND nullif(v_ac ->> 'entrega', '') IS NULL AND nullif(v_ac ->> 'cuotas', '') IS NULL)) THEN
      v_ac := o.acuerdo_pago -> 'blanco';
    END IF;
    IF v_ac IS NULL OR jsonb_typeof(v_ac) <> 'object' THEN v_ac := '{}'::jsonb; END IF;

    -- Días: cuotas "30/60/90" o un solo plazo
    v_dias := NULL;
    IF nullif(v_ac ->> 'cuotas', '') IS NOT NULL AND (v_ac ->> 'cuotas') ~ '^[0-9]{1,3}(/[0-9]{1,3})*$' THEN
      v_dias := string_to_array(v_ac ->> 'cuotas', '/')::int[];
    ELSIF nullif(v_ac ->> 'dias', '') IS NOT NULL AND (v_ac ->> 'dias') ~ '^[0-9]{1,4}$' THEN
      v_dias := ARRAY[(v_ac ->> 'dias')::int];
    END IF;
    v_sin_ac := v_dias IS NULL;
    IF v_sin_ac THEN v_dias := ARRAY[0]; END IF;

    v_medio := nullif(v_ac ->> 'medio', '');
    v_forma := CASE v_medio WHEN 'transferencia' THEN 'transferencia'
                            WHEN 'efectivo' THEN 'efectivo'
                            WHEN 'cheques' THEN 'cheque'
                            WHEN 'cheques_y_efectivo' THEN 'cheque'
                            WHEN 'echeq' THEN 'cheque'
                            ELSE NULL END;
    v_modal := CASE nullif(v_ac ->> 'entrega', '') WHEN 'deposito_bancario' THEN 'deposito'
                                                    WHEN 'retira_oficina' THEN 'entrega'
                                                    WHEN 'envio_grimar' THEN 'grimar'
                                                    ELSE NULL END;
    v_plazo := CASE WHEN (v_ac ->> 'plazo_cheque') ~ '^[0-9]{1,4}$' THEN (v_ac ->> 'plazo_cheque')::int ELSE 0 END;

    v_n := array_length(v_dias, 1);
    v_resto := v_total;
    FOR v_i IN 1 .. v_n LOOP
      v_monto := CASE WHEN v_i = v_n THEN v_resto ELSE round(v_total / v_n, 2) END;
      v_resto := v_resto - v_monto;
      v_fecha := v_base + v_dias[v_i];
      v_valid := CASE WHEN v_forma = 'cheque' AND v_plazo > 0 THEN v_fecha + v_plazo ELSE NULL END;

      INSERT INTO vencimientos (
        proveedor_id, tipo, canal, concepto, monto, fecha_vencimiento, estado,
        forma_pago, modalidad, fecha_validez, referencia_id, referencia_tipo,
        es_estimado, descuentos_aplicados, observaciones, creado_por, actualizado_por
      ) VALUES (
        o.proveedor_id, 'factura', v_canal,
        'ESTIMADO ' || o.numero_orden
          || CASE WHEN v_canal = 'negro' THEN ' (sin factura)' ELSE '' END
          || CASE WHEN v_n > 1 THEN ' — cuota ' || v_i || '/' || v_n ELSE '' END
          || ' — falta la factura',
        v_monto, v_fecha, 'pendiente',
        v_forma, v_modal, v_valid, p_orden_id, 'orden_compra',
        true, false,
        'Vencimiento ESTIMADO, generado por la orden de compra ' || o.numero_orden
          || ': fecha estimada de entrega + ' || v_dias[v_i] || ' días. Se reemplaza por el real al validar la factura y se borra si la orden se cancela.'
          || CASE WHEN v_sin_ac THEN ' El proveedor no tiene acuerdo de pago cargado: se tomó la fecha de entrega.' ELSE '' END
          || CASE WHEN v_ac ->> 'de_legado' = 'true' THEN ' ACUERDO DE PAGO SIN CARGAR: el plazo salió del dato viejo de la ficha del proveedor (plazo en días). Cargar el acuerdo en la ficha fiscal.' ELSE '' END,
        p_usuario_id, p_usuario_id
      );
      v_creados := v_creados + 1;
    END LOOP;
  END LOOP;

  RETURN v_creados;
END;
$$;

CREATE OR REPLACE FUNCTION public.oc_vencimiento_estimado_reemplazar(
  p_orden_id uuid,
  p_canal    text    DEFAULT NULL,
  p_monto    numeric DEFAULT NULL
) RETURNS int
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v         record;
  v_resto   numeric;
  v_n       int := 0;
  v_factura text;
  v_motivo  text;
BEGIN
  IF p_orden_id IS NULL THEN RETURN 0; END IF;
  IF p_canal IS NOT NULL AND p_canal NOT IN ('blanco', 'negro') THEN
    RAISE EXCEPTION 'oc_vencimiento_estimado_reemplazar: canal inválido (%)', p_canal;
  END IF;

  -- Por qué se cancela: la última factura validada de la orden, si la hay
  SELECT c.tipo_comprobante || ' ' || c.numero_comprobante INTO v_factura
    FROM comprobantes_compra c
   WHERE c.orden_compra_id = p_orden_id AND c.estado IN ('validado', 'cerrado')
     AND c.tipo_comprobante NOT IN ('Remito', 'NC', 'NCA', 'NCB', 'NCC', 'Reversa')
   ORDER BY c.fecha_validacion DESC NULLS LAST, c.created_at DESC
   LIMIT 1;
  v_motivo := CASE WHEN v_factura IS NOT NULL THEN 'reemplazado por el vencimiento real de la factura ' || v_factura
                   ELSE 'la orden se cerró sin factura para este estimado' END;

  IF p_monto IS NULL THEN
    RETURN public.oc_vencimientos_estimados_cancelar(p_orden_id, p_canal, v_motivo, NULL);
  END IF;

  v_resto := p_monto;
  FOR v IN
    SELECT ve.id, ve.monto FROM vencimientos ve
     WHERE ve.referencia_tipo = 'orden_compra' AND ve.referencia_id = p_orden_id
       AND ve.es_estimado = true AND ve.estado IN ('pendiente', 'vencido')
       AND ve.orden_pago_id IS NULL
       AND (p_canal IS NULL OR ve.canal = p_canal)
       AND NOT EXISTS (SELECT 1 FROM ordenes_pago_imputaciones i WHERE i.vencimiento_id = ve.id)
     ORDER BY ve.fecha_vencimiento, ve.created_at
       FOR UPDATE
  LOOP
    EXIT WHEN v_resto <= 0.01;
    IF v.monto - v_resto <= 0.01 THEN
      -- cubierto del todo: cancelado, con el monto como estaba
      UPDATE vencimientos SET
        estado        = 'cancelado',
        observaciones = left(coalesce(nullif(trim(observaciones), '') || ' ', '')
                          || '[Cancelado el ' || to_char(public.hoy_ar(), 'DD/MM/YYYY') || ': ' || v_motivo || ']', 2000),
        updated_at    = now()
      WHERE id = v.id;
      v_resto := v_resto - v.monto;
      v_n := v_n + 1;
    ELSE
      -- cubierto en parte: queda estimado lo que falta facturar
      UPDATE vencimientos SET monto = round(v.monto - v_resto, 2), updated_at = now() WHERE id = v.id;
      v_resto := 0;
    END IF;
  END LOOP;
  RETURN v_n;
END;
$$;

COMMENT ON FUNCTION public.oc_vencimiento_estimado_reemplazar(uuid, text, numeric) IS
  'Cancela (o descuenta) los vencimientos ESTIMADOS que generó una orden de compra, cuando llega el vencimiento real de la factura. No borra: el estimado cubierto queda en estado cancelado. Llamarla dentro de la misma transacción que crea el vencimiento real.';

REVOKE ALL ON FUNCTION public.oc_vencimientos_estimados_cancelar(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.oc_vencimientos_estimados_cancelar(uuid, text, text, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.oc_vencimientos_estimados_borrar(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.oc_vencimientos_estimados_borrar(uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
