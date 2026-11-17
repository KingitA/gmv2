-- ═════════════════════════════════════════════════════════════════════════════
-- Cheques en la orden de pago: propio / e-cheq reales, reserva de cheques de tercero,
-- y los vencimientos ESTIMADOS de una orden de compra no se pagan
-- Prueba integral de ENTRADA, Tanda 1-D (17/11/2026): E-62, E-66.
--
-- E-62  Cheque propio y e-cheq como medios de pago de verdad:
--       · la orden guarda de qué cuenta bancaria sale (cuentas_bancarias, no texto
--         libre), el número, la fecha de pago y si es e-cheq (ordenes_pago_detalle.es_echeq);
--       · al confirmar, el cheque emitido queda atado a esa cuenta;
--       · el saldo del banco baja cuando el cheque SE DEBITA: cheque_propio_debitar().
--         Antes "debitar" solo cambiaba el estado y el banco no bajaba nunca.
-- E-66  Una orden PENDIENTE reserva los cheques de tercero que eligió: otra orden no
--       puede usar el mismo cheque hasta que la primera se confirme o se elimine.
-- Además: op_validar_imputaciones rechaza pagar un vencimiento estimado de una orden de
--       compra (es_estimado + referencia a la OC): todavía no hay factura.
--
-- Funciones (todas generadas por script desde su última versión, cambios marcados):
--   op_validar_imputaciones v2 = 20261116p + control "v2"
--   op_crear v3                = 20261117s (v2) + líneas "v3"
--   op_confirmar v10           = 20261117t (v9) + el alta del cheque propio "v10"
--   cheque_propio_debitar      = nueva
--
-- REQUIERE 20261117t (y por lo tanto q, r) y 20261117s. Seguro de re-ejecutar. No toca datos.
-- ═════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF to_regclass('public.retenciones_exportaciones') IS NULL THEN
    RAISE EXCEPTION 'Falta aplicar ANTES la migración 20261117t_retenciones_ajustes.sql. No se cambió nada.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'ordenes_pago_imputaciones' AND column_name = 'cancela_vencimiento') THEN
    RAISE EXCEPTION 'Falta aplicar ANTES la migración 20261117s_op_vencimiento_cancelado.sql. No se cambió nada.';
  END IF;
END $$;

ALTER TABLE public.ordenes_pago_detalle ADD COLUMN IF NOT EXISTS es_echeq boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.ordenes_pago_detalle.es_echeq IS
  'Cheque propio electrónico (e-cheq). La cuenta de la que sale va en cuenta_origen_tipo = BANCO / cuenta_origen_id.';
-- cheques.cuenta_banco_id ya existía ("para depósito"); en un cheque PROPIO es la cuenta emisora.
ALTER TABLE public.cheques ADD COLUMN IF NOT EXISTS cuenta_banco_id uuid;

