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
