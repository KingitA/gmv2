-- 20261119s: e-cheq emitido por Credicoop: el número lo pone el banco (op_crear no lo exige).
-- Base: op_crear tal cual está en producción el 19/11/2026. CREATE OR REPLACE conserva los permisos.

CREATE OR REPLACE FUNCTION public.op_crear(p_payload jsonb, p_usuario text DEFAULT NULL::text)
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
  v_reserva     text;   -- v3
  v_presentado  date;   -- v4
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
  -- v5 (E-57): la retención se calcula con la fecha de HOY (día en que se arma). Si la orden
  -- queda pendiente y se confirma otro día, se recalcula al confirmar.
  v_calc := op_ganancias_preview(v_prov, v_imps, public.hoy_ar());
  v_base := COALESCE((v_calc->>'base')::numeric, 0);
  v_ret_gan := COALESCE((v_calc->>'retencion')::numeric, 0);
  IF v_manual THEN
    IF v_motivo IS NULL THEN
      RAISE EXCEPTION 'El ajuste manual de la retención requiere un motivo';
    END IF;
    v_ret_gan := round(COALESCE(NULLIF(p_payload->>'retencion_ganancias', '')::numeric, 0), 2);
  END IF;
  -- (El control de "período ya presentado ante ARCA" va al CONFIRMAR, contra el día de la
  --  confirmación: op_confirmar. La fecha de la orden no cuenta para la retención.)
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
      -- La fila del cheque queda bloqueada hasta el final: dos órdenes (aunque sean de proveedores
      -- distintos) no pueden reservar el mismo cheque a la vez.
      SELECT numero, estado INTO v_cheque FROM cheques WHERE id = (v_m->>'cheque_id')::uuid FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Uno de los cheques elegidos ya no existe. Volvé a cargar la pantalla.';
      END IF;
      IF v_cheque.estado::text <> 'EN_CARTERA' THEN
        RAISE EXCEPTION 'El cheque % ya no está en cartera (está %). Sacalo del pago.', v_cheque.numero, v_cheque.estado;
      END IF;
      -- v3 (E-66): una orden PENDIENTE reserva los cheques de tercero que eligió
      SELECT string_agg(DISTINCT o.numero_op, ', ') INTO v_reserva
      FROM ordenes_pago_detalle d JOIN ordenes_pago o ON o.id = d.orden_pago_id
      WHERE o.estado = 'pendiente' AND d.cheque_id = (v_m->>'cheque_id')::uuid;
      IF v_reserva IS NOT NULL THEN
        RAISE EXCEPTION 'El cheque % ya está reservado por la orden de pago pendiente %. Elegí otro, o confirmá o eliminá esa orden.', v_cheque.numero, v_reserva;
      END IF;
      IF (SELECT count(*) FROM jsonb_array_elements(v_medios) x WHERE x->>'cheque_id' = v_m->>'cheque_id') > 1 THEN
        RAISE EXCEPTION 'El cheque % está dos veces en el pago.', v_cheque.numero;
      END IF;
    END IF;
    -- v3 (E-62): cheque propio / e-cheq — hacen falta el número y la fecha de pago
    IF v_medio = 'cheque_propio' OR (v_medio = 'cheque' AND NULLIF(v_m->>'cheque_id', '') IS NULL) THEN
      -- 20261119s: el e-cheq de una cuenta conectada al banco por API (Credicoop) lo emite el
      -- banco y él pone el número (op_confirmar lo toma de la respuesta): no se pide acá.
      IF NULLIF(btrim(COALESCE(v_m->>'cheque_numero', '')), '') IS NULL
         AND NOT (COALESCE(NULLIF(v_m->>'es_echeq', '')::boolean, false)
                  AND COALESCE(v_m->>'cuenta_origen_tipo', '') = 'BANCO'
                  AND EXISTS (SELECT 1 FROM cuentas_bancarias cb
                               WHERE cb.id = NULLIF(v_m->>'cuenta_origen_id', '')::uuid AND cb.api_banco IS NOT NULL)) THEN
        RAISE EXCEPTION 'Al cheque propio de % le falta el número.', fmt_moneda(COALESCE(NULLIF(v_m->>'monto', '')::numeric, 0));
      END IF;
      IF NULLIF(v_m->>'cheque_fecha_vencimiento', '') IS NULL THEN
        RAISE EXCEPTION 'Al cheque propio N° % le falta la fecha de pago.', v_m->>'cheque_numero';
      END IF;
      IF NULLIF(v_m->>'cuenta_origen_id', '') IS NULL OR COALESCE(v_m->>'cuenta_origen_tipo', '') <> 'BANCO' THEN
        RAISE EXCEPTION 'Al cheque propio N° % le falta la cuenta bancaria de la que sale.', v_m->>'cheque_numero';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM cuentas_bancarias WHERE id = (v_m->>'cuenta_origen_id')::uuid) THEN
        RAISE EXCEPTION 'La cuenta bancaria del cheque propio N° % no existe.', v_m->>'cheque_numero';
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
    cuenta_origen_tipo, cuenta_origen_id, es_echeq   -- v3: + es_echeq
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
    NULLIF(e->>'cuenta_origen_id', '')::uuid,
    COALESCE(NULLIF(e->>'es_echeq', '')::boolean, false)   -- v3
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
