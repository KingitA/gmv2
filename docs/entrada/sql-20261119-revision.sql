-- Revision antes de produccion de la entrada (19/11/2026): un solo archivo con las 3 migraciones.
-- Orden: 20261119n (pagos y banco), 20261119o (compras), 20261119p (listas). Son independientes e idempotentes.
-- Correr TODO junto en el editor SQL de Supabase.


-- ════════════ 20261119n_pagos_banco_retencion ════════════
-- =====================================================================
-- Revisión antes de producción — pagos (19/11/2026, rama salida-pagos).
--
-- Requiere 20261119d_bancos_operaciones.sql y 20261119e_bancos_confirmar_y_enviar.sql.
-- Idempotente: se puede correr más de una vez. No cambia datos (solo agrega columnas vacías y
-- reemplaza funciones). Cada función parte de la definición VIGENTE en la base al 19/11
-- (op_confirmar y op_retencion_al_confirmar de 20261117p, bancos_* de 20261119d, op_anular de
-- 20261117p).
--
-- 1) Retención de Ganancias y banco. Si la retención cambiaba entre que se mandaba el pago al
--    banco y que el banco lo confirmaba (otra orden del mismo proveedor confirmada antes, o
--    cambio de mes), la orden quedaba TRABADA con la plata ya salida: op_confirmar cortaba por
--    retención distinta, op_confirmar_ajustando quería cambiar el importe del pago (lo frena
--    bancos_detalle_guardia) y cancelar / eliminar lo frena bancos_bloqueo_orden.
--    Ahora: si algún pago de la orden ya está firmado / procesado / visto en la cuenta en el
--    banco REAL, la retención queda la que tenía la orden al mandarlo (no se recalcula) y se
--    confirma con esa. El certificado lo dice en su motivo. Sin operación del banco real, todo
--    sigue como antes.
--    op_retencion_al_confirmar nunca propone ajustar un pago que ya pasó por el banco.
--    op_retencion_actualizar (nueva): aceptar la retención de hoy ANTES de mandar el pago al banco.
-- 2) ordenes_pago.banco_confirmacion_*: por qué la orden no se confirmó sola aunque el banco ya
--    hizo el pago (lo escribe la consulta al banco; se ve en la orden y en Finanzas → Bancos).
-- 3) op_anular: no se anula una orden cuyo pago el banco ya hizo (o todavía puede hacer):
--    devolvería la deuda y los vencimientos quedarían para pagar otra vez (pago doble).
-- 4) E-cheq emitido por el banco: el cheque propio que crea op_confirmar lleva el identificador
--    y el número que dio el banco (cheques.echeq_id / numero), no el número escrito a mano.
-- =====================================================================

-- ─── 2) Confirmación sola que no se pudo hacer ───────────────────────────────────────────────
ALTER TABLE public.ordenes_pago ADD COLUMN IF NOT EXISTS banco_confirmacion_falla text;
ALTER TABLE public.ordenes_pago ADD COLUMN IF NOT EXISTS banco_confirmacion_falla_estado text;
ALTER TABLE public.ordenes_pago ADD COLUMN IF NOT EXISTS banco_confirmacion_falla_at timestamptz;
COMMENT ON COLUMN public.ordenes_pago.banco_confirmacion_falla IS
  'El banco ya hizo el pago, pero la orden no se pudo confirmar sola: el motivo, en palabras. Se borra al confirmarla.';
COMMENT ON COLUMN public.ordenes_pago.banco_confirmacion_falla_estado IS
  'no_se_pudo = la confirmación falló (ver el motivo) · falta_resto = tiene pagos que no pasan por el banco y se confirman a mano.';
COMMENT ON COLUMN public.ordenes_pago.banco_confirmacion_falla_at IS 'Cuándo se vio por última vez que no se pudo confirmar sola.';

-- ─── 1) ¿El banco real ya hizo algún pago de esta orden? ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.op_banco_pago_hecho(p_op_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM bancos_operaciones o
    WHERE o.orden_pago_id = p_op_id AND o.ambiente = 'produccion' AND o.orden_pago_detalle_id IS NOT NULL
      AND o.estado IN ('firmada', 'acreditada')
  );
$function$;
COMMENT ON FUNCTION public.op_banco_pago_hecho(uuid) IS
  'true = algún pago de la orden ya está firmado / procesado / visto en la cuenta en el banco REAL: la plata salió y la retención de Ganancias queda la de la orden (no se recalcula).';

