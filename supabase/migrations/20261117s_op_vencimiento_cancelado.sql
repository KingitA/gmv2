-- ═════════════════════════════════════════════════════════════════════════════
-- "Con este pago queda cancelado" — pagar MENOS que un vencimiento cargado a mano
-- Prueba integral de ENTRADA, Tanda 1-D (17/11/2026). Decisión de Juan: «dale, agregalo».
--
-- Con 20261117q un pago menor al importe deja el vencimiento pendiente por lo que
-- falta. Ahora la orden de pago puede marcar, por cada vencimiento cargado a mano,
-- "Con este pago queda cancelado" (sin marcar por defecto):
--   · marcado    → el vencimiento queda PAGADO y la diferencia queda registrada como
--                  descuento / ajuste (vencimientos.monto_ajuste), no como deuda pendiente;
--   · sin marcar → sigue pendiente por lo que falta (como en 20261117q).
-- Anular la orden deshace las dos cosas.
--
-- Piezas:
--   · ordenes_pago_imputaciones.cancela_vencimiento (la respuesta, por imputación)
--   · vencimientos.monto_ajuste (la diferencia perdonada)
--   · op_normalizar_imputaciones y op_crear: cuerpo EXACTO de 20261116p con las líneas
--     marcadas "v2" (llevan y guardan la marca). Generado por script.
--   · op_vencimiento_aplicar_pago / op_vencimiento_revertir_pago: misma firma que en
--     20261117q; leen la marca de la orden. op_confirmar y op_anular NO cambian.
--
-- REQUIERE 20261117q_op_pago_parcial.sql. Seguro de re-ejecutar. No toca datos.
-- Sin esta migración la pantalla no ofrece la opción.
-- ═════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF to_regprocedure('public.op_vencimiento_aplicar_pago(uuid, numeric, uuid)') IS NULL THEN
    RAISE EXCEPTION 'Falta aplicar ANTES la migración 20261117q_op_pago_parcial.sql. No se cambió nada.';
  END IF;
END $$;

ALTER TABLE public.ordenes_pago_imputaciones ADD COLUMN IF NOT EXISTS cancela_vencimiento boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.ordenes_pago_imputaciones.cancela_vencimiento IS
  'Solo vencimientos sin comprobante: true = con este pago el vencimiento queda cancelado aunque se pague menos (la diferencia va a vencimientos.monto_ajuste).';
ALTER TABLE public.vencimientos ADD COLUMN IF NOT EXISTS monto_ajuste numeric(20,2) NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.vencimientos.monto_ajuste IS
  'Descuento / ajuste: parte del vencimiento que NO se pagó y se dio por cancelada al pagarlo por orden de pago.';

CREATE OR REPLACE FUNCTION public.op_normalizar_imputaciones(p_imputaciones jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_item  jsonb;
  v_out   jsonb := '[]'::jsonb;
  v_monto numeric;
  v_mov   uuid;
  v_venc  uuid;
  v_comp  uuid;
BEGIN
  IF p_imputaciones IS NULL OR jsonb_typeof(p_imputaciones) <> 'array' THEN
    RETURN v_out;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_imputaciones)
  LOOP
    v_monto := round(COALESCE(NULLIF(v_item->>'monto_imputado', '')::numeric, 0), 2);
    IF v_monto = 0 THEN CONTINUE; END IF;

    v_mov  := NULLIF(v_item->>'movimiento_cc_id', '')::uuid;
    v_venc := NULLIF(v_item->>'vencimiento_id', '')::uuid;
    v_comp := NULLIF(v_item->>'comprobante_compra_id', '')::uuid;

    IF v_monto > 0 AND v_mov IS NULL THEN
      v_mov := op_movimiento_de(v_venc, v_comp);
    END IF;

    v_out := v_out || jsonb_build_object(
      'movimiento_cc_id', v_mov,
      'vencimiento_id', v_venc,
      'comprobante_compra_id', v_comp,
      'monto_imputado', v_monto,
      -- La respuesta "¿corresponde retener?" solo vale para un vencimiento sin comprobante
      'retiene_ganancias', CASE WHEN v_monto > 0 AND v_mov IS NULL AND v_venc IS NOT NULL
                                THEN NULLIF(v_item->>'retiene_ganancias', '')::boolean END,
      -- v2 (Juan, 17/11): "con este pago queda cancelado" — solo vencimiento sin comprobante
      'cancela_vencimiento', CASE WHEN v_monto > 0 AND v_mov IS NULL AND v_venc IS NOT NULL
                                  THEN COALESCE(NULLIF(v_item->>'cancela_vencimiento', '')::boolean, false) END
    );
  END LOOP;

  RETURN v_out;
