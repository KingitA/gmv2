-- ═════════════════════════════════════════════════════════════════════════════
-- Pago parcial: el vencimiento guarda lo que falta y no se marca pagado entero
-- Prueba integral de ENTRADA, Tanda 1-D (17/11/2026): E-55.
--
-- Antes: cualquier pago contra un vencimiento (aunque fuera una parte) lo dejaba
-- "pagado" completo.
--
-- Ahora:
--   · Pago TOTAL  → el vencimiento queda pagado, como siempre.
--   · Pago PARCIAL → el vencimiento sigue pendiente y su importe pasa a ser LO QUE
--     FALTA PAGAR. El importe original queda guardado en monto_original y lo ya
--     pagado en monto_pagado. Cuando se termina de pagar, vuelve a mostrar el
--     importe original y queda pagado.
--   Así el calendario, los totales y las proyecciones muestran lo que realmente
--   falta SIN cambiar ninguna pantalla: leen "monto" como hasta hoy.
--   · Vencimiento que nació de un comprobante: sigue el saldo del comprobante en la
--     cuenta corriente (queda pagado cuando ese saldo llega a 0).
--   · Anular la orden devuelve todo: el importe y el estado.
--
-- Los vencimientos existentes NO se tocan: monto_original queda vacío y
-- monto_pagado en 0 hasta que alguno reciba un pago parcial por orden de pago.
-- "Marcar pagado" desde el calendario sigue igual (no pasa por acá).
--
-- Piezas: 2 columnas en vencimientos, 3 funciones de apoyo, op_confirmar v7
-- (cuerpo EXACTO de la v6 con el paso 3 cambiado, marcado "v7") y op_anular v4
-- (cuerpo EXACTO de la v3 de 20260806 con dos agregados marcados "v4").
-- Generado por script desde esas versiones. REQUIERE 20261116p y 20261116q.
-- Seguro de re-ejecutar. No toca datos.
-- ═════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF to_regprocedure('public.op_validar_imputaciones(uuid, jsonb, uuid, boolean)') IS NULL
     OR to_regprocedure('public.op_movimiento_de(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'Faltan las funciones de 20261116p_op_crear.sql. No se cambió nada.';
  END IF;
END $$;

ALTER TABLE public.vencimientos
  ADD COLUMN IF NOT EXISTS monto_original numeric(20,2),
  ADD COLUMN IF NOT EXISTS monto_pagado numeric(20,2) NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.vencimientos.monto_original IS
  'Importe completo del vencimiento cuando recibió un pago parcial por orden de pago (ahí "monto" pasa a ser lo que falta). NULL = nunca tuvo pago parcial: el importe es "monto".';
COMMENT ON COLUMN public.vencimientos.monto_pagado IS
  'Lo ya pagado de este vencimiento por órdenes de pago confirmadas.';

-- ═══ Vencimiento SIN comprobante: aplicar un pago ═══
CREATE OR REPLACE FUNCTION public.op_vencimiento_aplicar_pago(p_vencimiento_id uuid, p_monto numeric, p_op_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v vencimientos%ROWTYPE;
BEGIN
  SELECT * INTO v FROM vencimientos WHERE id = p_vencimiento_id FOR UPDATE;
  IF NOT FOUND OR v.estado <> 'pendiente' THEN RETURN; END IF;

  IF p_monto >= COALESCE(v.monto, 0) - 0.01 THEN
    -- Se pagó lo que faltaba (o más): pagado, y vuelve a mostrar el importe completo
    UPDATE vencimientos
       SET estado = 'pagado', orden_pago_id = p_op_id,
           monto = COALESCE(monto_original, monto),
           monto_pagado = COALESCE(monto_pagado, 0) + p_monto,
           updated_at = now()
     WHERE id = p_vencimiento_id;
  ELSE
    -- Pago parcial: sigue pendiente por lo que falta
    UPDATE vencimientos
       SET monto_original = COALESCE(monto_original, monto),
           monto = round(monto - p_monto, 2),
           monto_pagado = COALESCE(monto_pagado, 0) + p_monto,
           updated_at = now()
     WHERE id = p_vencimiento_id;
  END IF;
END;
$function$;

-- ═══ Vencimiento SIN comprobante: devolver un pago (al anular la orden) ═══
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
         monto = CASE WHEN monto_original IS NOT NULL THEN round(monto_original - v_pagado, 2) ELSE monto END,
         monto_original = CASE WHEN v_pagado <= 0.01 THEN NULL ELSE monto_original END,
         updated_at = now()
   WHERE id = p_vencimiento_id;
END;
$function$;

-- ═══ Vencimientos de un comprobante: seguir el saldo de la cuenta corriente ═══
-- p_marcar_pagado = true (al confirmar): saldo 0 ⇒ pagado; si no, pendiente por el saldo.
-- p_marcar_pagado = false (al anular): solo actualiza el importe pendiente.
CREATE OR REPLACE FUNCTION public.op_vencimientos_sincronizar_movimiento(p_movimiento_id uuid, p_op_id uuid, p_marcar_pagado boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cc    record;
  v_saldo numeric;
  v       record;
  v_total numeric;
BEGIN
  SELECT id, monto, referencia_tipo, referencia_id INTO v_cc FROM cuenta_corriente_proveedores WHERE id = p_movimiento_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT round(v_cc.monto - COALESCE(sum(monto_imputado), 0), 2) INTO v_saldo
  FROM imputaciones_proveedores WHERE id_movimiento_documento = p_movimiento_id;

  FOR v IN
    SELECT ve.* FROM vencimientos ve
     WHERE ve.estado = 'pendiente'
       AND ( (ve.referencia_tipo = 'cuenta_corriente' AND ve.referencia_id = p_movimiento_id)
          OR (ve.referencia_tipo = 'comprobante_compra' AND v_cc.referencia_tipo = 'comprobante_compra' AND ve.referencia_id = v_cc.referencia_id)
          OR ve.id IN (SELECT i.vencimiento_id FROM ordenes_pago_imputaciones i
                        WHERE i.orden_pago_id = p_op_id AND i.movimiento_cc_id = p_movimiento_id AND i.vencimiento_id IS NOT NULL) )
       FOR UPDATE OF ve
  LOOP
    v_total := COALESCE(v.monto_original, v.monto);
    IF v_saldo <= 0.01 THEN
      IF p_marcar_pagado THEN
        UPDATE vencimientos
           SET estado = 'pagado', orden_pago_id = p_op_id, monto = v_total,
               monto_pagado = v_total, updated_at = now()
         WHERE id = v.id;
      END IF;
    ELSIF v_saldo >= v_total - 0.01 THEN
      -- Al comprobante no se le pagó nada (o se anuló todo): importe completo, sin rastro de parcial
      UPDATE vencimientos
         SET monto = v_total, monto_original = NULL, monto_pagado = 0, updated_at = now()
       WHERE id = v.id AND (monto_original IS NOT NULL OR COALESCE(monto_pagado, 0) <> 0);
    ELSE
      -- Pago parcial del comprobante: el vencimiento queda por el saldo
      UPDATE vencimientos
         SET monto_original = v_total, monto = v_saldo, monto_pagado = round(v_total - v_saldo, 2), updated_at = now()
       WHERE id = v.id;
    END IF;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.op_vencimiento_aplicar_pago(uuid, numeric, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.op_vencimiento_aplicar_pago(uuid, numeric, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.op_vencimiento_revertir_pago(uuid, numeric, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.op_vencimiento_revertir_pago(uuid, numeric, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.op_vencimientos_sincronizar_movimiento(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.op_vencimientos_sincronizar_movimiento(uuid, uuid, boolean) TO service_role;

-- ═══ op_confirmar v7 ═══
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
      v_hoy_ar,
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
        INSERT INTO cheques (tipo, estado, banco, numero, fecha_emision, fecha_vencimiento, monto, color, proveedor_destino_id, orden_pago_id)
        VALUES ('PROPIO', 'ENTREGADO_A_PROVEEDOR', COALESCE(v_det.cheque_banco, 'S/D'), COALESCE(v_det.cheque_numero, 'S/N'),
                v_hoy_ar, COALESCE(v_det.cheque_fecha_vencimiento, v_hoy_ar + 30), v_det.monto, 'BLANCO',
                v_op.proveedor_id, p_op_id)
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

-- ═══ op_anular v4 ═══
CREATE OR REPLACE FUNCTION public.op_anular(
  p_op_id      uuid,
  p_usuario_id uuid,
  p_motivo     text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_op   ordenes_pago%ROWTYPE;
  v_k    record;
  v_mov  record;
  v_imp  record;
  v_comp_id uuid;
  v_revs int := 0;
  v_certs int := 0;
BEGIN
  SELECT * INTO v_op FROM ordenes_pago WHERE id = p_op_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'op_anular: orden de pago % no encontrada', p_op_id;
  END IF;
  IF v_op.estado <> 'pagada' THEN
    RAISE EXCEPTION 'op_anular: la OP está % — solo se anulan OP pagadas', v_op.estado;
  END IF;

  FOR v_k IN
    SELECT * FROM kardex_contable
    WHERE referencia_tipo = 'orden_pago' AND referencia_id = p_op_id
      AND kardex_reversa_de IS NULL
      AND NOT EXISTS (SELECT 1 FROM kardex_contable r WHERE r.kardex_reversa_de = kardex_contable.id)
  LOOP
    PERFORM kardex_registrar(
      p_tipo_movimiento => 'PAGO_PROVEEDOR',
      p_concepto        => 'ANULACIÓN ' || v_op.numero_op || COALESCE(' — ' || p_motivo, '') || ' (reversa: ' || v_k.concepto || ')',
      p_monto           => v_k.monto,
      p_color           => v_k.color,
      p_origen_tipo     => v_k.destino_tipo,
      p_origen_id       => v_k.destino_id,
      p_destino_tipo    => v_k.origen_tipo,
      p_destino_id      => v_k.origen_id,
      p_metodo          => v_k.metodo,
      p_gastos          => 0,
      p_referencia_tipo => 'orden_pago_anulacion',
      p_referencia_id   => p_op_id,
      p_cheque_id       => v_k.cheque_id,
      p_usuario_id      => p_usuario_id,
      p_verificado      => true,
      p_reversa_de      => v_k.id
    );
    v_revs := v_revs + 1;
  END LOOP;

  UPDATE cheques SET estado = 'EN_CARTERA', proveedor_destino_id = NULL, orden_pago_id = NULL
  WHERE orden_pago_id = p_op_id AND tipo = 'TERCERO' AND estado = 'ENTREGADO_A_PROVEEDOR';
  UPDATE cheques SET estado = 'ANULADO'
  WHERE orden_pago_id = p_op_id AND tipo = 'PROPIO' AND estado = 'ENTREGADO_A_PROVEEDOR';

  FOR v_mov IN
    SELECT * FROM cuenta_corriente_proveedores
    WHERE referencia_tipo = 'orden_pago' AND referencia_id = p_op_id
  LOOP
    INSERT INTO cuenta_corriente_proveedores (proveedor_id, fecha, tipo_movimiento, monto, descripcion, referencia_id, referencia_tipo)
    VALUES (v_mov.proveedor_id, now(), 'anulacion', -(v_mov.monto),
            'ANULACIÓN ' || COALESCE(v_mov.descripcion, v_op.numero_op), p_op_id, 'orden_pago_anulacion');
    DELETE FROM imputaciones_proveedores WHERE id_movimiento_pago = v_mov.id;
  END LOOP;

  -- Restaurar saldos de comprobantes (créditos vuelven a negativo, facturas a deber)
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
      UPDATE comprobantes_compra
      SET saldo_pendiente = saldo_pendiente - abs(v_imp.monto_imputado),
          estado_pago = 'pendiente'
      WHERE id = v_comp_id;
    ELSE
      UPDATE comprobantes_compra
      SET saldo_pendiente = saldo_pendiente + v_imp.monto_imputado,
          estado_pago = 'pendiente'
      WHERE id = v_comp_id;
    END IF;
  END LOOP;

  -- v4 (E-55): devolver al vencimiento SIN comprobante el importe que había pagado esta orden
  FOR v_imp IN
    SELECT * FROM ordenes_pago_imputaciones
    WHERE orden_pago_id = p_op_id AND monto_imputado > 0 AND vencimiento_id IS NOT NULL AND movimiento_cc_id IS NULL
  LOOP
    PERFORM op_vencimiento_revertir_pago(v_imp.vencimiento_id, v_imp.monto_imputado, p_op_id);
  END LOOP;

  UPDATE vencimientos SET estado = 'pendiente', orden_pago_id = NULL, updated_at = now()
  WHERE orden_pago_id = p_op_id AND estado = 'pagado';

  -- v4 (E-55): vencimientos de comprobantes — vuelven a mostrar el saldo que quedó en la
  -- cuenta corriente (las imputaciones de esta orden ya se borraron más arriba)
  PERFORM op_vencimientos_sincronizar_movimiento(x.movimiento_cc_id, p_op_id, false)
  FROM (SELECT DISTINCT movimiento_cc_id FROM ordenes_pago_imputaciones
        WHERE orden_pago_id = p_op_id AND monto_imputado > 0 AND movimiento_cc_id IS NOT NULL) x;

  UPDATE retenciones_emitidas SET estado = 'anulada'
  WHERE orden_pago_id = p_op_id AND estado = 'emitida';
  GET DIAGNOSTICS v_certs = ROW_COUNT;

  UPDATE ordenes_pago
  SET estado = 'anulada',
      observaciones = COALESCE(observaciones || E'\n', '') || 'ANULADA: ' || COALESCE(p_motivo, 'sin motivo') ||
                      ' (' || to_char(now() AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD-MM-YYYY HH24:MI') || ')',
      updated_at = now()
  WHERE id = p_op_id;

  RETURN jsonb_build_object('success', true, 'kardex_reversas', v_revs, 'certificados_anulados', v_certs);
END;
$$;

REVOKE ALL ON FUNCTION public.op_anular(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.op_anular(uuid, uuid, text) TO service_role;