-- ═══ op_validar_imputaciones v2 ═══
CREATE OR REPLACE FUNCTION public.op_validar_imputaciones(
  p_proveedor_id      uuid,
  p_imputaciones      jsonb,
  p_excluir_op        uuid DEFAULT NULL,
  p_contar_pendientes boolean DEFAULT true
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_item      jsonb;
  v_monto     numeric;
  v_mov       uuid;
  v_venc      uuid;
  v_comp      uuid;
  v_cc        record;
  v_v         record;
  v_c         record;
  v_pagado    numeric;
  v_saldo     numeric;
  v_reservado numeric;
  v_ops       text;
  v_nombre    text;
BEGIN
  IF p_imputaciones IS NULL OR jsonb_typeof(p_imputaciones) <> 'array' THEN
    RETURN;
  END IF;

  -- La misma deuda por dos caminos
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_imputaciones) e
    WHERE NULLIF(e->>'movimiento_cc_id', '') IS NOT NULL
    GROUP BY e->>'movimiento_cc_id' HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'La misma deuda está elegida dos veces (por el comprobante y por su vencimiento). Dejala tildada una sola vez.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_imputaciones) e
    WHERE NULLIF(e->>'vencimiento_id', '') IS NOT NULL
    GROUP BY e->>'vencimiento_id' HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'El mismo vencimiento está elegido dos veces. Dejalo tildado una sola vez.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_imputaciones) e
    WHERE NULLIF(e->>'comprobante_compra_id', '') IS NOT NULL
      AND NULLIF(e->>'movimiento_cc_id', '') IS NULL
    GROUP BY e->>'comprobante_compra_id' HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'El mismo comprobante está elegido dos veces. Dejalo tildado una sola vez.';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_imputaciones)
  LOOP
    v_monto := round(COALESCE(NULLIF(v_item->>'monto_imputado', '')::numeric, 0), 2);
    IF v_monto = 0 THEN CONTINUE; END IF;
    v_mov  := NULLIF(v_item->>'movimiento_cc_id', '')::uuid;
    v_venc := NULLIF(v_item->>'vencimiento_id', '')::uuid;
    v_comp := NULLIF(v_item->>'comprobante_compra_id', '')::uuid;

    IF v_mov IS NULL AND v_venc IS NULL AND v_comp IS NULL THEN
      RAISE EXCEPTION 'Hay un renglón de % sin comprobante ni vencimiento: no se sabe qué paga.', fmt_moneda(v_monto);
    END IF;

    -- ───────────── DEUDA (monto > 0) ─────────────
    IF v_monto > 0 THEN

      IF v_mov IS NOT NULL THEN
        SELECT * INTO v_cc FROM cuenta_corriente_proveedores WHERE id = v_mov;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Uno de los comprobantes elegidos ya no existe en la cuenta corriente. Volvé a cargar la pantalla.';
        END IF;
        v_nombre := COALESCE(NULLIF(v_cc.numero_comprobante, ''), NULLIF(v_cc.descripcion, ''), 'comprobante');
        IF v_cc.proveedor_id IS DISTINCT FROM p_proveedor_id THEN
          RAISE EXCEPTION 'El comprobante % es de otro proveedor.', v_nombre;
        END IF;
        IF v_cc.monto <= 0 THEN
          RAISE EXCEPTION 'El movimiento % no es una deuda (es un pago o un crédito): no se puede pagar.', v_nombre;
        END IF;

        SELECT COALESCE(sum(monto_imputado), 0) INTO v_pagado
        FROM imputaciones_proveedores WHERE id_movimiento_documento = v_mov;
        v_saldo := round(v_cc.monto - v_pagado, 2);

        v_reservado := 0; v_ops := NULL;
        IF p_contar_pendientes THEN
          SELECT COALESCE(sum(i.monto_imputado), 0), string_agg(DISTINCT o.numero_op, ', ')
          INTO v_reservado, v_ops
          FROM ordenes_pago_imputaciones i
          JOIN ordenes_pago o ON o.id = i.orden_pago_id
          WHERE o.estado = 'pendiente'
            AND i.monto_imputado > 0
            AND (p_excluir_op IS NULL OR o.id <> p_excluir_op)
            AND (i.movimiento_cc_id = v_mov
                 OR (i.movimiento_cc_id IS NULL
                     AND op_movimiento_de(i.vencimiento_id, i.comprobante_compra_id) = v_mov));
        END IF;

        IF v_saldo <= 0.01 THEN
          RAISE EXCEPTION 'El comprobante % ya figura pagado en la cuenta corriente: no se puede volver a pagar.', v_nombre;
        END IF;
        IF v_monto > v_saldo - v_reservado + 0.01 THEN
          IF v_reservado > 0 THEN
            RAISE EXCEPTION 'El comprobante % tiene un saldo de % y ya hay % tomados por la orden de pago pendiente %: quedan % para pagar y se quieren imputar %. Confirmá o eliminá esa orden primero.',
              v_nombre, fmt_moneda(v_saldo), fmt_moneda(v_reservado), v_ops,
              fmt_moneda(GREATEST(0, v_saldo - v_reservado)), fmt_moneda(v_monto);
          END IF;
          RAISE EXCEPTION 'Al comprobante % le quedan % por pagar y se quieren imputar %. No se puede pagar de más.',
            v_nombre, fmt_moneda(v_saldo), fmt_moneda(v_monto);
        END IF;

        -- Saldo propio del comprobante (cuando lo lleva): tampoco se lo puede pasar
        IF v_cc.referencia_tipo = 'comprobante_compra' AND v_cc.referencia_id IS NOT NULL THEN
          SELECT saldo_pendiente, numero_comprobante INTO v_c
          FROM comprobantes_compra WHERE id = v_cc.referencia_id;
          IF FOUND AND COALESCE(v_c.saldo_pendiente, 0) > 0 AND v_monto > v_c.saldo_pendiente + 0.01 THEN
            RAISE EXCEPTION 'El comprobante % tiene % de saldo pendiente y se quieren imputar %. No se puede pagar de más.',
              COALESCE(NULLIF(v_c.numero_comprobante, ''), v_nombre), fmt_moneda(v_c.saldo_pendiente), fmt_moneda(v_monto);
          END IF;
        END IF;
      END IF;

      IF v_venc IS NOT NULL THEN
        SELECT * INTO v_v FROM vencimientos WHERE id = v_venc;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Uno de los vencimientos elegidos ya no existe. Volvé a cargar la pantalla.';
        END IF;
        v_nombre := COALESCE(NULLIF(v_v.concepto, ''), 'vencimiento');
        IF v_v.proveedor_id IS NOT NULL AND v_v.proveedor_id IS DISTINCT FROM p_proveedor_id THEN
          RAISE EXCEPTION 'El vencimiento "%" es de otro proveedor.', v_nombre;
        END IF;
        -- v2: el vencimiento ESTIMADO de una orden de compra todavía no tiene factura: no se paga
        IF COALESCE(v_v.es_estimado, false) AND v_v.referencia_tipo = 'orden_compra' THEN
          RAISE EXCEPTION 'El vencimiento "%" es un ESTIMADO de una orden de compra: todavía no hay factura, no se puede pagar. Cuando se valide la factura aparece el vencimiento real.', v_nombre;
        END IF;
        IF v_v.estado IN ('pagado', 'cancelado') THEN
          RAISE EXCEPTION 'El vencimiento "%" ya figura %: no se puede volver a pagar.', v_nombre, v_v.estado;
        END IF;

        v_reservado := 0; v_ops := NULL;
        IF p_contar_pendientes THEN
          SELECT COALESCE(sum(i.monto_imputado), 0), string_agg(DISTINCT o.numero_op, ', ')
          INTO v_reservado, v_ops
          FROM ordenes_pago_imputaciones i
          JOIN ordenes_pago o ON o.id = i.orden_pago_id
          WHERE o.estado = 'pendiente'
            AND i.monto_imputado > 0
            AND i.vencimiento_id = v_venc
            AND (p_excluir_op IS NULL OR o.id <> p_excluir_op);
        END IF;

        -- Vencimiento sin comprobante: NO hay tope de importe. Se puede pagar más
        -- (o menos) que lo que dice el vencimiento: la diferencia queda como
        -- ajuste o entrega a cuenta del proveedor (decisión de Juan, 16/11/2026).
        -- Lo único que no se puede es tenerlo en dos órdenes a la vez.
        IF v_reservado > 0 THEN
          RAISE EXCEPTION 'El vencimiento "%" ya está en la orden de pago pendiente %. Confirmá o eliminá esa orden primero.', v_nombre, v_ops;
        END IF;
      END IF;

      -- Deuda directa a un comprobante que no tiene movimiento de CC
      IF v_mov IS NULL AND v_venc IS NULL AND v_comp IS NOT NULL THEN
        SELECT proveedor_id, saldo_pendiente, numero_comprobante INTO v_c
        FROM comprobantes_compra WHERE id = v_comp;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Uno de los comprobantes elegidos ya no existe. Volvé a cargar la pantalla.';
        END IF;
        v_nombre := COALESCE(NULLIF(v_c.numero_comprobante, ''), 'comprobante');
        IF v_c.proveedor_id IS DISTINCT FROM p_proveedor_id THEN
          RAISE EXCEPTION 'El comprobante % es de otro proveedor.', v_nombre;
        END IF;
        v_reservado := 0;
        IF p_contar_pendientes THEN
          SELECT COALESCE(sum(i.monto_imputado), 0) INTO v_reservado
          FROM ordenes_pago_imputaciones i
          JOIN ordenes_pago o ON o.id = i.orden_pago_id
          WHERE o.estado = 'pendiente' AND i.monto_imputado > 0
            AND i.comprobante_compra_id = v_comp
            AND (p_excluir_op IS NULL OR o.id <> p_excluir_op);
        END IF;
        IF v_monto > COALESCE(v_c.saldo_pendiente, 0) - v_reservado + 0.01 THEN
          RAISE EXCEPTION 'Al comprobante % le quedan % por pagar y se quieren imputar %. No se puede pagar de más.',
            v_nombre, fmt_moneda(GREATEST(0, COALESCE(v_c.saldo_pendiente, 0) - v_reservado)), fmt_moneda(v_monto);
        END IF;
      END IF;

    -- ───────────── CRÉDITO (monto < 0): NC / Reversa que se descuenta ─────────────
    ELSE
      IF v_comp IS NULL AND v_mov IS NOT NULL THEN
        SELECT referencia_id INTO v_comp FROM cuenta_corriente_proveedores
        WHERE id = v_mov AND referencia_tipo = 'comprobante_compra';
      END IF;
      IF v_comp IS NOT NULL THEN
        SELECT proveedor_id, saldo_pendiente, numero_comprobante, tipo_comprobante INTO v_c
        FROM comprobantes_compra WHERE id = v_comp;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Uno de los créditos elegidos ya no existe. Volvé a cargar la pantalla.';
        END IF;
        v_nombre := COALESCE(v_c.tipo_comprobante || ' ', '') || COALESCE(NULLIF(v_c.numero_comprobante, ''), 'crédito');
        IF v_c.proveedor_id IS DISTINCT FROM p_proveedor_id THEN
          RAISE EXCEPTION 'El crédito % es de otro proveedor.', v_nombre;
        END IF;
        v_saldo := GREATEST(0, -COALESCE(v_c.saldo_pendiente, 0));   -- disponible, en positivo
        v_reservado := 0; v_ops := NULL;
        IF p_contar_pendientes THEN
          SELECT COALESCE(sum(abs(i.monto_imputado)), 0), string_agg(DISTINCT o.numero_op, ', ')
          INTO v_reservado, v_ops
          FROM ordenes_pago_imputaciones i
          JOIN ordenes_pago o ON o.id = i.orden_pago_id
          WHERE o.estado = 'pendiente' AND i.monto_imputado < 0
            AND i.comprobante_compra_id = v_comp
            AND (p_excluir_op IS NULL OR o.id <> p_excluir_op);
        END IF;
        IF abs(v_monto) > v_saldo - v_reservado + 0.01 THEN
          IF v_reservado > 0 THEN
            RAISE EXCEPTION 'El crédito % tiene % disponibles y % ya están tomados por la orden de pago pendiente %: se quieren usar %.',
              v_nombre, fmt_moneda(v_saldo), fmt_moneda(v_reservado), v_ops, fmt_moneda(abs(v_monto));
          END IF;
          RAISE EXCEPTION 'El crédito % tiene % disponibles y se quieren usar %.',
            v_nombre, fmt_moneda(v_saldo), fmt_moneda(abs(v_monto));
        END IF;
      END IF;
    END IF;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.op_validar_imputaciones(uuid, jsonb, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.op_validar_imputaciones(uuid, jsonb, uuid, boolean) TO service_role;

-- ═══ op_crear v3 ═══
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
  v_reserva     text;   -- v3
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
      IF NULLIF(btrim(COALESCE(v_m->>'cheque_numero', '')), '') IS NULL THEN
        RAISE EXCEPTION 'Al cheque propio de % le falta el número.', fmt_moneda(COALESCE(NULLIF(v_m->>'monto', '')::numeric, 0));
      END IF;
      IF NULLIF(v_m->>'cheque_fecha_vencimiento', '') IS NULL THEN
        RAISE EXCEPTION 'Al cheque propio N° % le falta la fecha de pago.', v_m->>'cheque_numero';
      END IF;
      IF NULLIF(v_m->>'cuenta_origen_id', '') IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM cuentas_bancarias WHERE id = (v_m->>'cuenta_origen_id')::uuid) THEN
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