END;
$function$;

CREATE OR REPLACE FUNCTION public.op_crear(p_payload jsonb, p_usuario text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_prov        uuid := NULLIF(p_payload->>'proveedor_id', '')::uuid;
  v_fecha       date := COALESCE(NULLIF(p_payload->>'fecha', '')::date, public.hoy_ar());
  v_clave       uuid := NULLIF(p_payload->>'clave', '')::uuid;
  v_medios      jsonb := p_payload->'medios_pago';
  v_manual      boolean := COALESCE((p_payload->>'ganancias_manual')::boolean, false);
  v_motivo      text := NULLIF(btrim(COALESCE(p_payload->>'ganancias_motivo', '')), '');
  v_imps        jsonb;
  v_calc        jsonb;
  v_base        numeric;
  v_ret_gan     numeric;
  v_ret_iibb    numeric := round(COALESCE(NULLIF(p_payload->>'retencion_iibb', '')::numeric, 0), 2);
  v_ret_iva     numeric := round(COALESCE(NULLIF(p_payload->>'retencion_iva', '')::numeric, 0), 2);
  v_ret_suss    numeric := round(COALESCE(NULLIF(p_payload->>'retencion_suss', '')::numeric, 0), 2);
  v_total_ret   numeric;
  v_total_med   numeric;
  v_total_imp   numeric;
  v_total_cred  numeric;
  v_neto_esp    numeric;
  v_monto_total numeric;
  v_m           jsonb;
  v_medio       text;
  v_cheque      record;
  v_numero      text;
  v_op          ordenes_pago%ROWTYPE;
  v_sin_resp    text;
BEGIN
  IF v_prov IS NULL THEN
    RAISE EXCEPTION 'Proveedor es obligatorio';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM proveedores WHERE id = v_prov) THEN
    RAISE EXCEPTION 'El proveedor no existe';
  END IF;
  IF v_medios IS NULL OR jsonb_typeof(v_medios) <> 'array' OR jsonb_array_length(v_medios) = 0 THEN
    RAISE EXCEPTION 'Debe agregar al menos un medio de pago';
  END IF;

  -- Una creación por proveedor a la vez (la validación de saldos lee OP pendientes)
  PERFORM pg_advisory_xact_lock(hashtext('op_proveedor:' || v_prov::text));

  -- Doble click / reintento: devolver la que ya se creó
  IF v_clave IS NOT NULL THEN
    SELECT * INTO v_op FROM ordenes_pago WHERE clave_idempotencia = v_clave;
    IF FOUND THEN
      RETURN to_jsonb(v_op) || jsonb_build_object('ya_existia', true);
    END IF;
  END IF;

  -- E-52 + E-54
  v_imps := op_normalizar_imputaciones(p_payload->'imputaciones');
  PERFORM op_validar_imputaciones(v_prov, v_imps, NULL, true);

  -- Vencimiento sin comprobante: hay que contestar si corresponde retener
  -- Ganancias (no hay valor por defecto). No se pregunta si el proveedor está
  -- exento ni si el vencimiento es de canal negro (nunca retiene).
  IF NOT COALESCE((ganancias_calcular(v_prov, 0, v_fecha)->>'exento')::boolean, false) THEN
    SELECT string_agg('"' || COALESCE(vn.concepto, 'vencimiento') || '"', ', ') INTO v_sin_resp
    FROM jsonb_array_elements(v_imps) e
    JOIN vencimientos vn ON vn.id = NULLIF(e->>'vencimiento_id', '')::uuid
    WHERE NULLIF(e->>'movimiento_cc_id', '') IS NULL
      AND (e->>'monto_imputado')::numeric > 0
      AND vn.canal IS DISTINCT FROM 'negro'
      AND NULLIF(e->>'retiene_ganancias', '') IS NULL;
    IF v_sin_resp IS NOT NULL THEN
      RAISE EXCEPTION 'Falta contestar si corresponde retener Ganancias en: %. Elegí Sí o No en cada vencimiento.', v_sin_resp;
    END IF;
  END IF;

  -- Retención de Ganancias RG 830
  v_calc := op_ganancias_preview(v_prov, v_imps, v_fecha);
  v_base := COALESCE((v_calc->>'base')::numeric, 0);
  v_ret_gan := COALESCE((v_calc->>'retencion')::numeric, 0);
  IF v_manual THEN
    IF v_motivo IS NULL THEN
      RAISE EXCEPTION 'El ajuste manual de la retención requiere un motivo';
    END IF;
    v_ret_gan := round(COALESCE(NULLIF(p_payload->>'retencion_ganancias', '')::numeric, 0), 2);
  END IF;
  IF v_ret_gan < 0 OR v_ret_iibb < 0 OR v_ret_iva < 0 OR v_ret_suss < 0 THEN
    RAISE EXCEPTION 'Las retenciones no pueden ser negativas';
  END IF;
  v_total_ret := v_ret_gan + v_ret_iibb + v_ret_iva + v_ret_suss;

  -- Medios de pago
  v_total_med := 0;
  FOR v_m IN SELECT * FROM jsonb_array_elements(v_medios)
  LOOP
    v_medio := v_m->>'medio';
    IF v_medio IS NULL OR v_medio NOT IN ('efectivo', 'cheque', 'cheque_propio', 'transferencia', 'deposito') THEN
      RAISE EXCEPTION 'Medio de pago desconocido: %', COALESCE(v_medio, '(vacío)');
    END IF;
    IF COALESCE(NULLIF(v_m->>'monto', '')::numeric, 0) < 0 THEN
      RAISE EXCEPTION 'Un medio de pago tiene importe negativo';
    END IF;
    IF v_medio = 'cheque' AND NULLIF(v_m->>'cheque_id', '') IS NOT NULL THEN
      SELECT numero, estado INTO v_cheque FROM cheques WHERE id = (v_m->>'cheque_id')::uuid;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Uno de los cheques elegidos ya no existe. Volvé a cargar la pantalla.';
      END IF;
      IF v_cheque.estado::text <> 'EN_CARTERA' THEN
        RAISE EXCEPTION 'El cheque % ya no está en cartera (está %). Sacalo del pago.', v_cheque.numero, v_cheque.estado;
      END IF;
    END IF;
    v_total_med := v_total_med + round(COALESCE(NULLIF(v_m->>'monto', '')::numeric, 0), 2);
  END LOOP;
  IF v_total_med <= 0 THEN
    RAISE EXCEPTION 'El total de medios de pago debe ser mayor a 0';
  END IF;

  SELECT COALESCE(sum((e->>'monto_imputado')::numeric), 0),
         COALESCE(sum(GREATEST(0, -(e->>'monto_imputado')::numeric)), 0)
  INTO v_total_imp, v_total_cred
  FROM jsonb_array_elements(v_imps) e;

  -- Cuadre y totales (regla única, ver cabecera del archivo)
  IF v_total_imp > 0 THEN
    v_neto_esp := round(v_total_imp - v_total_ret, 2);
    IF abs(v_total_med - v_neto_esp) > 0.01 THEN
      RAISE EXCEPTION 'No cuadra: imputado % − retenciones % = neto %, pero los medios suman %',
        fmt_moneda(v_total_imp), fmt_moneda(v_total_ret), fmt_moneda(v_neto_esp), fmt_moneda(v_total_med);
    END IF;
    v_monto_total := v_total_imp;
  ELSE
    -- Pago a cuenta (sin imputar): cancela de la deuda lo pagado + lo retenido
    v_monto_total := v_total_med + v_total_ret;
  END IF;

  v_numero := op_siguiente_numero();

  INSERT INTO ordenes_pago (
    numero_op, proveedor_id, fecha, monto_total, estado, observaciones,
    retencion_ganancias, retencion_iibb, retencion_iva, retencion_suss,
    total_retenciones, neto_a_pagar, base_ganancias, total_creditos,
    ganancias_ajuste_manual, ganancias_motivo, usuario_creador, clave_idempotencia
  ) VALUES (
    v_numero, v_prov, v_fecha, v_monto_total, 'pendiente', NULLIF(btrim(COALESCE(p_payload->>'observaciones', '')), ''),
    v_ret_gan, v_ret_iibb, v_ret_iva, v_ret_suss,
    v_total_ret, v_total_med, v_base, v_total_cred,
    v_manual, CASE WHEN v_manual THEN v_motivo END, left(COALESCE(NULLIF(p_usuario, ''), 'admin'), 100), v_clave
  ) RETURNING * INTO v_op;

  INSERT INTO ordenes_pago_detalle (
    orden_pago_id, medio, monto, cheque_id, cheque_banco, cheque_numero, cheque_fecha_vencimiento,
    banco_destino, numero_cuenta, cbu, numero_transferencia, fecha_transferencia, observaciones,
    cuenta_origen_tipo, cuenta_origen_id
  )
  SELECT
    v_op.id,
    -- op_confirmar reconoce el cheque propio como medio 'cheque' SIN cheque_id
    CASE WHEN e->>'medio' = 'cheque_propio' THEN 'cheque' ELSE e->>'medio' END,
    round(COALESCE(NULLIF(e->>'monto', '')::numeric, 0), 2),
    NULLIF(e->>'cheque_id', '')::uuid,
    NULLIF(e->>'cheque_banco', ''),
    NULLIF(e->>'cheque_numero', ''),
    NULLIF(e->>'cheque_fecha_vencimiento', '')::date,
    NULLIF(e->>'banco_destino', ''),
    NULLIF(e->>'numero_cuenta', ''),
    NULLIF(e->>'cbu', ''),
    NULLIF(e->>'numero_transferencia', ''),
    NULLIF(e->>'fecha_transferencia', '')::date,
    NULLIF(e->>'observaciones', ''),
    NULLIF(e->>'cuenta_origen_tipo', ''),
    NULLIF(e->>'cuenta_origen_id', '')::uuid
  FROM jsonb_array_elements(v_medios) e;

  INSERT INTO ordenes_pago_imputaciones (orden_pago_id, movimiento_cc_id, vencimiento_id, comprobante_compra_id, monto_imputado, retiene_ganancias, cancela_vencimiento)   -- v2: + cancela_vencimiento
  SELECT
    v_op.id,
    NULLIF(e->>'movimiento_cc_id', '')::uuid,
    NULLIF(e->>'vencimiento_id', '')::uuid,
    NULLIF(e->>'comprobante_compra_id', '')::uuid,
    (e->>'monto_imputado')::numeric,
    NULLIF(e->>'retiene_ganancias', '')::boolean,
    COALESCE(NULLIF(e->>'cancela_vencimiento', '')::boolean, false)   -- v2
  FROM jsonb_array_elements(v_imps) e;

  RETURN to_jsonb(v_op) || jsonb_build_object('ya_existia', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.op_normalizar_imputaciones(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.op_normalizar_imputaciones(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.op_crear(jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.op_crear(jsonb, text) TO service_role;

-- ═══ Vencimiento SIN comprobante: aplicar un pago (v2: con "queda cancelado") ═══
CREATE OR REPLACE FUNCTION public.op_vencimiento_aplicar_pago(p_vencimiento_id uuid, p_monto numeric, p_op_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v         vencimientos%ROWTYPE;
  v_cancela boolean;
  v_total   numeric;
  v_pagado  numeric;
BEGIN
  SELECT * INTO v FROM vencimientos WHERE id = p_vencimiento_id FOR UPDATE;
  IF NOT FOUND OR v.estado <> 'pendiente' THEN RETURN; END IF;

  SELECT COALESCE(bool_or(cancela_vencimiento), false) INTO v_cancela
  FROM ordenes_pago_imputaciones WHERE orden_pago_id = p_op_id AND vencimiento_id = p_vencimiento_id;

  v_total  := COALESCE(v.monto_original, v.monto, 0);
  v_pagado := COALESCE(v.monto_pagado, 0) + p_monto;

  IF p_monto >= COALESCE(v.monto, 0) - 0.01 OR v_cancela THEN
    -- Se pagó lo que faltaba (o más), o se pagó menos y se da por cancelado:
    -- pagado, vuelve a mostrar el importe completo y la diferencia queda como ajuste
    UPDATE vencimientos
       SET estado = 'pagado', orden_pago_id = p_op_id,
           monto = v_total,
           monto_pagado = v_pagado,
           monto_ajuste = GREATEST(0, round(v_total - v_pagado, 2)),
           updated_at = now()
     WHERE id = p_vencimiento_id;
  ELSE
    -- Pago parcial: sigue pendiente por lo que falta
    UPDATE vencimientos
       SET monto_original = COALESCE(monto_original, monto),
           monto = round(monto - p_monto, 2),
           monto_pagado = v_pagado,
           updated_at = now()
     WHERE id = p_vencimiento_id;
  END IF;
END;
$function$;

-- ═══ Vencimiento SIN comprobante: devolver un pago (v2: borra también el ajuste) ═══
CREATE OR REPLACE FUNCTION public.op_vencimiento_revertir_pago(p_vencimiento_id uuid, p_monto numeric, p_op_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v        vencimientos%ROWTYPE;
  v_pagado numeric;
BEGIN
  SELECT * INTO v FROM vencimientos WHERE id = p_vencimiento_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  v_pagado := GREATEST(0, COALESCE(v.monto_pagado, 0) - p_monto);

  IF v.estado = 'pagado' AND v.orden_pago_id IS DISTINCT FROM p_op_id THEN
    -- Lo terminó de pagar OTRA orden: no se le cambia el importe ni el estado
    UPDATE vencimientos SET monto_pagado = v_pagado, updated_at = now() WHERE id = p_vencimiento_id;
    RETURN;
  END IF;

  -- (si esta orden lo había dejado pagado, op_anular lo vuelve a pendiente a continuación)
  UPDATE vencimientos
     SET monto_pagado = v_pagado,
         monto_ajuste = 0,
         monto = CASE WHEN monto_original IS NOT NULL THEN round(monto_original - v_pagado, 2) ELSE monto END,
         monto_original = CASE WHEN v_pagado <= 0.01 THEN NULL ELSE monto_original END,
         updated_at = now()
   WHERE id = p_vencimiento_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.op_vencimiento_aplicar_pago(uuid, numeric, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.op_vencimiento_aplicar_pago(uuid, numeric, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.op_vencimiento_revertir_pago(uuid, numeric, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.op_vencimiento_revertir_pago(uuid, numeric, uuid) TO service_role;