-- ─── 1) Vista previa de la retención (vigente: 20261117p) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.op_retencion_al_confirmar(p_op_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_op       ordenes_pago%ROWTYPE;
  v_guard    numeric;
  v_hoy      numeric;
  v_calc_hoy numeric;
  v_dif      numeric;
  v_linea    record;
  v_fija     boolean;
BEGIN
  SELECT * INTO v_op FROM ordenes_pago WHERE id = p_op_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La orden de pago no existe.';
  END IF;
  v_guard := COALESCE(v_op.retencion_ganancias, 0);
  v_hoy := v_guard;
  v_calc_hoy := v_guard;
  -- 20261119n: con un pago ya hecho en el banco real, la retención queda la de la orden
  v_fija := op_banco_pago_hecho(p_op_id);
  IF v_op.estado = 'pendiente' AND COALESCE(v_op.base_ganancias, 0) > 0 AND NOT COALESCE(v_op.ganancias_ajuste_manual, false) THEN
    v_calc_hoy := COALESCE((ganancias_calcular(v_op.proveedor_id, v_op.base_ganancias, public.hoy_ar(), p_op_id)->>'retencion')::numeric, 0);
    IF NOT v_fija THEN
      v_hoy := v_calc_hoy;
    END IF;
  END IF;
  v_dif := round(v_hoy - v_guard, 2);

  -- La diferencia se ajusta en una transferencia, efectivo o depósito (un cheque no se puede cambiar).
  -- 20261119n: NUNCA en un pago que ya se mandó al banco real (salvo que el banco lo haya rechazado).
  SELECT d.id, d.medio, d.monto INTO v_linea FROM ordenes_pago_detalle d
   WHERE d.orden_pago_id = p_op_id AND d.medio IN ('transferencia', 'efectivo', 'deposito') AND d.monto - v_dif > 0
     AND NOT EXISTS (
       SELECT 1 FROM bancos_operaciones o
       WHERE o.orden_pago_detalle_id = d.id AND o.ambiente = 'produccion' AND o.estado <> 'rechazada'
     )
   ORDER BY d.monto DESC, d.id LIMIT 1;

  RETURN jsonb_build_object(
    'cambia', abs(v_dif) > 0.01,
    'retencion_guardada', v_guard, 'retencion_hoy', v_hoy,
    'neto_guardado', v_op.neto_a_pagar, 'neto_hoy', round(COALESCE(v_op.neto_a_pagar, 0) - v_dif, 2),
    'se_puede_ajustar', v_linea.id IS NOT NULL,
    'medio_que_se_ajusta', v_linea.medio, 'linea_id', v_linea.id,
    'fecha_pago', public.hoy_ar(), 'fecha_orden', v_op.fecha,
    -- 20261119n
    'retencion_fija_por_banco', v_fija,
    'retencion_calculada_hoy', v_calc_hoy
  );
END;
$function$;

-- ─── 1) Aceptar la retención de hoy antes de mandar el pago al banco (nueva) ─────────────────
-- Hace el mismo ajuste que op_confirmar_ajustando, sin confirmar: la orden sigue pendiente y el
-- pago se manda al banco ya con el importe nuevo. p_retencion_vista = la retención que la persona
-- vio y aceptó; si cambió otra vez desde entonces, no toca nada.
CREATE OR REPLACE FUNCTION public.op_retencion_actualizar(p_op_id uuid, p_retencion_vista numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_op  ordenes_pago%ROWTYPE;
  v_r   jsonb;
  v_dif numeric;
BEGIN
  SELECT * INTO v_op FROM ordenes_pago WHERE id = p_op_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La orden de pago no existe.';
  END IF;
  IF v_op.estado IS DISTINCT FROM 'pendiente' THEN
    RAISE EXCEPTION 'La orden de pago % está %: la retención solo se actualiza en una orden pendiente.', v_op.numero_op, COALESCE(v_op.estado, 'sin estado');
  END IF;
  -- Misma llave que op_crear / op_confirmar: lo pagado en el mes no cambia mientras tanto
  PERFORM pg_advisory_xact_lock(hashtext('op_proveedor:' || v_op.proveedor_id::text));

  v_r := op_retencion_al_confirmar(p_op_id);
  IF NOT (v_r->>'cambia')::boolean THEN
    RETURN v_r || jsonb_build_object('actualizada', false);
  END IF;
  IF p_retencion_vista IS NULL OR abs((v_r->>'retencion_hoy')::numeric - p_retencion_vista) > 0.01 THEN
    RAISE EXCEPTION 'La retención de Ganancias volvió a cambiar: ahora corresponde %. Revisala de nuevo antes de aceptarla. No se cambió nada.',
      fmt_moneda((v_r->>'retencion_hoy')::numeric);
  END IF;
  IF NOT (v_r->>'se_puede_ajustar')::boolean THEN
    RAISE EXCEPTION 'La retención de Ganancias cambió de % a % y la orden no tiene una transferencia ni efectivo (sin mandar al banco) donde ajustar la diferencia. Eliminá la orden y armala de nuevo.',
      fmt_moneda((v_r->>'retencion_guardada')::numeric), fmt_moneda((v_r->>'retencion_hoy')::numeric);
  END IF;
  v_dif := round((v_r->>'retencion_hoy')::numeric - (v_r->>'retencion_guardada')::numeric, 2);
  UPDATE ordenes_pago_detalle SET monto = round(monto - v_dif, 2) WHERE id = (v_r->>'linea_id')::uuid;
  UPDATE ordenes_pago
     SET retencion_ganancias = (v_r->>'retencion_hoy')::numeric,
         total_retenciones = round(COALESCE(total_retenciones, 0) + v_dif, 2),
         neto_a_pagar = round(COALESCE(neto_a_pagar, 0) - v_dif, 2),
         updated_at = now()
   WHERE id = p_op_id;
  RETURN v_r || jsonb_build_object('actualizada', true);
END;
$function$;

-- ─── 1) + 4) op_confirmar (vigente: v12 de 20261117p) ────────────────────────────────────────
-- Cambios (marcados "20261119n"): retención fija si el banco real ya hizo un pago de la orden;
-- el cheque propio de un e-cheq emitido por el banco lleva su identificador y número.
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
  v_fija      boolean := false;   -- 20261119n
  v_ret_motivo text;              -- 20261119n
  v_echeq_id  text;               -- 20261119n
  v_echeq_num text;               -- 20261119n
  v_ch_numero text;               -- 20261119n
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

  -- v12 (E-57): la fecha del pago es HOY (día de la confirmación). No se emite un certificado
  -- en un período que ya se presentó ante ARCA.
  IF COALESCE(v_op.retencion_ganancias, 0) > 0 AND v_hoy_ar <= COALESCE(retenciones_presentado_hasta(), '0001-01-01'::date) THEN
    RAISE EXCEPTION 'No se puede confirmar la orden % con retención de Ganancias: las retenciones ya están presentadas ante ARCA hasta el %.',
      v_op.numero_op, to_char(retenciones_presentado_hasta(), 'DD/MM/YYYY');
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

  -- 20261119n: si el banco REAL ya hizo un pago de esta orden, la plata salió con la retención
  -- que tenía la orden al mandarlo: no se recalcula (antes la orden quedaba trabada).
  v_fija := op_banco_pago_hecho(p_op_id);

  IF COALESCE(v_op.base_ganancias, 0) > 0 AND NOT COALESCE(v_op.ganancias_ajuste_manual, false) THEN
    -- v12 (E-57): se recalcula con el día de HOY (la confirmación), no con la fecha de la orden
    v_calc := ganancias_calcular(v_op.proveedor_id, v_op.base_ganancias, v_hoy_ar, p_op_id);
    v_ret_calc := (v_calc->>'retencion')::numeric;
    IF abs(v_ret_calc - COALESCE(v_op.retencion_ganancias, 0)) > 0.01 THEN
      IF v_fija THEN
        v_ret_motivo := format('Retención fijada al mandar el pago al banco: %s (al confirmar correspondía %s).',
          fmt_moneda(COALESCE(v_op.retencion_ganancias, 0)), fmt_moneda(v_ret_calc));
      ELSE
        RAISE EXCEPTION 'La retención de Ganancias cambió desde que se armó la orden: era % y hoy corresponde % (por lo pagado en el mes). Confirmala de nuevo aceptando la retención nueva, o eliminala y armala otra vez.',
          fmt_moneda(COALESCE(v_op.retencion_ganancias, 0)), fmt_moneda(v_ret_calc);
      END IF;
    END IF;
  ELSIF COALESCE(v_op.retencion_ganancias, 0) > 0 THEN
    v_calc := ganancias_calcular(v_op.proveedor_id, COALESCE(v_op.base_ganancias, 0), v_hoy_ar, p_op_id);
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
      v_hoy_ar,   -- v12 (E-57): el certificado lleva el día de la confirmación
      COALESCE(v_op.base_ganancias, 0),
      NULLIF(v_calc->>'acumulado_total_mes', '')::numeric,
      COALESCE(NULLIF(v_calc->>'alicuota', '')::numeric, 0),
      v_op.retencion_ganancias,
      v_num_cert,
      COALESCE(v_op.ganancias_ajuste_manual, false) OR v_ret_motivo IS NOT NULL,   -- 20261119n
      COALESCE(v_op.ganancias_motivo, v_ret_motivo),                             -- 20261119n
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
        -- 20261119n: e-cheq emitido por Credicoop (banco real): el cheque lleva el identificador y
        -- el número que dio el banco, así el débito y la conciliación lo encuentran.
        v_echeq_id := NULL; v_echeq_num := NULL;
        SELECT NULLIF(btrim(o.id_cheque_banco), ''),
               NULLIF(btrim(COALESCE(o.respuesta->'data'->'echeqs'->0->>'numeroCheque', o.respuesta->'data'->'echeq'->>'numeroCheque')), '')
          INTO v_echeq_id, v_echeq_num
          FROM bancos_operaciones o
         WHERE o.orden_pago_detalle_id = v_det.id AND o.tipo = 'echeq_emision' AND o.ambiente = 'produccion'
           AND o.estado IN ('firmada', 'acreditada')
         ORDER BY o.creado_at DESC LIMIT 1;
        v_ch_numero := COALESCE(v_echeq_num, v_det.cheque_numero);

        -- v10 (E-62): el cheque propio / e-cheq queda atado a la cuenta bancaria de la que sale
        -- (cuentas_bancarias, no texto libre) y marcado como e-cheq si corresponde. El banco baja
        -- recién cuando el cheque se debita (cheque_propio_debitar).
        INSERT INTO cheques (tipo, estado, banco, numero, fecha_emision, fecha_vencimiento, monto, color, proveedor_destino_id, orden_pago_id,
                             cuenta_banco_id, es_echeq, echeq_id)
        VALUES ('PROPIO', 'ENTREGADO_A_PROVEEDOR',
                COALESCE((SELECT cb.nombre FROM cuentas_bancarias cb
                           WHERE cb.id = v_det.cuenta_origen_id AND v_det.cuenta_origen_tipo = 'BANCO'), v_det.cheque_banco, 'S/D'),
                COALESCE(v_ch_numero, 'S/N'),
                v_hoy_ar, COALESCE(v_det.cheque_fecha_vencimiento, v_hoy_ar + 30), v_det.monto, 'BLANCO',
                v_op.proveedor_id, p_op_id,
                CASE WHEN v_det.cuenta_origen_tipo = 'BANCO' THEN v_det.cuenta_origen_id END,
                COALESCE(v_det.es_echeq, false) OR v_echeq_id IS NOT NULL,
                v_echeq_id)
        RETURNING id INTO v_cheque_id;

        PERFORM kardex_registrar(
          p_tipo_movimiento => 'PAGO_PROVEEDOR',
          p_concepto        => 'Pago ' || v_op.numero_op || ' — cheque propio ' || COALESCE(v_ch_numero, ''),
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

  -- v12: + fecha_confirmacion · 20261119n: se borra el aviso de "no se pudo confirmar sola"
  UPDATE ordenes_pago SET estado = 'pagada', fecha_confirmacion = v_hoy_ar, updated_at = now(),
         banco_confirmacion_falla = NULL, banco_confirmacion_falla_estado = NULL, banco_confirmacion_falla_at = NULL
   WHERE id = p_op_id;

  RETURN jsonb_build_object(
    'success', true, 'ya_confirmada', false,
    'cc_pago_id', v_pago_mov, 'kardex_lineas', v_kardex,
    'certificado_id', v_cert_id, 'numero_certificado', v_num_cert,
    'retencion_fija_por_banco', v_ret_motivo IS NOT NULL, 'retencion_motivo', v_ret_motivo   -- 20261119n
  );
END;
$function$;

-- ─── 3) Guardia del banco: + 'anular' (vigente: 20261119d) ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.bancos_bloqueo_orden(p_op_id uuid, p_accion text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
BEGIN
  IF p_accion = 'confirmar' THEN
    FOR r IN
      SELECT DISTINCT ON (o.orden_pago_detalle_id) o.estado, o.monto, o.tipo, d.monto AS monto_detalle
      FROM bancos_operaciones o
      LEFT JOIN ordenes_pago_detalle d ON d.id = o.orden_pago_detalle_id
      WHERE o.orden_pago_id = p_op_id AND o.ambiente = 'produccion' AND o.orden_pago_detalle_id IS NOT NULL
      ORDER BY o.orden_pago_detalle_id, o.creado_at DESC
    LOOP
      IF r.estado = 'rechazada' THEN
        RETURN format('El banco rechazó el pago de %s que se había mandado a Credicoop: ese pago no salió. Volvé a mandarlo desde el botón de Credicoop de la orden, o eliminá la orden y armala de nuevo con otra forma de pago.', fmt_moneda(r.monto));
      ELSIF r.estado NOT IN ('firmada', 'acreditada') THEN
        RETURN format('Esta orden tiene un pago de %s mandado a Credicoop que todavía no está procesado (%s). Tocá “Actualizar estado” en el botón de Credicoop de la orden: se puede confirmar cuando el banco diga que quedó hecho.',
          fmt_moneda(r.monto), CASE r.estado WHEN 'error' THEN 'no se sabe si entró' WHEN 'enviada_a_firma' THEN 'falta la firma con token' ELSE 'el banco no terminó' END);
      ELSIF r.monto_detalle IS NOT NULL AND abs(r.monto_detalle - r.monto) > 0.005 THEN
        RETURN format('El banco procesó un pago de %s, pero en la orden ese pago figura por %s. No se confirma así: avisá a sistemas.', fmt_moneda(r.monto), fmt_moneda(r.monto_detalle));
      END IF;
    END LOOP;
    RETURN NULL;
  END IF;

  -- 20261119n: anular una orden PAGADA. Si el banco ya hizo el pago (o todavía lo puede hacer),
  -- anularla devolvería la deuda al proveedor y los vencimientos quedarían para pagar otra vez.
  IF p_accion = 'anular' THEN
    SELECT o.estado, o.monto, o.tipo INTO r
    FROM bancos_operaciones o
    WHERE o.orden_pago_id = p_op_id AND o.ambiente = 'produccion' AND o.estado <> 'rechazada'
    ORDER BY (o.estado IN ('firmada', 'acreditada')) DESC, o.creado_at DESC
    LIMIT 1;
    IF NOT FOUND THEN RETURN NULL; END IF;
    IF r.estado IN ('firmada', 'acreditada') THEN
      RETURN format('No se puede anular: Credicoop ya hizo el pago de %s de esta orden (%s) y la plata salió. Si se anula, la deuda vuelve a la cuenta corriente del proveedor y los vencimientos quedan para pagar otra vez: sería un pago doble. Si el proveedor devuelve la plata o hay que corregir algo, registralo aparte (nota de crédito o ajuste en la cuenta corriente del proveedor) y avisá a sistemas.',
        fmt_moneda(r.monto), CASE r.tipo WHEN 'transferencia' THEN 'transferencia' WHEN 'echeq_emision' THEN 'e-cheq emitido' WHEN 'echeq_endoso' THEN 'e-cheq endosado' ELSE r.tipo END);
    END IF;
    RETURN format('No se puede anular: esta orden tiene un pago de %s mandado a Credicoop que todavía puede salir. Primero rechazá esa operación en Banca Internet Empresa y tocá “Actualizar estado” en el botón de Credicoop de la orden.',
      fmt_moneda(r.monto));
  END IF;

  -- cancelar / eliminar
  SELECT o.estado, o.monto INTO r
  FROM bancos_operaciones o
  WHERE o.orden_pago_id = p_op_id AND o.ambiente = 'produccion' AND o.estado <> 'rechazada'
  ORDER BY (o.estado IN ('firmada', 'acreditada')) DESC, o.creado_at DESC
  LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF r.estado IN ('firmada', 'acreditada') THEN
    RETURN format('El banco ya procesó un pago de %s de esta orden: la plata salió. No se puede %s. Confirmá la orden; si después hay que deshacer el pago, se anula.',
      fmt_moneda(r.monto), CASE WHEN p_accion = 'eliminar' THEN 'eliminar' ELSE 'cancelar' END);
  END IF;
  RETURN format('Esta orden tiene un pago de %s mandado a Credicoop que todavía se puede firmar con token. Si se %s la orden y después lo firman, la plata sale igual. Primero rechazá esa operación en Banca Internet Empresa y tocá “Actualizar estado” en el botón de Credicoop de la orden.',
    fmt_moneda(r.monto), CASE WHEN p_accion = 'eliminar' THEN 'elimina' ELSE 'cancela' END);
END;
$function$;

-- El disparador de la orden también corta el paso a 'anulada' (vigente: 20261119d)
CREATE OR REPLACE FUNCTION public.bancos_orden_guardia()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_msg text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_msg := public.bancos_bloqueo_orden(OLD.id, 'eliminar');
    IF v_msg IS NOT NULL THEN RAISE EXCEPTION '%', v_msg USING ERRCODE = 'P0001'; END IF;
    RETURN OLD;
  END IF;
  IF NEW.estado = 'pagada' AND OLD.estado IS DISTINCT FROM 'pagada' THEN
    v_msg := public.bancos_bloqueo_orden(NEW.id, 'confirmar');
  ELSIF NEW.estado = 'cancelada' AND OLD.estado IS DISTINCT FROM 'cancelada' THEN
    v_msg := public.bancos_bloqueo_orden(NEW.id, 'cancelar');
  ELSIF NEW.estado = 'anulada' AND OLD.estado IS DISTINCT FROM 'anulada' THEN   -- 20261119n
    v_msg := public.bancos_bloqueo_orden(NEW.id, 'anular');
  END IF;
  IF v_msg IS NOT NULL THEN RAISE EXCEPTION '%', v_msg USING ERRCODE = 'P0001'; END IF;
  RETURN NEW;
END;
$function$;

-- ─── 3) op_anular (vigente: v6 de 20261117p) ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.op_anular(p_op_id uuid, p_usuario_id uuid, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_op   ordenes_pago%ROWTYPE;
  v_k    record;
  v_mov  record;
  v_imp  record;
  v_comp_id uuid;
  v_revs int := 0;
  v_certs int := 0;
  v_debitados text;   -- v6
  v_banco text;       -- 20261119n
BEGIN
  SELECT * INTO v_op FROM ordenes_pago WHERE id = p_op_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'op_anular: orden de pago % no encontrada', p_op_id;
  END IF;
  IF v_op.estado <> 'pagada' THEN
    RAISE EXCEPTION 'op_anular: la OP está % — solo se anulan OP pagadas', v_op.estado;
  END IF;
  -- 20261119n: el pago que hizo el banco real no se deshace anulando la orden (sería un pago doble)
  v_banco := bancos_bloqueo_orden(p_op_id, 'anular');
  IF v_banco IS NOT NULL THEN
    RAISE EXCEPTION '%', v_banco USING ERRCODE = 'P0001';
  END IF;
  -- v6: un cheque propio de esta orden que YA se debitó del banco no se puede deshacer desde acá
  SELECT string_agg(numero, ', ') INTO v_debitados FROM cheques
   WHERE orden_pago_id = p_op_id AND tipo::text = 'PROPIO' AND estado::text = 'COBRADO';
  IF v_debitados IS NOT NULL THEN
    RAISE EXCEPTION 'El cheque N° % ya se debitó del banco: para anular la orden primero registrá el rechazo/devolución del cheque.', v_debitados;
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

  -- v5 (E-56): el saldo de cada comprobante tocado se vuelve a leer de la cuenta corriente
  -- (las imputaciones de esta orden, incluidas las de créditos, ya se borraron más arriba)
  PERFORM op_sincronizar_saldos_comprobantes(p_op_id);

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
$function$;

-- ── Permisos (revisión del orquestador, 19/11) ──────────────────────────────────────────
-- Todas las llama el servidor con el cliente de servicio. Las nuevas nacerían ejecutables por
-- cualquier usuario logueado (privilegios por defecto); las reemplazadas se dejan igual de cerradas.
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.op_banco_pago_hecho(uuid)',
    'public.op_retencion_al_confirmar(uuid)',
    'public.op_retencion_actualizar(uuid, numeric)',
    'public.op_confirmar(uuid, uuid, uuid, uuid)',
    'public.bancos_bloqueo_orden(uuid, text)',
    'public.op_anular(uuid, uuid, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;


-- ════════════ 20261119o_compras_revision ════════════
-- ════════════════════════════════════════════════════════════════════════════════════════
-- Compras: revisión antes de producción (19/11/2026, rama salida-compras)
-- ════════════════════════════════════════════════════════════════════════════════════════
-- 1. comprobante_compra_deshacer_deuda (NUEVA): al eliminar un comprobante SIN validar que entró
--    por mail, su movimiento de cuenta corriente (referencia_tipo = 'comprobante_compra') vuelve a
--    ser la provisión de la orden (o se quita, si no había provisión que devolver). Antes quedaba
--    huérfano y, al volver a cargar el comprobante, la deuda quedaba dos veces.
-- 2. comprobante_compra_validar: también adopta un movimiento 'comprobante_compra' HUÉRFANO (su
--    comprobante ya no existe) que el servidor identificó como de este comprobante.
-- 3. oc_cancelar / oc_guardar: una recepción "borrador" (la crea la oficina al subir la factura)
--    en la que el depósito YA contó algo frena cancelar y editar la orden, igual que "en proceso".
-- 4. ordenes_compra: quién y cuándo aceptó finalizar con diferencias de precio/cantidad sin resolver.
--
-- Parte de la definición VIGENTE en la base al 19/11 (todas las migraciones hasta 20261119k
-- aplicadas). Idempotente: se puede correr más de una vez. Nunca borra vencimientos: los cancela.
-- ════════════════════════════════════════════════════════════════════════════════════════

-- ── 4. Diferencias aceptadas al finalizar ────────────────────────────────────────────────
ALTER TABLE public.ordenes_compra ADD COLUMN IF NOT EXISTS diferencias_aceptadas_at  timestamptz;
ALTER TABLE public.ordenes_compra ADD COLUMN IF NOT EXISTS diferencias_aceptadas_por uuid;
ALTER TABLE public.ordenes_compra ADD COLUMN IF NOT EXISTS diferencias_aceptadas     jsonb;
COMMENT ON COLUMN public.ordenes_compra.diferencias_aceptadas IS
  'Al finalizar con diferencias sin resolver: lista de artículos (sku, descripción, qué diferencia) que quien finalizó aceptó expresamente.';

-- ── 1. Deshacer la deuda de un comprobante sin validar ───────────────────────────────────
-- La llama el servidor ANTES de borrar el comprobante (lib/services/detalle.ts →
-- revertirComprobanteOCR). Si después falla el borrado, el comprobante queda sin deuda y al
-- validarlo nace como cualquier otro (baja la provisión una sola vez): no queda nada duplicado.
--
-- Cómo lo dejó el procesador de mails (lib/ai/email-invoice-processor.ts):
--   a. La factura cubría toda la provisión de su canal → la provisión SE CONVIRTIÓ en la factura.
--   b. La factura era por menos → la provisión bajó a "resto sin facturar" y la factura entró como
--      movimiento propio.
--   c. Sin provisión (o NC / ND, o sin orden) → la factura entró como movimiento propio.
-- Deshacer: lo que la factura le sacó a la provisión de su canal vuelve a la provisión (se suma a
-- la que quedó, o el movimiento vuelve a ser la provisión), con tope en lo que la orden todavía
-- estima para ese canal (total del canal − otros comprobantes de la orden − provisión que quedó).
-- Lo que no vuelve a la provisión se quita de la cuenta corriente. Con la orden finalizada o
-- cancelada no hay provisión que devolver: el movimiento solo se quita.
-- Frena (no cambia nada) si esa deuda ya tiene pagos imputados o vencimientos pagados.
CREATE OR REPLACE FUNCTION public.comprobante_compra_deshacer_deuda(p_comprobante_id uuid, p_usuario_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v            record;
  v_oc         uuid;
  v_oc_estado  text;
  v_oc_numero  text;
  v_oc_fecha   timestamptz;
  m            record;
  t            record;
  v_canal      text;
  v_convierte  boolean;
  v_total_can  numeric;
  v_otros      numeric;
  v_prov_hoy   numeric;
  v_vuelve     numeric;
  v_prov_id    uuid;
  v_quitados   int := 0;
  v_devuelto   numeric := 0;
  v_cancelados int := 0;
  v_n          int;
BEGIN
  SELECT * INTO v FROM comprobantes_compra WHERE id = p_comprobante_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'sin_comprobante', true);
  END IF;
  IF v.estado IN ('validado', 'cerrado') THEN
    RAISE EXCEPTION 'El comprobante % % ya fue validado: anulá la validación antes de eliminarlo.', v.tipo_comprobante, v.numero_comprobante
      USING ERRCODE = 'P0001', DETAIL = 'comprobante_validado';
  END IF;

  IF v.orden_compra_id IS NOT NULL THEN
    -- La provisión de la orden es compartida con la validación de otros comprobantes: de a uno
    SELECT id, numero_orden, estado, fecha_orden INTO v_oc, v_oc_numero, v_oc_estado, v_oc_fecha
      FROM ordenes_compra WHERE id = v.orden_compra_id FOR UPDATE;
  END IF;
  v_canal := CASE WHEN v.tipo_comprobante IN ('Adquisicion', 'ADQ') THEN 'negro' ELSE 'blanco' END;
  -- Solo una factura o una adquisición convierte la provisión (misma regla que el procesador)
  v_convierte := v.tipo_comprobante IN ('FA', 'FB', 'FC', 'Adquisicion', 'ADQ');

  FOR m IN
    SELECT * FROM cuenta_corriente_proveedores
     WHERE referencia_tipo = 'comprobante_compra' AND referencia_id = p_comprobante_id
     ORDER BY created_at
       FOR UPDATE
  LOOP
    -- ¿Ya se pagó (todo o en parte)? Entonces no se toca nada: primero hay que anular el pago.
    IF EXISTS (SELECT 1 FROM imputaciones_proveedores i WHERE i.id_movimiento_documento = m.id OR i.id_movimiento_pago = m.id)
       OR EXISTS (SELECT 1 FROM ordenes_pago_imputaciones x WHERE x.movimiento_cc_id = m.id)
       OR EXISTS (SELECT 1 FROM vencimientos ve
                   WHERE ve.referencia_tipo = 'cuenta_corriente' AND ve.referencia_id = m.id
                     AND (ve.estado = 'pagado' OR coalesce(ve.monto_pagado, 0) > 0)) THEN
      RAISE EXCEPTION 'El comprobante % % ya tiene pagos imputados en la cuenta corriente del proveedor: no se puede eliminar así. Anulá primero el pago (orden de pago) y después eliminalo.', v.tipo_comprobante, v.numero_comprobante
        USING ERRCODE = 'P0001', DETAIL = 'comprobante_con_pagos';
    END IF;

    -- Vencimientos de esa deuda (mails viejos los creaban al llegar): se CANCELAN, nunca se borran
    UPDATE vencimientos
       SET estado = 'cancelado',
           observaciones = left(coalesce(nullif(observaciones, '') || ' · ', '')
             || 'Cancelado: se eliminó el comprobante ' || v.tipo_comprobante || ' ' || v.numero_comprobante || ' sin validar.', 1000),
           actualizado_por = coalesce(p_usuario_id, actualizado_por),
           updated_at = now()
     WHERE referencia_tipo = 'cuenta_corriente' AND referencia_id = m.id
       AND estado IN ('pendiente', 'vencido');
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_cancelados := v_cancelados + v_n;

    -- ¿Cuánto de esta deuda era la provisión de la orden?
    v_vuelve := 0;
    v_prov_id := NULL;
    IF v_convierte AND coalesce(m.monto, 0) > 0 AND v_oc IS NOT NULL AND v_oc_estado NOT IN ('finalizada', 'cancelada') THEN
      SELECT * INTO t FROM oc_totales(v_oc);
      v_total_can := coalesce(CASE WHEN v_canal = 'negro' THEN t.total_negro ELSE t.total_blanco END, 0);
      -- Lo que ya facturan OTROS comprobantes de esta orden y de este canal (validados o por mail)
      SELECT coalesce(sum(cc.monto), 0) INTO v_otros
        FROM cuenta_corriente_proveedores cc
        JOIN comprobantes_compra c ON c.id = cc.referencia_id
       WHERE cc.referencia_tipo = 'comprobante_compra'
         AND c.orden_compra_id = v_oc
         AND c.id <> p_comprobante_id
         AND (c.tipo_comprobante IN ('Adquisicion', 'ADQ')) = (v_canal = 'negro')
         AND c.tipo_comprobante IN ('FA', 'FB', 'FC', 'Adquisicion', 'ADQ')
         AND cc.monto > 0;
      -- La provisión que quedó de este canal (las viejas, sin canal, valen para cualquiera)
      SELECT coalesce(sum(monto), 0) INTO v_prov_hoy
        FROM cuenta_corriente_proveedores
       WHERE referencia_tipo = 'orden_compra' AND referencia_id = v_oc AND tipo_movimiento = 'orden_compra'
         AND (canal IS NULL OR canal = v_canal);
      v_vuelve := round(least(m.monto, greatest(0, v_total_can - v_otros - v_prov_hoy)), 2);

      SELECT id INTO v_prov_id
        FROM cuenta_corriente_proveedores
       WHERE referencia_tipo = 'orden_compra' AND referencia_id = v_oc AND tipo_movimiento = 'orden_compra'
         AND (canal IS NULL OR canal = v_canal)
       ORDER BY (canal IS NULL), created_at
       LIMIT 1
         FOR UPDATE;
    END IF;

    IF v_vuelve > 0.01 AND v_prov_id IS NOT NULL THEN
      -- b. La provisión había bajado: recupera lo que le sacó esta factura; el movimiento se va
      UPDATE cuenta_corriente_proveedores
         SET monto = round(monto + v_vuelve, 2), updated_at = now()
       WHERE id = v_prov_id;
      DELETE FROM cuenta_corriente_proveedores WHERE id = m.id;
      v_devuelto := v_devuelto + v_vuelve;
    ELSIF v_vuelve > 0.01 THEN
      -- a. La provisión se había convertido en esta factura: vuelve a ser la provisión
      UPDATE cuenta_corriente_proveedores
         SET tipo_movimiento = 'orden_compra',
             referencia_tipo = 'orden_compra',
             referencia_id = v_oc,
             canal = v_canal,
             monto = v_vuelve,
             descripcion = 'Provisión OC: ' || coalesce(v_oc_numero, '')
               || CASE WHEN v_canal = 'negro' THEN ' — sin factura (estimado)' ELSE ' — con factura (estimado)' END,
             numero_comprobante = NULL,
             tipo_comprobante = NULL,
             fecha = coalesce(v_oc_fecha, fecha),
             updated_at = now()
       WHERE id = m.id;
      v_devuelto := v_devuelto + v_vuelve;
    ELSE
      -- c. No había provisión que devolver (NC / ND, sin orden, orden cerrada): la deuda se quita
      DELETE FROM cuenta_corriente_proveedores WHERE id = m.id;
    END IF;
    v_quitados := v_quitados + 1;
  END LOOP;

  -- Vencimientos colgados directo del comprobante (no debería haber sin validar): se cancelan
  UPDATE vencimientos
     SET estado = 'cancelado',
         observaciones = left(coalesce(nullif(observaciones, '') || ' · ', '')
           || 'Cancelado: se eliminó el comprobante ' || v.tipo_comprobante || ' ' || v.numero_comprobante || ' sin validar.', 1000),
         actualizado_por = coalesce(p_usuario_id, actualizado_por),
         updated_at = now()
   WHERE referencia_tipo = 'comprobante_compra' AND referencia_id = p_comprobante_id
     AND estado IN ('pendiente', 'vencido');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_cancelados := v_cancelados + v_n;

  RETURN jsonb_build_object('success', true, 'movimientos', v_quitados, 'provision_devuelta', v_devuelto,
                            'vencimientos_cancelados', v_cancelados);
END;
$function$;

REVOKE ALL ON FUNCTION public.comprobante_compra_deshacer_deuda(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.comprobante_compra_deshacer_deuda(uuid, uuid) TO service_role;

-- ── 2. Validar: adopta también un movimiento huérfano de un comprobante eliminado ──────────
-- Igual a la vigente (20261119k) salvo el bloque marcado (19/11) en "¿Entró por mail?".
CREATE OR REPLACE FUNCTION public.comprobante_compra_validar(p_comprobante_id uuid, p_usuario_id uuid, p_plan jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v              record;
  v_oc           uuid;
  v_numero_oc    text;
  v_prov         uuid;
  v_total        numeric;
  v_credito      boolean;
  v_documental   boolean;
  v_debito_nota  boolean;
  v_sin_articulo int;
  v_mov          uuid;
  v_mov_nuevo    boolean := false;
  v_fecha        timestamptz;
  v_desc         text;
  v_otros        int;
  v_prov_row     record;
  v_restante     numeric;
  v_provision    text := 'sin_provision';
  v_venc         uuid;
  v_venc_nuevo   boolean := false;
  v_fecha_venc   date;
  v_fecha_valid  date;
  v_adoptar      uuid;
  v_suma         numeric;
  v_suma2        numeric;
  v_tipo_dto     text := 'cascada';
  v_neto_comp    numeric;
  v_impuestos    numeric;
  v_dto          numeric;
  v_sufijo_oc    text;
  v_venc_monto   numeric;
  v_canal        text;
  v_pagos        jsonb;
  v_pago         jsonb;
  v_n_pagos      int;
  v_i            int;
  v_monto        numeric;
  v_resto        numeric;
  v_venc_i       uuid;
  v_creados      int := 0;
  v_estimados    int := 0;
  v_enlazar      jsonb;
  v_e            record;
  v_enlazado     boolean := false;
  v_n_enl        int := 0;
  v_suma_enl     numeric := 0;
  v_ultimo_enl   uuid;
  v_monto_enl    numeric;
  v_saldo        numeric;
  v_pagado_antes numeric := 0;
BEGIN
  SELECT * INTO v FROM comprobantes_compra WHERE id = p_comprobante_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El comprobante no existe (puede que lo hayan eliminado).' USING ERRCODE = 'P0002', DETAIL = 'no_encontrado';
  END IF;

  -- ── 1. Ya validado: no se repite nada ──
  IF v.estado IN ('validado', 'cerrado') THEN
    SELECT id INTO v_mov FROM cuenta_corriente_proveedores
     WHERE referencia_tipo = 'comprobante_compra' AND referencia_id = p_comprobante_id
     ORDER BY created_at LIMIT 1;
    RETURN jsonb_build_object('success', true, 'ya_validado', true, 'comprobante_id', p_comprobante_id, 'movimiento_cc_id', v_mov);
  END IF;

  -- ── 2. Controles ──
  IF v.estado = 'esperada' THEN
    RAISE EXCEPTION 'Es una nota de crédito esperada: se registra desde "NC pendientes" cuando llega el documento, no se valida acá.'
      USING ERRCODE = 'P0001', DETAIL = 'nc_esperada';
  END IF;

  -- Un remito NO se valida (decisión de Juan, 17/11): solo trae cantidades. Validar es dar
  -- por buenas cantidades Y precios, y eso lo hace la factura.
  IF v.tipo_comprobante = 'Remito' THEN
    RAISE EXCEPTION 'Un remito no se valida: solo sirve para controlar las cantidades contra lo recibido. Para controlar los precios y registrar la deuda hace falta la factura.'
      USING ERRCODE = 'P0001', DETAIL = 'remito_no_se_valida';
  END IF;

  SELECT count(*) INTO v_sin_articulo
    FROM comprobantes_compra_detalle
   WHERE comprobante_id = p_comprobante_id AND articulo_id IS NULL
     -- los renglones marcados "no es mercadería" (flete, etc.) quedan en el comprobante y no frenan
     AND coalesce(match_estado, '') <> 'no_mercaderia';
  IF v_sin_articulo > 0 THEN
    RAISE EXCEPTION 'Hay % renglón(es) del comprobante sin vincular a un artículo. Vinculalos (o marcá "No es mercadería" los que sean flete u otro concepto) en "Revisar matches" antes de validar.', v_sin_articulo
      USING ERRCODE = 'P0001', DETAIL = 'lineas_sin_articulo';
  END IF;

  v_total       := coalesce(v.total_factura_declarado, 0);
  v_credito     := v.tipo_comprobante IN ('NC', 'NCA', 'NCB', 'NCC', 'Reversa');
  v_debito_nota := v.tipo_comprobante IN ('ND', 'NDA', 'NDB', 'NDC');
  v_documental  := v.tipo_comprobante = 'Remito';

  IF NOT v_documental AND v_total <= 0 THEN
    RAISE EXCEPTION 'El comprobante % % no tiene total. Cargale el total (lápiz de editar) antes de validarlo; si es solo un remito, cambiale el tipo a Remito (un remito no se valida).', v.tipo_comprobante, v.numero_comprobante
      USING ERRCODE = 'P0001', DETAIL = 'sin_total';
  END IF;

  -- ── E-46 (regla de Juan, 17/11): los renglones tienen que sumar lo que dice el comprobante ──
  -- Misma cuenta que lib/compras/control-suma.ts. Se toleran centavos: la diferencia tiene que
  -- ser MENOR a $1 (20 contra 21 ya es un error).
  -- Lo que una factura trae además del neto. La retención de Ganancias NO va: no viene en la
  -- factura, la hacemos nosotros al pagar.
  v_impuestos := coalesce(v.total_iva, 0) + coalesce(v.percepcion_iva_monto, 0) + coalesce(v.percepcion_iibb_monto, 0)
               + coalesce(v.impuestos_internos, 0) + coalesce(v.otros_impuestos, 0);
  v_neto_comp := round(CASE WHEN coalesce(v.total_neto, 0) > 0 THEN v.total_neto ELSE v_total - v_impuestos END, 2);

  -- B. Primero la cabecera: neto + impuestos contra el total. Si no cierra, lo que está mal son
  --    los datos del comprobante, no los renglones.
  IF v_total > 0 AND abs(round(v_neto_comp + v_impuestos, 2) - v_total) >= 1 THEN
    RAISE EXCEPTION 'Los datos del comprobante no cierran: neto $% más impuestos $% da $% y el total dice $%. Corregí neto, IVA, percepciones u otros impuestos. No se validó.', v_neto_comp, round(v_impuestos, 2), round(v_neto_comp + v_impuestos, 2), v_total
      USING ERRCODE = 'P0001', DETAIL = 'renglones_no_suman';
  END IF;

  -- A. Renglones contra el neto. El importe de un renglón se arma de dos formas (cantidad × lista ×
  --    descuentos redondeado una vez, o cantidad × neto por unidad ya redondeado); con muchas
  --    unidades difieren en centavos. Pasa si CUALQUIERA de las dos cierra.
  IF v.tipo_comprobante IN ('FA', 'FB', 'FC', 'Adquisicion', 'ADQ') THEN
    -- Los descuentos del renglón se aplican como dice la ficha del proveedor: en cascada (uno sobre
    -- el otro) o sobre la lista (se suman). Sin dato: en cascada.
    SELECT coalesce(pr.tipo_descuento, 'cascada') INTO v_tipo_dto
      FROM proveedores pr
     WHERE pr.id = coalesce(v.proveedor_id, (SELECT oc.proveedor_id FROM ordenes_compra oc WHERE oc.id = v.orden_compra_id));
    v_tipo_dto := coalesce(v_tipo_dto, 'cascada');
    SELECT coalesce(sum(round(coalesce(d.cantidad_facturada, 0) * public.oc_neto_unitario(d.precio_unitario, d.descuento1, d.descuento2, d.descuento3, d.descuento4, v_tipo_dto), 2)), 0),
           coalesce(sum(round(coalesce(d.cantidad_facturada, 0) * round(public.oc_neto_unitario(d.precio_unitario, d.descuento1, d.descuento2, d.descuento3, d.descuento4, v_tipo_dto), 2), 2)), 0)
      INTO v_suma, v_suma2
      FROM comprobantes_compra_detalle d
     WHERE d.comprobante_id = p_comprobante_id;
    v_dto := coalesce(v.descuento_fuera_factura, 0);
    IF NOT (
         abs(v_suma - v_neto_comp) < 1 OR abs(v_suma2 - v_neto_comp) < 1
         OR (v_dto > 0 AND v_dto <= 100 AND (abs(round(v_suma * (1 - v_dto / 100.0), 2) - v_neto_comp) < 1
                                             OR abs(round(v_suma2 * (1 - v_dto / 100.0), 2) - v_neto_comp) < 1))
       ) THEN
      RAISE EXCEPTION 'Los renglones suman $% y la factura dice $%: hay $% de diferencia. Revisá los renglones leídos. No se validó.', v_suma, v_neto_comp, abs(v_neto_comp - v_suma)
        USING ERRCODE = 'P0001', DETAIL = 'renglones_no_suman';
    END IF;
  END IF;

  v_oc := v.orden_compra_id;
  IF v_oc IS NOT NULL THEN
    -- Dos comprobantes de la misma OC validándose a la vez: de a uno (la provisión es compartida)
    SELECT proveedor_id, numero_orden INTO v_prov, v_numero_oc FROM ordenes_compra WHERE id = v_oc FOR UPDATE;
  END IF;
  v_prov := coalesce(v.proveedor_id, v_prov);
  v_numero_oc := coalesce(v_numero_oc, p_plan ->> 'numero_orden');
  v_sufijo_oc := CASE WHEN v_oc IS NOT NULL THEN ' — OC ' || coalesce(v_numero_oc, '') ELSE '' END;

  IF NOT v_documental AND v_prov IS NULL THEN
    RAISE EXCEPTION 'El comprobante % % no tiene proveedor: no se puede registrar la deuda. Asignale el proveedor antes de validar.', v.tipo_comprobante, v.numero_comprobante
      USING ERRCODE = 'P0001', DETAIL = 'sin_proveedor';
  END IF;

  UPDATE comprobantes_compra
     SET estado = 'validado',
         saldo_pendiente = CASE WHEN v_credito THEN -v_total ELSE v_total END,
         estado_pago = 'pendiente'
   WHERE id = p_comprobante_id;
  PERFORM public.comprobante_compra_marcar_validador(p_comprobante_id, p_usuario_id);

  -- ── 4. Movimiento en la cuenta corriente del proveedor ──
  -- Con o sin orden de compra (decisión de Juan, 16/11: un comprobante sin OC también es deuda).
  IF v_prov IS NOT NULL THEN
    v_fecha := CASE WHEN v.fecha_comprobante IS NOT NULL
                    THEN (v.fecha_comprobante::date + time '12:00') AT TIME ZONE 'America/Argentina/Buenos_Aires'
                    ELSE now() END;
    v_desc := v.tipo_comprobante || ' ' || v.numero_comprobante || v_sufijo_oc;

    -- ¿Ya está en la cuenta corriente? (validación anterior a medias)
    SELECT id INTO v_mov FROM cuenta_corriente_proveedores
     WHERE referencia_tipo = 'comprobante_compra' AND referencia_id = p_comprobante_id
     ORDER BY created_at LIMIT 1;

    -- ¿Entró por mail? El procesador de mails ya dejó la deuda en la cuenta corriente
    -- (convierte la provisión de la OC en "factura", o crea un movimiento 'gmail') sin
    -- vincularla al comprobante. Cuál es ese movimiento lo decide el servidor ANTES de
    -- llamar (por número normalizado; si es ambiguo no llama: frena con un mensaje) y lo
    -- manda en p_plan.movimiento_adoptar. Acá se bloquea, se comprueba y se adopta.
    v_adoptar := nullif(p_plan ->> 'movimiento_adoptar', '')::uuid;
    IF v_mov IS NULL AND v_adoptar IS NOT NULL THEN
      SELECT id INTO v_mov FROM cuenta_corriente_proveedores
       WHERE id = v_adoptar
         AND proveedor_id = v_prov
         AND tipo_movimiento IN ('factura', 'nota_credito', 'nota_debito')
         AND (referencia_tipo IN ('orden_compra', 'gmail')
              -- (19/11) o el de un comprobante que se eliminó sin deshacer su deuda (huérfano):
              -- el servidor (buscarMovimientoPrevio) ya comprobó que es de este comprobante
              OR (referencia_tipo = 'comprobante_compra'
                  AND NOT EXISTS (SELECT 1 FROM comprobantes_compra c2
                                   WHERE c2.id = cuenta_corriente_proveedores.referencia_id)))
         FOR UPDATE;
      IF v_mov IS NULL THEN
        RAISE EXCEPTION 'El movimiento de la cuenta corriente que correspondía a este comprobante cambió mientras se validaba. No se validó nada: volvé a intentar.'
          USING ERRCODE = 'P0001', DETAIL = 'movimiento_cambio';
      END IF;
    END IF;

    -- Movimiento que ya existía (validación a medias o entró por mail): queda vinculado al
    -- comprobante y con sus datos de hoy. No se crea otro.
    IF v_mov IS NOT NULL THEN
      UPDATE cuenta_corriente_proveedores
         SET referencia_tipo = 'comprobante_compra', referencia_id = p_comprobante_id,
             tipo_movimiento = CASE WHEN v_credito THEN 'nota_credito' WHEN v_debito_nota THEN 'nota_debito' ELSE 'factura' END,
             monto = CASE WHEN v_credito THEN -v_total ELSE v_total END,
             descripcion = v_desc, numero_comprobante = v.numero_comprobante,
             tipo_comprobante = v.tipo_comprobante, fecha = v_fecha, updated_at = now()
       WHERE id = v_mov;
    END IF;

    IF v_mov IS NULL THEN
      INSERT INTO cuenta_corriente_proveedores (
        proveedor_id, tipo_movimiento, monto, descripcion,
        referencia_id, referencia_tipo, numero_comprobante, tipo_comprobante, fecha
      ) VALUES (
        v_prov,
        CASE WHEN v_credito THEN 'nota_credito' WHEN v_debito_nota THEN 'nota_debito' ELSE 'factura' END,
        CASE WHEN v_credito THEN -v_total ELSE v_total END,
        v_desc, p_comprobante_id, 'comprobante_compra', v.numero_comprobante, v.tipo_comprobante, v_fecha
      ) RETURNING id INTO v_mov;
      v_mov_nuevo := true;
    END IF;

    -- ── 5. Provisión de la OC (solo la tocan los comprobantes de DEUDA) ──
    -- Una nota de débito NO es la factura de la orden: no baja la provisión.
    -- SOLO si el movimiento de deuda nació en ESTA validación (v_mov_nuevo). Si ya existía —una
    -- factura que entró por mail: el procesador ya bajó la provisión al dejar la deuda, o la
    -- convirtió entera— no se vuelve a restar: se restaría dos veces lo mismo.
    IF NOT v_credito AND NOT v_debito_nota AND v_oc IS NOT NULL AND v_mov_nuevo THEN
      SELECT count(*) INTO v_otros
        FROM comprobantes_compra
       WHERE orden_compra_id = v_oc
         AND id <> p_comprobante_id
         AND estado NOT IN ('validado', 'cerrado', 'esperada')
         AND tipo_comprobante NOT IN ('Remito', 'NC', 'NCA', 'NCB', 'NCC', 'Reversa')
         -- solo los del mismo canal: una adquisición (sin factura) no espera a una factura ni al revés
         AND (tipo_comprobante IN ('Adquisicion', 'ADQ')) = (p_plan ->> 'canal' = 'negro');

      v_restante := v_total;
      v_provision := 'sin_provision';
      FOR v_prov_row IN
        SELECT id, monto FROM cuenta_corriente_proveedores
         WHERE referencia_tipo = 'orden_compra' AND referencia_id = v_oc AND tipo_movimiento = 'orden_compra'
           -- Una orden mixta tiene DOS provisiones (con factura / sin factura): este comprobante baja
           -- solo la de su canal. Las provisiones viejas, sin canal, se bajan como antes.
           AND (canal IS NULL OR canal = CASE WHEN p_plan ->> 'canal' = 'negro' THEN 'negro' ELSE 'blanco' END)
         ORDER BY created_at
           FOR UPDATE
      LOOP
        EXIT WHEN v_restante <= 0.01;
        IF v_prov_row.monto - v_restante <= 0.01 THEN
          -- Este comprobante cubre la provisión: se va. (Antes también se iba entera cuando no había
          -- otro comprobante cargado sin validar, aunque este fuera por una parte de la orden.)
          DELETE FROM cuenta_corriente_proveedores WHERE id = v_prov_row.id;
          v_restante := greatest(0, v_restante - v_prov_row.monto);
          v_provision := 'eliminada';
        ELSE
          -- La provisión baja solo por lo facturado: el resto sigue siendo deuda estimada
          UPDATE cuenta_corriente_proveedores
             SET monto = round(v_prov_row.monto - v_restante, 2),
                 descripcion = 'Provisión OC: ' || coalesce(v_numero_oc, '') || ' (resto sin facturar)',
                 updated_at = now()
           WHERE id = v_prov_row.id;
          v_restante := 0;
          v_provision := 'reducida';
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- ── 6. Vencimiento (solo deuda) ──
  IF NOT v_credito THEN
    v_fecha_venc  := coalesce(v.fecha_vencimiento::date, nullif(p_plan ->> 'fecha_vencimiento', '')::date);
    v_fecha_valid := nullif(p_plan ->> 'fecha_validez', '')::date;
    v_canal := CASE WHEN p_plan ->> 'canal' = 'negro' THEN 'negro' ELSE 'blanco' END;
    -- Pagos acordados (lib/compras/acuerdo-pago.ts): uno solo, o uno por cuota "30/60/90"
    v_pagos := CASE WHEN jsonb_typeof(p_plan -> 'pagos') = 'array' AND jsonb_array_length(p_plan -> 'pagos') > 0
                    THEN p_plan -> 'pagos' ELSE NULL END;
    IF v_fecha_venc IS NULL AND v_pagos IS NOT NULL THEN
      v_fecha_venc := nullif(v_pagos -> 0 ->> 'fecha', '')::date;
    END IF;

    IF v_fecha_venc IS NOT NULL AND v.fecha_vencimiento IS NULL THEN
      UPDATE comprobantes_compra SET fecha_vencimiento = v_fecha_venc WHERE id = p_comprobante_id;
    END IF;

    -- Los vencimientos que ya existen NO se tocan (son las anotaciones reales de Juan)
    SELECT id, monto INTO v_venc, v_venc_monto FROM vencimientos
     WHERE estado <> 'cancelado'
       AND ((referencia_tipo = 'comprobante_compra' AND referencia_id = p_comprobante_id)
         OR (v_mov IS NOT NULL AND referencia_tipo = 'cuenta_corriente' AND referencia_id = v_mov))
     LIMIT 1;

    -- ── 6.b Vencimientos que ya estaban ANOTADOS A MANO en el calendario (E-102) ──
    -- Quien valida dijo "es esta factura": en vez de crear otro vencimiento (la deuda quedaba dos
    -- veces en el calendario), el anotado a mano pasa a ser el vencimiento del comprobante. Se
    -- conservan su fecha y su concepto (es la anotación de Juan). NUNCA se borra nada.
    --   · Uno solo elegido: queda por el TOTAL del comprobante (si el importe anotado era otro, se
    --     ajusta y queda dicho en observaciones). No se crean cuotas: manda lo que ya estaba anotado.
    --   · Varios elegidos (las cuotas ya estaban anotadas): quedan todos enlazados con su importe; si
    --     entre todos no suman el total, la diferencia va al último.
    v_enlazar := CASE WHEN jsonb_typeof(p_plan -> 'enlazar_vencimientos') = 'array' AND jsonb_array_length(p_plan -> 'enlazar_vencimientos') > 0
                      THEN p_plan -> 'enlazar_vencimientos' ELSE NULL END;
    IF v_venc IS NULL AND v_enlazar IS NOT NULL THEN
      FOR v_e IN
        SELECT ve.* FROM vencimientos ve
         WHERE ve.id IN (SELECT x::uuid FROM jsonb_array_elements_text(v_enlazar) x)
         ORDER BY ve.fecha_vencimiento, ve.id
           FOR UPDATE
      LOOP
        -- Tiene que seguir siendo un vencimiento a mano, pendiente, de este proveedor y sin enlazar
        IF v_e.proveedor_id IS DISTINCT FROM v_prov
           OR v_e.estado NOT IN ('pendiente', 'vencido')
           OR coalesce(v_e.es_estimado, false)
           OR (v_e.referencia_id IS NOT NULL AND coalesce(v_e.referencia_tipo, '') IN ('cuenta_corriente', 'comprobante_compra', 'orden_compra')) THEN
          RAISE EXCEPTION 'El vencimiento anotado a mano que se quiso enlazar cambió mientras se validaba (se pagó, se canceló o ya está enlazado a otro comprobante). No se validó nada: volvé a intentar.'
            USING ERRCODE = 'P0001', DETAIL = 'vencimiento_cambio';
        END IF;
        UPDATE vencimientos
           SET referencia_id = coalesce(v_mov, p_comprobante_id),
               referencia_tipo = CASE WHEN v_mov IS NOT NULL THEN 'cuenta_corriente' ELSE 'comprobante_compra' END,
               canal = coalesce(canal, v_canal),
               observaciones = left(coalesce(nullif(observaciones, '') || ' · ', '')
                 || 'Estaba anotado a mano; se enlazó al validar ' || v.tipo_comprobante || ' ' || v.numero_comprobante || v_sufijo_oc || '.', 1000),
               actualizado_por = coalesce(p_usuario_id, actualizado_por),
               updated_at = now()
         WHERE id = v_e.id;
        v_n_enl := v_n_enl + 1;
        v_suma_enl := v_suma_enl + coalesce(v_e.monto, 0);
        v_ultimo_enl := v_e.id;
        IF v_venc IS NULL THEN v_venc := v_e.id; END IF;
      END LOOP;
      IF v_n_enl = 0 THEN
        RAISE EXCEPTION 'El vencimiento anotado a mano que se quiso enlazar ya no existe. No se validó nada: volvé a intentar.'
          USING ERRCODE = 'P0001', DETAIL = 'vencimiento_cambio';
      END IF;
      -- La deuda es el total del comprobante: si lo anotado no da eso, se ajusta el último
      IF abs(v_suma_enl - v_total) > 0.01 THEN
        SELECT monto INTO v_monto_enl FROM vencimientos WHERE id = v_ultimo_enl;
        IF round(v_monto_enl + (v_total - v_suma_enl), 2) <= 0 THEN
          RAISE EXCEPTION 'Los vencimientos elegidos suman $% y el comprobante es por $%: no pueden ser todos de esta factura. No se validó nada.', v_suma_enl, v_total
            USING ERRCODE = 'P0001', DETAIL = 'vencimientos_de_mas';
        END IF;
        UPDATE vencimientos
           SET monto = round(v_monto_enl + (v_total - v_suma_enl), 2),
               observaciones = left(coalesce(nullif(observaciones, '') || ' · ', '')
                 || 'Importe ajustado de $' || v_monto_enl::text || ' a $' || round(v_monto_enl + (v_total - v_suma_enl), 2)::text
                 || ': el comprobante validado es por $' || v_total::text || '.', 1000),
               updated_at = now()
         WHERE id = v_ultimo_enl;
      END IF;
      v_enlazado := true;
      v_venc_monto := v_total;
    END IF;

    IF v_venc IS NULL AND v_fecha_venc IS NOT NULL THEN
     BEGIN
      -- Sin lista de pagos (servidor anterior): un solo vencimiento por el total, como siempre
      IF v_pagos IS NULL THEN
        v_pagos := jsonb_build_array(jsonb_build_object(
          'fecha', v_fecha_venc, 'monto', v_total,
          'forma_pago', p_plan ->> 'forma_pago', 'modalidad', p_plan ->> 'modalidad', 'fecha_validez', p_plan ->> 'fecha_validez'));
      END IF;
      v_n_pagos := jsonb_array_length(v_pagos);
      v_resto := v_total;
      FOR v_i IN 0 .. v_n_pagos - 1 LOOP
        v_pago := v_pagos -> v_i;
        -- La última cuota se lleva el resto: las cuotas SIEMPRE suman el total del comprobante
        v_monto := CASE WHEN v_i = v_n_pagos - 1 THEN v_resto
                        ELSE round(coalesce(nullif(v_pago ->> 'monto', '')::numeric, v_total / v_n_pagos), 2) END;
        IF v_monto <= 0 THEN
          RAISE EXCEPTION 'las cuotas no suman el total del comprobante';
        END IF;
        v_resto := v_resto - v_monto;
        INSERT INTO vencimientos (
          proveedor_id, tipo, canal, concepto, monto, fecha_vencimiento, estado,
          forma_pago, modalidad, fecha_validez, referencia_id, referencia_tipo
        ) VALUES (
          v_prov, 'factura', v_canal,
          v.tipo_comprobante || ' ' || v.numero_comprobante || v_sufijo_oc
            || CASE WHEN v_n_pagos > 1 THEN ' — cuota ' || (v_i + 1) || '/' || v_n_pagos ELSE '' END,
          v_monto, coalesce(nullif(v_pago ->> 'fecha', '')::date, v_fecha_venc), 'pendiente',
          nullif(v_pago ->> 'forma_pago', ''), nullif(v_pago ->> 'modalidad', ''), nullif(v_pago ->> 'fecha_validez', '')::date,
          coalesce(v_mov, p_comprobante_id),
          CASE WHEN v_mov IS NOT NULL THEN 'cuenta_corriente' ELSE 'comprobante_compra' END
        ) RETURNING id INTO v_venc_i;
        IF v_i = 0 THEN v_venc := v_venc_i; END IF;
        v_creados := v_creados + 1;
      END LOOP;
      v_venc_nuevo := true;
      v_venc_monto := v_total;
     EXCEPTION WHEN OTHERS THEN
      -- Deuda sin vencimiento = pago que se olvida. Todo o nada: se deshace la validación entera.
      RAISE EXCEPTION 'No se pudo crear el vencimiento del comprobante (%). No se validó nada: avisá a sistemas con este mensaje.', SQLERRM
        USING ERRCODE = 'P0001', DETAIL = 'vencimiento_fallido';
     END;
    END IF;

    -- ── 7. El vencimiento ESTIMADO de la orden deja lugar al real ──
    -- SOLO cuando el vencimiento real nació en ESTA validación (v_venc_nuevo): es el único lugar
    -- donde nace el vencimiento de una factura de una orden, así que el estimado se descuenta una
    -- sola vez. Si el vencimiento ya existía (uno cargado a mano, o de una factura que entró por
    -- mail antes de este cambio), el estimado no se toca: se quita al finalizar la orden.
    -- Una nota de débito tampoco lo descuenta: no es la factura de la mercadería pedida.
    -- Baja los estimados de ESE canal por el importe del comprobante, del más próximo al más
    -- lejano, y borra los que llegan a cero: si la orden se factura en partes, queda estimado solo
    -- lo que falta. No toca ningún vencimiento que no sea un estimado de esta orden.
    IF v_oc IS NOT NULL AND v_venc IS NOT NULL AND (v_venc_nuevo OR v_enlazado) AND NOT v_debito_nota THEN
      v_estimados := public.oc_vencimiento_estimado_reemplazar(v_oc, v_canal, v_total);
    END IF;

    -- ── 8. Lo que ya se pagó antes de validar ──
    -- Una factura que entró por mail deja la deuda en la cuenta corriente y se puede pagar con una
    -- orden de pago antes de validarla. Los vencimientos que acaban de nacer salen por el total:
    -- se acomodan al SALDO real del movimiento (cuotas más próximas primero), con la misma función
    -- que usan las órdenes de pago. p_op_id va con un id que no es de ninguna orden: así la cuota
    -- que queda cancelada se anota a nombre de la orden que de verdad pagó ese comprobante.
    IF v_mov IS NOT NULL AND (v_venc_nuevo OR v_enlazado) THEN
      v_saldo := public.cc_proveedor_saldo_movimiento(v_mov);
      IF v_saldo IS NOT NULL AND v_saldo < v_total - 0.01 THEN
        v_pagado_antes := round(v_total - greatest(v_saldo, 0), 2);
        PERFORM public.op_vencimientos_sincronizar_movimiento(v_mov, '00000000-0000-0000-0000-000000000000'::uuid, false);
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true, 'ya_validado', false, 'comprobante_id', p_comprobante_id,
    'sin_deuda', false,
    'movimiento_cc_id', v_mov, 'movimiento_cc_nuevo', v_mov_nuevo,
    'vencimiento_id', v_venc, 'vencimiento_nuevo', v_venc_nuevo, 'vencimiento_monto', v_venc_monto,
    'sin_vencimiento', (NOT v_credito AND v_venc IS NULL),
    'provision', v_provision,
    'vencimientos_creados', v_creados, 'estimados_reemplazados', v_estimados,
    'pagado_antes', v_pagado_antes,
    'vencimientos_enlazados', v_n_enl
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.comprobante_compra_validar(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.comprobante_compra_validar(uuid, uuid, jsonb) TO service_role;

-- ── 3. Cancelar / editar la orden: un borrador con conteos también frena ─────────────────
-- Iguales a las vigentes salvo la condición marcada (19/11).
CREATE OR REPLACE FUNCTION public.oc_cancelar(p_orden_id uuid, p_usuario_id uuid, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  o       record;
  v_comp  int;
BEGIN
  SELECT * INTO o FROM ordenes_compra WHERE id = p_orden_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La orden no existe (puede que la hayan eliminado).' USING ERRCODE = 'P0002', DETAIL = 'no_encontrada';
  END IF;
  IF o.estado = 'cancelada' THEN
    RETURN jsonb_build_object('success', true, 'ya_cancelada', true, 'orden_id', p_orden_id, 'numero_orden', o.numero_orden);
  END IF;
  IF o.estado NOT IN ('pendiente', 'enviada', 'confirmada', 'en_camino') THEN
    RAISE EXCEPTION 'La orden % está % : ya no se puede cancelar.', o.numero_orden, replace(o.estado, '_', ' ')
      USING ERRCODE = 'P0001', DETAIL = 'estado_no_cancelable';
  END IF;
  IF EXISTS (SELECT 1 FROM recepciones r WHERE r.orden_compra_id = p_orden_id
         AND (r.estado IN ('en_proceso', 'finalizada')
             -- (19/11) un borrador (lo crea la oficina al subir la factura) en el que el depósito ya contó algo
             OR (r.estado = 'borrador' AND EXISTS (
                   SELECT 1 FROM recepciones_items ri
                    WHERE ri.recepcion_id = r.id
                      AND (coalesce(ri.cantidad_fisica, 0) > 0 OR coalesce(ri.estado_linea, 'pendiente') <> 'pendiente'))))) THEN
    RAISE EXCEPTION 'La orden % ya tiene una recepción en depósito: no se puede cancelar.', o.numero_orden
      USING ERRCODE = 'P0001', DETAIL = 'con_recepcion';
  END IF;
  SELECT count(*) INTO v_comp FROM comprobantes_compra c WHERE c.orden_compra_id = p_orden_id AND c.estado <> 'esperada';
  IF v_comp > 0 THEN
    RAISE EXCEPTION 'La orden % tiene % comprobante(s) cargado(s). Eliminalos desde la verificación antes de cancelarla.', o.numero_orden, v_comp
      USING ERRCODE = 'P0001', DETAIL = 'con_comprobantes';
  END IF;

  UPDATE ordenes_compra SET
    estado = 'cancelada', cancelada_at = now(), cancelada_por = p_usuario_id,
    motivo_cancelacion = nullif(trim(coalesce(p_motivo, '')), ''), updated_at = now()
  WHERE id = p_orden_id;

  -- Recepciones en borrador (las crea la oficina al subir un documento): quedan canceladas
  UPDATE recepciones SET estado = 'cancelada', updated_at = now()
   WHERE orden_compra_id = p_orden_id AND estado = 'borrador';

  -- Con la orden ya cancelada, cada "sincronizar" solo limpia lo suyo
  PERFORM public.oc_provision_sincronizar(p_orden_id);
  PERFORM public.oc_vencimientos_estimados_sincronizar(p_orden_id, p_usuario_id);
  PERFORM public.oc_kardex_pendiente_sincronizar(p_orden_id, p_usuario_id);

  RETURN jsonb_build_object('success', true, 'ya_cancelada', false, 'orden_id', p_orden_id, 'numero_orden', o.numero_orden,
                            'estaba_enviada', o.enviada_at IS NOT NULL);
END;
$function$;

REVOKE ALL ON FUNCTION public.oc_cancelar(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.oc_cancelar(uuid, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.oc_guardar(p_orden_id uuid, p_usuario_id uuid, p_datos jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_items      jsonb := coalesce(p_datos -> 'items', '[]'::jsonb);
  v_prov       uuid  := nullif(p_datos ->> 'proveedor_id', '')::uuid;
  v_clave      uuid  := nullif(p_datos ->> 'clave', '')::uuid;
  v_fecha_est  date  := nullif(p_datos ->> 'fecha_estimada_recepcion', '')::date;
  v_acuerdo    jsonb := CASE WHEN jsonb_typeof(p_datos -> 'acuerdo_pago') = 'object' THEN p_datos -> 'acuerdo_pago' ELSE NULL END;
  v_mixto      numeric := CASE WHEN coalesce(p_datos ->> 'mixto_pct_factura', '') ~ '^[0-9]+(\.[0-9]+)?$'
                                AND (p_datos ->> 'mixto_pct_factura')::numeric <= 100
                               THEN (p_datos ->> 'mixto_pct_factura')::numeric ELSE NULL END;
  v_id         uuid;
  v_numero     text;
  v_nueva      boolean := false;
  o            record;
  v_n          int;
  v_malos      int;
  v_seq        bigint;
  t            record;
  v_venc       int;
  v_kardex     int;
BEGIN
  -- ── Controles de lo que llega ──
  IF jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'La orden no tiene artículos con cantidad.' USING ERRCODE = 'P0001', DETAIL = 'sin_items';
  END IF;

  SELECT count(*) INTO v_malos FROM jsonb_array_elements(v_items) e
   WHERE coalesce(e ->> 'articulo_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  IF v_malos > 0 THEN
    RAISE EXCEPTION 'Hay % renglón(es) sin artículo vinculado. Vinculalos a un artículo del catálogo o sacalos de la orden.', v_malos
      USING ERRCODE = 'P0001', DETAIL = 'items_sin_articulo';
  END IF;

  SELECT count(*) INTO v_malos FROM jsonb_array_elements(v_items) e
   WHERE NOT (coalesce(e ->> 'cantidad_pedida', '') ~ '^[0-9]+(\.[0-9]+)?$' AND (e ->> 'cantidad_pedida')::numeric > 0);
  IF v_malos > 0 THEN
    RAISE EXCEPTION 'Hay % renglón(es) con cantidad en cero o inválida.', v_malos USING ERRCODE = 'P0001', DETAIL = 'cantidad_invalida';
  END IF;

  SELECT count(*) INTO v_malos FROM jsonb_array_elements(v_items) e
   WHERE NOT (coalesce(e ->> 'precio_unitario', '0') ~ '^[0-9]+(\.[0-9]+)?$');
  IF v_malos > 0 THEN
    RAISE EXCEPTION 'Hay % renglón(es) con el precio inválido.', v_malos USING ERRCODE = 'P0001', DETAIL = 'precio_invalido';
  END IF;

  SELECT count(*) INTO v_malos FROM jsonb_array_elements(v_items) e, LATERAL (VALUES ('descuento1'), ('descuento2'), ('descuento3'), ('descuento4')) k(c)
   WHERE NOT (coalesce(nullif(e ->> k.c, ''), '0') ~ '^[0-9]+(\.[0-9]+)?$' AND coalesce(nullif(e ->> k.c, ''), '0')::numeric <= 100);
  IF v_malos > 0 THEN
    RAISE EXCEPTION 'Hay descuentos inválidos (tienen que estar entre 0 y 100).' USING ERRCODE = 'P0001', DETAIL = 'descuento_invalido';
  END IF;

  SELECT count(*) INTO v_malos FROM (
    SELECT lower(e ->> 'articulo_id') FROM jsonb_array_elements(v_items) e GROUP BY 1 HAVING count(*) > 1
  ) rep;
  IF v_malos > 0 THEN
    RAISE EXCEPTION 'Hay % artículo(s) repetido(s) en la orden. Dejá un solo renglón por artículo.', v_malos
      USING ERRCODE = 'P0001', DETAIL = 'articulo_repetido';
  END IF;

  SELECT count(*) INTO v_malos FROM jsonb_array_elements(v_items) e
   WHERE NOT EXISTS (SELECT 1 FROM articulos a WHERE a.id = (e ->> 'articulo_id')::uuid);
  IF v_malos > 0 THEN
    RAISE EXCEPTION 'Hay % artículo(s) de la orden que ya no existe(n) en el catálogo.', v_malos
      USING ERRCODE = 'P0001', DETAIL = 'articulo_inexistente';
  END IF;

  IF p_orden_id IS NULL THEN
    -- ── Crear ──
    IF v_prov IS NULL OR NOT EXISTS (SELECT 1 FROM proveedores WHERE id = v_prov) THEN
      RAISE EXCEPTION 'Elegí el proveedor de la orden.' USING ERRCODE = 'P0001', DETAIL = 'sin_proveedor';
    END IF;

    -- Doble click / reintento: la misma clave devuelve la misma orden
    IF v_clave IS NOT NULL THEN
      SELECT id, numero_orden INTO v_id, v_numero FROM ordenes_compra WHERE clave_creacion = v_clave;
      IF FOUND THEN
        RETURN jsonb_build_object('success', true, 'repetida', true, 'orden_id', v_id, 'numero_orden', v_numero);
      END IF;
    END IF;

    -- Número: secuencia (sin carreras). Si alguien cargó a mano un número más alto, se saltea.
    LOOP
      v_seq := nextval('public.ordenes_compra_numero_seq');
      v_numero := 'OC-' || lpad(v_seq::text, 6, '0');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM ordenes_compra WHERE numero_orden = v_numero);
    END LOOP;

    BEGIN
      INSERT INTO ordenes_compra (
        numero_orden, proveedor_id, fecha_orden, fecha_estimada_recepcion, estado,
        observaciones, condicion_pago, acuerdo_pago, mixto_pct_factura, usuario_creador, creado_por, clave_creacion
      ) VALUES (
        v_numero, v_prov, now(), v_fecha_est, 'pendiente',
        nullif(trim(coalesce(p_datos ->> 'observaciones', '')), ''),
        nullif(left(trim(coalesce(p_datos ->> 'condicion_pago', '')), 100), ''),
        v_acuerdo, v_mixto, p_usuario_id::text, p_usuario_id, v_clave
      ) RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
      -- otra llamada con la misma clave ganó la carrera
      SELECT id, numero_orden INTO v_id, v_numero FROM ordenes_compra WHERE clave_creacion = v_clave;
      IF FOUND THEN
        RETURN jsonb_build_object('success', true, 'repetida', true, 'orden_id', v_id, 'numero_orden', v_numero);
      END IF;
      RAISE;
    END;
    v_nueva := true;
  ELSE
    -- ── Editar ──
    SELECT * INTO o FROM ordenes_compra WHERE id = p_orden_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'La orden no existe (puede que la hayan eliminado).' USING ERRCODE = 'P0002', DETAIL = 'no_encontrada';
    END IF;
    IF o.estado NOT IN ('pendiente', 'enviada', 'confirmada', 'en_camino') THEN
      RAISE EXCEPTION 'La orden % está % y ya no se puede modificar.', o.numero_orden, replace(o.estado, '_', ' ')
        USING ERRCODE = 'P0001', DETAIL = 'estado_no_editable';
    END IF;
    IF v_prov IS NOT NULL AND v_prov <> o.proveedor_id THEN
      RAISE EXCEPTION 'No se puede cambiar el proveedor de una orden ya creada. Cancelala y hacé una nueva.'
        USING ERRCODE = 'P0001', DETAIL = 'proveedor_cambiado';
    END IF;
    IF EXISTS (SELECT 1 FROM recepciones r WHERE r.orden_compra_id = p_orden_id
           AND (r.estado IN ('en_proceso', 'finalizada')
             -- (19/11) un borrador (lo crea la oficina al subir la factura) en el que el depósito ya contó algo
             OR (r.estado = 'borrador' AND EXISTS (
                   SELECT 1 FROM recepciones_items ri
                    WHERE ri.recepcion_id = r.id
                      AND (coalesce(ri.cantidad_fisica, 0) > 0 OR coalesce(ri.estado_linea, 'pendiente') <> 'pendiente'))))) THEN
      RAISE EXCEPTION 'La orden % ya tiene una recepción en depósito: no se puede modificar.', o.numero_orden
        USING ERRCODE = 'P0001', DETAIL = 'con_recepcion';
    END IF;
    -- Con un comprobante cargado (aunque no esté validado) la orden no se toca: la factura que
    -- entra por mail ya convirtió la provisión en deuda y creó su vencimiento; rehacer la
    -- provisión y los estimados duplicaría las dos cosas. Misma regla que oc_cancelar.
    IF EXISTS (SELECT 1 FROM comprobantes_compra c WHERE c.orden_compra_id = p_orden_id AND c.estado <> 'esperada') THEN
      RAISE EXCEPTION 'La orden % ya tiene comprobantes cargados: no se puede modificar. Si hay que cambiarla, eliminá primero los comprobantes desde la verificación.', o.numero_orden
        USING ERRCODE = 'P0001', DETAIL = 'con_comprobantes';
    END IF;

    v_id := p_orden_id;
    v_numero := o.numero_orden;
    v_prov := o.proveedor_id;

    UPDATE ordenes_compra SET
      observaciones            = nullif(trim(coalesce(p_datos ->> 'observaciones', '')), ''),
      fecha_estimada_recepcion = coalesce(v_fecha_est, fecha_estimada_recepcion),
      condicion_pago           = CASE WHEN p_datos ? 'condicion_pago' THEN nullif(left(trim(coalesce(p_datos ->> 'condicion_pago', '')), 100), '') ELSE condicion_pago END,
      acuerdo_pago             = CASE WHEN p_datos ? 'acuerdo_pago' THEN v_acuerdo ELSE acuerdo_pago END,
      mixto_pct_factura        = CASE WHEN p_datos ? 'mixto_pct_factura' THEN v_mixto ELSE mixto_pct_factura END,
      editada_at               = now(),
      editada_por              = p_usuario_id,
      updated_at               = now()
    WHERE id = v_id;

    DELETE FROM ordenes_compra_detalle WHERE orden_compra_id = v_id;
  END IF;

  -- ── Detalle (con la foto del artículo al momento de guardar) ──
  INSERT INTO ordenes_compra_detalle (
    orden_compra_id, articulo_id, cantidad_pedida, tipo_cantidad, precio_unitario,
    descuento1, descuento2, descuento3, descuento4,
    orden, iva_compras, unidades_por_bulto, precio_ficha, precio_neto_ficha
  )
  SELECT
    v_id, a.id, (e.item ->> 'cantidad_pedida')::numeric,
    CASE WHEN e.item ->> 'tipo_cantidad' = 'unidad' THEN 'unidad' ELSE 'bulto' END,
    coalesce(nullif(e.item ->> 'precio_unitario', ''), '0')::numeric,
    coalesce(nullif(e.item ->> 'descuento1', ''), '0')::numeric,
    coalesce(nullif(e.item ->> 'descuento2', ''), '0')::numeric,
    coalesce(nullif(e.item ->> 'descuento3', ''), '0')::numeric,
    coalesce(nullif(e.item ->> 'descuento4', ''), '0')::numeric,
    e.pos::int,
    coalesce(nullif(a.iva_compras, ''), 'factura'),
    CASE WHEN coalesce(a.unidades_por_bulto, 1) > 1 THEN a.unidades_por_bulto ELSE 1 END,
    a.precio_compra,
    public.oc_neto_unitario(a.precio_compra, a.descuento1, a.descuento2, a.descuento3, a.descuento4,
                            (SELECT p.tipo_descuento FROM proveedores p WHERE p.id = v_prov))
  FROM jsonb_array_elements(v_items) WITH ORDINALITY AS e(item, pos)
  JOIN articulos a ON a.id = (e.item ->> 'articulo_id')::uuid;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- ── Totales en la cabecera ──
  SELECT * INTO t FROM oc_totales(v_id);
  UPDATE ordenes_compra SET
    total_neto         = t.neto_blanco + t.neto_negro,
    total_iva          = t.iva,
    total_percepciones = t.percepciones,
    total_blanco       = t.total_blanco,
    total_negro        = t.total_negro,
    total_estimado     = t.total,
    cantidad_renglones = t.renglones
  WHERE id = v_id;

  -- ── Cuenta corriente, vencimientos estimados y stock en camino ──
  PERFORM public.oc_provision_sincronizar(v_id);
  v_venc   := public.oc_vencimientos_estimados_sincronizar(v_id, p_usuario_id);
  v_kardex := public.oc_kardex_pendiente_sincronizar(v_id, p_usuario_id);

  RETURN jsonb_build_object(
    'success', true, 'repetida', false, 'nueva', v_nueva,
    'orden_id', v_id, 'numero_orden', v_numero, 'renglones', v_n,
    'total_neto', t.neto_blanco + t.neto_negro, 'total_iva', t.iva, 'total_percepciones', t.percepciones,
    'total_blanco', t.total_blanco, 'total_negro', t.total_negro, 'total_estimado', t.total,
    'vencimientos_estimados', v_venc, 'kardex_pendiente', v_kardex
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.oc_guardar(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.oc_guardar(uuid, uuid, jsonb) TO service_role;


-- ════════════ 20261119p_listas_proveedor_sin_proveedor_y_aviso ════════════
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