REVOKE ALL ON FUNCTION public.op_crear(jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.op_crear(jsonb, text) TO service_role;

-- ═══ op_confirmar v10 ═══
CREATE OR REPLACE FUNCTION public.op_confirmar(p_op_id uuid, p_usuario_id uuid, p_caja_id uuid DEFAULT NULL::uuid, p_cuenta_banco_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_op        ordenes_pago%ROWTYPE;
  v_det       record;
  v_imp       record;
  v_caja      uuid := p_caja_id;
  v_caja_linea  uuid;
  v_banco_linea uuid;
  v_pago_mov  uuid;
  v_cheque    cheques%ROWTYPE;
  v_cheque_id uuid;
  v_kardex    int := 0;
  v_hoy_ar    date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_cc_ids    uuid[] := '{}';
  v_calc      jsonb;
  v_ret_calc  numeric;
  v_num_cert  text;
  v_cert_id   uuid;
  v_comp_id   uuid;
  v_saldo     numeric;
BEGIN
  SELECT * INTO v_op FROM ordenes_pago WHERE id = p_op_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'op_confirmar: orden de pago % no encontrada', p_op_id;
  END IF;
  IF v_op.estado = 'pagada' THEN
    RETURN jsonb_build_object('success', true, 'ya_confirmada', true);
  END IF;
  IF v_op.estado = 'anulada' THEN
    RAISE EXCEPTION 'op_confirmar: la OP está anulada';
  END IF;
  -- v6 (E-73): solo se confirma una orden PENDIENTE (antes una cancelada pasaba)
  IF v_op.estado IS DISTINCT FROM 'pendiente' THEN
    RAISE EXCEPTION 'La orden de pago % está %: solo se puede confirmar una orden pendiente.', v_op.numero_op, COALESCE(v_op.estado, 'sin estado');
  END IF;

  -- ── v6 (E-52 / E-54) ──────────────────────────────────────────────────────
  -- Una confirmación por proveedor a la vez (misma llave que op_crear): dos OP
  -- sobre la misma factura no pueden validar el saldo al mismo tiempo.
  PERFORM pg_advisory_xact_lock(hashtext('op_proveedor:' || v_op.proveedor_id::text));

  -- E-52: una deuda imputada solo por su vencimiento se completa con el
  -- movimiento de CC del comprobante (OP creadas antes de op_crear), así el
  -- paso 3 baja la factura en la cuenta corriente. Sin comprobante detrás no
  -- cambia nada: se paga contra el vencimiento, igual que antes.
  UPDATE ordenes_pago_imputaciones
  SET movimiento_cc_id = op_movimiento_de(vencimiento_id, comprobante_compra_id)
  WHERE orden_pago_id = p_op_id
    AND monto_imputado > 0
    AND movimiento_cc_id IS NULL
    AND op_movimiento_de(vencimiento_id, comprobante_compra_id) IS NOT NULL;
  -- ── fin v6 ────────────────────────────────────────────────────────────────

  -- v5: solo exige banco global si alguna transferencia NO trae su origen propio
  IF EXISTS (
       SELECT 1 FROM ordenes_pago_detalle d
       WHERE d.orden_pago_id = p_op_id AND d.medio = 'transferencia'
         AND NOT (d.cuenta_origen_tipo = 'BANCO' AND d.cuenta_origen_id IS NOT NULL)
     )
     AND p_cuenta_banco_id IS NULL THEN
    RAISE EXCEPTION 'op_confirmar: la OP incluye transferencias sin banco de origen — indicá desde qué cuenta bancaria salen (p_cuenta_banco_id)';
  END IF;
  IF v_caja IS NULL THEN
    SELECT id INTO v_caja FROM cajas_financieras WHERE nombre = 'Caja Grande' AND activo LIMIT 1;
  END IF;

  IF COALESCE(v_op.base_ganancias, 0) > 0 AND NOT COALESCE(v_op.ganancias_ajuste_manual, false) THEN
    v_calc := ganancias_calcular(v_op.proveedor_id, v_op.base_ganancias, v_op.fecha, p_op_id);
    v_ret_calc := (v_calc->>'retencion')::numeric;
    IF abs(v_ret_calc - COALESCE(v_op.retencion_ganancias, 0)) > 0.01 THEN
      RAISE EXCEPTION 'op_confirmar: la retención calculada cambió desde que se creó la OP (era %, ahora corresponde % por el acumulado del mes). Anulá y recreá la OP, o ajustá manualmente con motivo.',
        COALESCE(v_op.retencion_ganancias, 0), v_ret_calc;
    END IF;
  ELSIF COALESCE(v_op.retencion_ganancias, 0) > 0 THEN
    v_calc := ganancias_calcular(v_op.proveedor_id, COALESCE(v_op.base_ganancias, 0), v_op.fecha, p_op_id);
  END IF;

  -- ── 1. CC proveedor: pago + retenciones (guard) ──
  IF NOT EXISTS (
    SELECT 1 FROM cuenta_corriente_proveedores
    WHERE referencia_tipo = 'orden_pago' AND referencia_id = p_op_id AND tipo_movimiento = 'pago'
  ) THEN
    -- ── v6 (E-54): lo imputado no puede superar el saldo real de cada
    --    comprobante / vencimiento / crédito. Corta con un mensaje claro en
    --    vez de absorber la diferencia (el GREATEST(0, …) de más abajo queda
    --    solo para centavos de redondeo). ──
    PERFORM op_validar_imputaciones(
      v_op.proveedor_id,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'movimiento_cc_id', i.movimiento_cc_id,
                'vencimiento_id', i.vencimiento_id,
                'comprobante_compra_id', i.comprobante_compra_id,
                'monto_imputado', i.monto_imputado)), '[]'::jsonb)
       FROM ordenes_pago_imputaciones i WHERE i.orden_pago_id = p_op_id),
      p_op_id,
      false
    );

    INSERT INTO cuenta_corriente_proveedores (
      proveedor_id, fecha, tipo_movimiento, monto, descripcion,
      referencia_id, referencia_tipo, numero_comprobante, tipo_comprobante
    ) VALUES (
      v_op.proveedor_id, now(), 'pago', -(v_op.neto_a_pagar),
      'Pago ' || v_op.numero_op ||
        CASE WHEN COALESCE(v_op.total_creditos, 0) > 0
             THEN ' (créditos descontados ' || v_op.total_creditos || ')'
             ELSE '' END,
      p_op_id, 'orden_pago', v_op.numero_op, 'OP'
    ) RETURNING id INTO v_pago_mov;

    IF COALESCE(v_op.retencion_ganancias, 0) > 0 THEN
      INSERT INTO cuenta_corriente_proveedores (proveedor_id, fecha, tipo_movimiento, monto, descripcion, referencia_id, referencia_tipo)
      VALUES (v_op.proveedor_id, now(), 'retencion', -(v_op.retencion_ganancias), 'Ret. Ganancias ' || v_op.numero_op, p_op_id, 'orden_pago');
    END IF;
    IF COALESCE(v_op.retencion_iibb, 0) > 0 THEN
      INSERT INTO cuenta_corriente_proveedores (proveedor_id, fecha, tipo_movimiento, monto, descripcion, referencia_id, referencia_tipo)
      VALUES (v_op.proveedor_id, now(), 'retencion', -(v_op.retencion_iibb), 'Ret. IIBB ' || v_op.numero_op, p_op_id, 'orden_pago');
    END IF;
    IF COALESCE(v_op.retencion_iva, 0) > 0 THEN
      INSERT INTO cuenta_corriente_proveedores (proveedor_id, fecha, tipo_movimiento, monto, descripcion, referencia_id, referencia_tipo)
      VALUES (v_op.proveedor_id, now(), 'retencion', -(v_op.retencion_iva), 'Ret. IVA ' || v_op.numero_op, p_op_id, 'orden_pago');
    END IF;
    IF COALESCE(v_op.retencion_suss, 0) > 0 THEN
      INSERT INTO cuenta_corriente_proveedores (proveedor_id, fecha, tipo_movimiento, monto, descripcion, referencia_id, referencia_tipo)
      VALUES (v_op.proveedor_id, now(), 'retencion', -(v_op.retencion_suss), 'Ret. SUSS ' || v_op.numero_op, p_op_id, 'orden_pago');
    END IF;

    -- ── 1b. Consumir/aplicar saldos de comprobantes (créditos y facturas) ──
    FOR v_imp IN
      SELECT * FROM ordenes_pago_imputaciones WHERE orden_pago_id = p_op_id
    LOOP
      v_comp_id := v_imp.comprobante_compra_id;
      IF v_comp_id IS NULL AND v_imp.movimiento_cc_id IS NOT NULL THEN
        SELECT referencia_id INTO v_comp_id FROM cuenta_corriente_proveedores
        WHERE id = v_imp.movimiento_cc_id AND referencia_tipo = 'comprobante_compra';
      END IF;
      IF v_comp_id IS NULL AND v_imp.vencimiento_id IS NOT NULL THEN
        SELECT cc.referencia_id INTO v_comp_id
        FROM vencimientos v
        JOIN cuenta_corriente_proveedores cc ON cc.id = v.referencia_id AND v.referencia_tipo = 'cuenta_corriente'
        WHERE v.id = v_imp.vencimiento_id AND cc.referencia_tipo = 'comprobante_compra';
      END IF;
      IF v_comp_id IS NULL THEN CONTINUE; END IF;

      IF v_imp.monto_imputado < 0 THEN
        -- Crédito (NC/Reversa): saldo negativo sube hacia 0
        SELECT saldo_pendiente INTO v_saldo FROM comprobantes_compra WHERE id = v_comp_id FOR UPDATE;
        IF COALESCE(v_saldo, 0) > -abs(v_imp.monto_imputado) + 0.01 THEN
          RAISE EXCEPTION 'op_confirmar: el crédito % no tiene saldo suficiente (saldo %, se intenta usar %)',
            v_comp_id, COALESCE(v_saldo, 0), abs(v_imp.monto_imputado);
        END IF;
        UPDATE comprobantes_compra
        SET saldo_pendiente = LEAST(0, saldo_pendiente + abs(v_imp.monto_imputado)),
            estado_pago = CASE WHEN saldo_pendiente + abs(v_imp.monto_imputado) >= -0.01 THEN 'pagado' ELSE 'parcial' END
        WHERE id = v_comp_id;
      ELSE
        -- Factura/Adquisición: baja el saldo pendiente
        UPDATE comprobantes_compra
        SET saldo_pendiente = GREATEST(0, saldo_pendiente - v_imp.monto_imputado),
            estado_pago = CASE WHEN saldo_pendiente - v_imp.monto_imputado <= 0.01 THEN 'pagado' ELSE 'parcial' END
        WHERE id = v_comp_id AND saldo_pendiente > 0;
      END IF;
    END LOOP;
  ELSE
    SELECT id INTO v_pago_mov FROM cuenta_corriente_proveedores
    WHERE referencia_tipo = 'orden_pago' AND referencia_id = p_op_id AND tipo_movimiento = 'pago' LIMIT 1;
  END IF;

  -- ── 2. Certificado de retención (guard) ──
  IF COALESCE(v_op.retencion_ganancias, 0) > 0 AND NOT EXISTS (
    SELECT 1 FROM retenciones_emitidas WHERE orden_pago_id = p_op_id AND estado = 'emitida'
  ) THEN
    v_num_cert := retencion_siguiente_numero();
    INSERT INTO retenciones_emitidas (
      orden_pago_id, proveedor_id, regimen_id, fecha,
      base_calculo, acumulado_mes, alicuota, monto,
      numero_certificado, ajuste_manual, motivo_ajuste, creado_por
    ) VALUES (
      p_op_id, v_op.proveedor_id,
      NULLIF(v_calc->>'regimen_id', '')::uuid,
      v_op.fecha,   -- v9 (E-57): el certificado lleva la fecha de la orden de pago (antes: el día de la confirmación)
      COALESCE(v_op.base_ganancias, 0),
      NULLIF(v_calc->>'acumulado_total_mes', '')::numeric,
      COALESCE(NULLIF(v_calc->>'alicuota', '')::numeric, 0),
      v_op.retencion_ganancias,
      v_num_cert,
      COALESCE(v_op.ganancias_ajuste_manual, false),
      v_op.ganancias_motivo,
      p_usuario_id
    ) RETURNING id INTO v_cert_id;
  END IF;

  -- ── 3. Imputaciones (solo débitos marcan vencimientos) ──
  FOR v_imp IN
    SELECT * FROM ordenes_pago_imputaciones WHERE orden_pago_id = p_op_id AND monto_imputado > 0
  LOOP
    IF v_imp.movimiento_cc_id IS NOT NULL AND v_pago_mov IS NOT NULL THEN
      INSERT INTO imputaciones_proveedores (id_movimiento_pago, id_movimiento_documento, monto_imputado, fecha_imputacion)
      SELECT v_pago_mov, v_imp.movimiento_cc_id, v_imp.monto_imputado, now()
      WHERE NOT EXISTS (
        SELECT 1 FROM imputaciones_proveedores
        WHERE id_movimiento_pago = v_pago_mov AND id_movimiento_documento = v_imp.movimiento_cc_id
      );
      v_cc_ids := array_append(v_cc_ids, v_imp.movimiento_cc_id);
    END IF;
    -- v7 (E-55): el vencimiento SIN comprobante queda pagado solo si se pagó entero;
    -- si se pagó una parte, queda pendiente por lo que falta.
    IF v_imp.vencimiento_id IS NOT NULL AND v_imp.movimiento_cc_id IS NULL THEN
      PERFORM op_vencimiento_aplicar_pago(v_imp.vencimiento_id, v_imp.monto_imputado, p_op_id);
    END IF;
  END LOOP;
  -- v7 (E-55): vencimientos de comprobantes — pagados solo si al comprobante no le
  -- queda saldo en la cuenta corriente; si no, quedan pendientes por ese saldo.
  IF array_length(v_cc_ids, 1) > 0 THEN
    PERFORM op_vencimientos_sincronizar_movimiento(m, p_op_id, true) FROM unnest(v_cc_ids) AS m;
  END IF;

  -- ── 4. Medios de pago → kardex: UNA LÍNEA POR MOVIMIENTO, cada una con su
  --       origen (banco/caja del renglón; fallback a los parámetros) ──
  IF NOT EXISTS (
    SELECT 1 FROM kardex_contable WHERE referencia_tipo = 'orden_pago' AND referencia_id = p_op_id
  ) THEN
    FOR v_det IN
      SELECT * FROM ordenes_pago_detalle WHERE orden_pago_id = p_op_id
    LOOP
      IF COALESCE(v_det.monto, 0) <= 0 THEN CONTINUE; END IF;

      IF v_det.medio = 'cheque' AND v_det.cheque_id IS NOT NULL THEN
        SELECT * INTO v_cheque FROM cheques WHERE id = v_det.cheque_id FOR UPDATE;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'op_confirmar: cheque % no encontrado', v_det.cheque_id;
        END IF;
        IF v_cheque.estado <> 'EN_CARTERA' THEN
          RAISE EXCEPTION 'op_confirmar: el cheque % está % (se requiere EN_CARTERA)', v_cheque.numero, v_cheque.estado;
        END IF;
        UPDATE cheques SET estado = 'ENTREGADO_A_PROVEEDOR', proveedor_destino_id = v_op.proveedor_id, orden_pago_id = p_op_id
        WHERE id = v_det.cheque_id;

        PERFORM kardex_registrar(
          p_tipo_movimiento => 'PAGO_PROVEEDOR',
          p_concepto        => 'Pago ' || v_op.numero_op || ' — cheque tercero ' || COALESCE(v_cheque.numero, ''),
          p_monto           => v_det.monto,
          p_color           => v_cheque.color::text,
          p_origen_tipo     => 'EN_CARTERA',
          p_destino_tipo    => 'PROVEEDOR',
          p_destino_id      => v_op.proveedor_id,
          p_metodo          => 'CHEQUE_TERCERO',
          p_referencia_tipo => 'orden_pago',
          p_referencia_id   => p_op_id,
          p_cheque_id       => v_det.cheque_id,
          p_usuario_id      => p_usuario_id,
          p_verificado      => true
        );
        v_kardex := v_kardex + 1;

      ELSIF v_det.medio = 'cheque' THEN
        -- v10 (E-62): el cheque propio / e-cheq queda atado a la cuenta bancaria de la que sale
        -- (cuentas_bancarias, no texto libre) y marcado como e-cheq si corresponde. El banco baja
        -- recién cuando el cheque se debita (cheque_propio_debitar).
        INSERT INTO cheques (tipo, estado, banco, numero, fecha_emision, fecha_vencimiento, monto, color, proveedor_destino_id, orden_pago_id,
                             cuenta_banco_id, es_echeq)
        VALUES ('PROPIO', 'ENTREGADO_A_PROVEEDOR',
                COALESCE((SELECT cb.nombre FROM cuentas_bancarias cb
                           WHERE cb.id = v_det.cuenta_origen_id AND v_det.cuenta_origen_tipo = 'BANCO'), v_det.cheque_banco, 'S/D'),
                COALESCE(v_det.cheque_numero, 'S/N'),
                v_hoy_ar, COALESCE(v_det.cheque_fecha_vencimiento, v_hoy_ar + 30), v_det.monto, 'BLANCO',
                v_op.proveedor_id, p_op_id,
                CASE WHEN v_det.cuenta_origen_tipo = 'BANCO' THEN v_det.cuenta_origen_id END,
                COALESCE(v_det.es_echeq, false))
        RETURNING id INTO v_cheque_id;

        PERFORM kardex_registrar(
          p_tipo_movimiento => 'PAGO_PROVEEDOR',
          p_concepto        => 'Pago ' || v_op.numero_op || ' — cheque propio ' || COALESCE(v_det.cheque_numero, ''),
          p_monto           => v_det.monto,
          p_destino_tipo    => 'PROVEEDOR',
          p_destino_id      => v_op.proveedor_id,
          p_metodo          => 'CHEQUE_PROPIO',
          p_referencia_tipo => 'orden_pago',
          p_referencia_id   => p_op_id,
          p_cheque_id       => v_cheque_id,
          p_usuario_id      => p_usuario_id,
          p_verificado      => true
        );
        v_kardex := v_kardex + 1;

      ELSIF v_det.medio = 'efectivo' THEN
        v_caja_linea := COALESCE(
          CASE WHEN v_det.cuenta_origen_tipo = 'CAJA' THEN v_det.cuenta_origen_id END,
          v_caja
        );
        IF v_caja_linea IS NULL THEN
          RAISE EXCEPTION 'op_confirmar: no hay caja de efectivo (renglón sin origen, Caja Grande inactiva y sin p_caja_id)';
        END IF;
        PERFORM kardex_registrar(
          p_tipo_movimiento => 'PAGO_PROVEEDOR',
          p_concepto        => 'Pago ' || v_op.numero_op || ' — efectivo' || COALESCE(' ' || v_det.observaciones, ''),
          p_monto           => v_det.monto,
          p_origen_tipo     => 'CAJA',
          p_origen_id       => v_caja_linea,
          p_destino_tipo    => 'PROVEEDOR',
          p_destino_id      => v_op.proveedor_id,
          p_metodo          => 'EFECTIVO',
          p_referencia_tipo => 'orden_pago',
          p_referencia_id   => p_op_id,
          p_usuario_id      => p_usuario_id,
          p_verificado      => true
        );
        v_kardex := v_kardex + 1;

      ELSIF v_det.medio = 'transferencia' THEN
        v_banco_linea := COALESCE(
          CASE WHEN v_det.cuenta_origen_tipo = 'BANCO' THEN v_det.cuenta_origen_id END,
          p_cuenta_banco_id
        );
        IF v_banco_linea IS NULL THEN
          RAISE EXCEPTION 'op_confirmar: transferencia sin banco de origen';
        END IF;
        PERFORM kardex_registrar(
          p_tipo_movimiento => 'PAGO_PROVEEDOR',
          p_concepto        => 'Pago ' || v_op.numero_op || ' — transferencia' ||
                               COALESCE(' ' || v_det.numero_transferencia, '') ||
                               COALESCE(' ' || v_det.observaciones, ''),
          p_monto           => v_det.monto,
          p_origen_tipo     => 'BANCO',
          p_origen_id       => v_banco_linea,
          p_destino_tipo    => 'PROVEEDOR',
          p_destino_id      => v_op.proveedor_id,
          p_metodo          => 'TRANSFERENCIA',
          p_referencia_tipo => 'orden_pago',
          p_referencia_id   => p_op_id,
          p_usuario_id      => p_usuario_id,
          p_verificado      => true
        );
        v_kardex := v_kardex + 1;
      END IF;
    END LOOP;
  END IF;

  -- v8 (E-56): los créditos (NC / Reversa) descontados en esta orden quedan asentados en
  -- la cuenta corriente contra el pago (antes solo bajaba el saldo del comprobante y en la
  -- cuenta corriente la NC figuraba pendiente para siempre); y el saldo de cada comprobante
  -- tocado se vuelve a leer de la cuenta corriente: una sola fuente.
  PERFORM op_asentar_creditos(p_op_id, v_pago_mov);
  PERFORM op_sincronizar_saldos_comprobantes(p_op_id);

  UPDATE ordenes_pago SET estado = 'pagada', updated_at = now() WHERE id = p_op_id;

  RETURN jsonb_build_object(
    'success', true, 'ya_confirmada', false,
    'cc_pago_id', v_pago_mov, 'kardex_lineas', v_kardex,
    'certificado_id', v_cert_id, 'numero_certificado', v_num_cert
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.op_confirmar(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.op_confirmar(uuid, uuid, uuid, uuid) TO service_role;

-- ═══ E-62: debitar un cheque propio (el banco lo pagó) ═══
-- Cambia el cheque a COBRADO con su fecha de débito y BAJA el saldo de la cuenta bancaria
-- (una línea de kardex, tipo DEBITO_CHEQUE_PROPIO). Una sola vez: si ya está debitado,
-- devuelve ya_debitado = true y no toca nada.
-- p_cuenta_banco_id: solo hace falta si el cheque no tiene cuenta (cheques cargados antes).
-- Sin cuenta, el cheque se marca debitado igual que antes y se avisa que el saldo no se movió.
CREATE OR REPLACE FUNCTION public.cheque_propio_debitar(
  p_cheque_id       uuid,
  p_fecha           date DEFAULT NULL,
  p_cuenta_banco_id uuid DEFAULT NULL,
  p_usuario_id      uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ch     cheques%ROWTYPE;
  v_cuenta uuid;
  v_k      uuid;
BEGIN
  SELECT * INTO v_ch FROM cheques WHERE id = p_cheque_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El cheque no existe.';
  END IF;
  IF v_ch.tipo::text <> 'PROPIO' THEN
    RAISE EXCEPTION 'Solo se debita un cheque propio (este es de terceros).';
  END IF;
  IF v_ch.estado::text = 'COBRADO' THEN
    RETURN jsonb_build_object('success', true, 'ya_debitado', true);
  END IF;
  IF v_ch.estado::text <> 'ENTREGADO_A_PROVEEDOR' THEN
    RAISE EXCEPTION 'El cheque % está %: solo se debita un cheque propio entregado al proveedor.', v_ch.numero, v_ch.estado;
  END IF;

  v_cuenta := COALESCE(v_ch.cuenta_banco_id, p_cuenta_banco_id);
  IF v_cuenta IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cuentas_bancarias WHERE id = v_cuenta) THEN
    RAISE EXCEPTION 'La cuenta bancaria indicada no existe.';
  END IF;

  UPDATE cheques
     SET estado = 'COBRADO', fecha_debito = COALESCE(p_fecha, public.hoy_ar()),
         cuenta_banco_id = COALESCE(cuenta_banco_id, v_cuenta)
   WHERE id = p_cheque_id;

  IF v_cuenta IS NOT NULL THEN
    v_k := kardex_registrar(
      p_tipo_movimiento => 'DEBITO_CHEQUE_PROPIO',
      p_concepto        => 'Débito ' || CASE WHEN COALESCE(v_ch.es_echeq, false) THEN 'e-cheq' ELSE 'cheque propio' END || ' N° ' || COALESCE(v_ch.numero, ''),
      p_monto           => v_ch.monto,
      p_color           => v_ch.color::text,
      p_origen_tipo     => 'BANCO',
      p_origen_id       => v_cuenta,
      p_destino_tipo    => 'PROVEEDOR',
      p_destino_id      => v_ch.proveedor_destino_id,
      p_metodo          => 'CHEQUE_PROPIO',
      p_referencia_tipo => 'cheque',
      p_referencia_id   => p_cheque_id,
      p_cheque_id       => p_cheque_id,
      p_usuario_id      => p_usuario_id,
      p_verificado      => true
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'ya_debitado', false,
                            'bajo_el_banco', v_cuenta IS NOT NULL, 'cuenta_banco_id', v_cuenta, 'kardex_id', v_k);
END;
$function$;

REVOKE ALL ON FUNCTION public.cheque_propio_debitar(uuid, date, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cheque_propio_debitar(uuid, date, uuid, uuid) TO service_role;
