-- ═════════════════════════════════════════════════════════════════════════════
-- Cuenta corriente del proveedor: UNA sola fuente de saldo
-- Prueba integral de ENTRADA, Tanda 1-D (17/11/2026): E-56.
--
-- Había dos saldos que podían no coincidir:
--   · el de la cuenta corriente (cuenta_corriente_proveedores + imputaciones_proveedores),
--     que es lo que muestra la pantalla y lo que valida la orden de pago;
--   · comprobantes_compra.saldo_pendiente, que cada función sumaba y restaba por su lado.
-- Y una nota de crédito descontada en una orden de pago bajaba el saldo del comprobante
-- pero en la cuenta corriente seguía figurando pendiente para siempre.
--
-- Regla desde ahora: la fuente es la CUENTA CORRIENTE.
--   saldo de una deuda   = su importe − lo imputado contra ella
--   saldo de un crédito  = su importe + lo que ya se usó (nunca pasa de 0)
-- comprobantes_compra.saldo_pendiente / estado_pago quedan como una COPIA de ese saldo:
-- cada vez que una orden de pago se confirma o se anula, se vuelven a leer de la cuenta
-- corriente (cc_proveedor_sincronizar_comprobante).
--
-- Piezas:
--   1. cc_proveedor_saldo_movimiento(mov)          → saldo de un movimiento, según la regla
--   2. cc_proveedor_sincronizar_comprobante(comp)  → copia el saldo al comprobante
--   3. op_asentar_creditos / op_sincronizar_saldos_comprobantes → las usa la orden de pago
--   4. op_confirmar v8 = cuerpo EXACTO de la v7 (20261117q) + dos líneas marcadas "v8"
--      op_anular v5    = cuerpo EXACTO de la v4 (20261117q) + una línea marcada "v5"
--   5. cc_proveedor_resincronizar_saldos(proveedor?) → para emparejar comprobantes viejos.
--      NO se ejecuta acá: cambia datos (solo saldo_pendiente / estado_pago de comprobantes
--      de compra, que son de prueba). Correrla a mano si se quiere, después de mirar el
--      control del final.
--
-- REQUIERE 20261117q_op_pago_parcial.sql. Generado por script desde esa versión.
-- Seguro de re-ejecutar. No toca datos al instalarse.
-- ═════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF to_regprocedure('public.op_vencimientos_sincronizar_movimiento(uuid, uuid, boolean)') IS NULL THEN
    RAISE EXCEPTION 'Falta aplicar ANTES la migración 20261117q_op_pago_parcial.sql. No se cambió nada.';
  END IF;
END $$;

-- ═══ 1. Saldo de un movimiento de la cuenta corriente ═══
CREATE OR REPLACE FUNCTION public.cc_proveedor_saldo_movimiento(p_movimiento_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN cc.monto >= 0 THEN
      round(cc.monto - COALESCE((SELECT sum(i.monto_imputado) FROM imputaciones_proveedores i
                                  WHERE i.id_movimiento_documento = cc.id), 0), 2)
    ELSE
      LEAST(0, round(cc.monto + COALESCE((SELECT sum(i.monto_imputado) FROM imputaciones_proveedores i
                                           WHERE i.id_movimiento_pago = cc.id OR i.id_movimiento_documento = cc.id), 0), 2))
  END
  FROM cuenta_corriente_proveedores cc WHERE cc.id = p_movimiento_id
$function$;

-- ═══ 2. Copiar el saldo de la cuenta corriente al comprobante ═══
-- Sin movimiento en la cuenta corriente (comprobante sin validar, NC esperada) no toca nada.
CREATE OR REPLACE FUNCTION public.cc_proveedor_sincronizar_comprobante(p_comprobante_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_saldo numeric;
  v_total numeric;
  v_n     int;
BEGIN
  SELECT count(*), COALESCE(sum(cc_proveedor_saldo_movimiento(cc.id)), 0), COALESCE(sum(cc.monto), 0)
  INTO v_n, v_saldo, v_total
  FROM cuenta_corriente_proveedores cc
  WHERE cc.referencia_tipo = 'comprobante_compra' AND cc.referencia_id = p_comprobante_id;
  IF v_n = 0 THEN RETURN; END IF;

  UPDATE comprobantes_compra
     SET saldo_pendiente = round(v_saldo, 2),
         estado_pago = CASE WHEN abs(v_saldo) <= 0.01 THEN 'pagado'
                            WHEN abs(v_saldo) < abs(v_total) - 0.01 THEN 'parcial'
                            ELSE 'pendiente' END
   WHERE id = p_comprobante_id
     AND (saldo_pendiente IS DISTINCT FROM round(v_saldo, 2)
          OR estado_pago IS DISTINCT FROM (CASE WHEN abs(v_saldo) <= 0.01 THEN 'pagado'
                                                WHEN abs(v_saldo) < abs(v_total) - 0.01 THEN 'parcial'
                                                ELSE 'pendiente' END));
END;
$function$;

-- ═══ 3. Apoyo de la orden de pago ═══
-- Créditos descontados en la orden → imputación en la cuenta corriente (pago ↔ crédito)
CREATE OR REPLACE FUNCTION public.op_asentar_creditos(p_op_id uuid, p_pago_mov uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_imp record;
  v_mov uuid;
BEGIN
  IF p_pago_mov IS NULL THEN RETURN; END IF;
  FOR v_imp IN
    SELECT * FROM ordenes_pago_imputaciones WHERE orden_pago_id = p_op_id AND monto_imputado < 0
  LOOP
    v_mov := v_imp.movimiento_cc_id;
    IF v_mov IS NULL AND v_imp.comprobante_compra_id IS NOT NULL THEN
      SELECT id INTO v_mov FROM cuenta_corriente_proveedores
       WHERE referencia_tipo = 'comprobante_compra' AND referencia_id = v_imp.comprobante_compra_id AND monto < 0
       ORDER BY created_at DESC LIMIT 1;
    END IF;
    IF v_mov IS NULL THEN CONTINUE; END IF;
    INSERT INTO imputaciones_proveedores (id_movimiento_pago, id_movimiento_documento, monto_imputado, fecha_imputacion)
    SELECT p_pago_mov, v_mov, abs(v_imp.monto_imputado), now()
    WHERE NOT EXISTS (SELECT 1 FROM imputaciones_proveedores
                       WHERE id_movimiento_pago = p_pago_mov AND id_movimiento_documento = v_mov);
  END LOOP;
END;
$function$;

-- Comprobantes tocados por una orden → saldo releído de la cuenta corriente
CREATE OR REPLACE FUNCTION public.op_sincronizar_saldos_comprobantes(p_op_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_comp uuid;
BEGIN
  FOR v_comp IN
    SELECT DISTINCT COALESCE(i.comprobante_compra_id, cc.referencia_id)
      FROM ordenes_pago_imputaciones i
      LEFT JOIN cuenta_corriente_proveedores cc
        ON cc.id = i.movimiento_cc_id AND cc.referencia_tipo = 'comprobante_compra'
     WHERE i.orden_pago_id = p_op_id
       AND COALESCE(i.comprobante_compra_id, cc.referencia_id) IS NOT NULL
  LOOP
    PERFORM cc_proveedor_sincronizar_comprobante(v_comp);
  END LOOP;
END;
$function$;

-- ═══ 5. Emparejar comprobantes viejos (NO se ejecuta sola) ═══
-- select public.cc_proveedor_resincronizar_saldos();            -- todos
-- select public.cc_proveedor_resincronizar_saldos('<uuid>');    -- un proveedor
-- Devuelve cuántos comprobantes cambiaron.
CREATE OR REPLACE FUNCTION public.cc_proveedor_resincronizar_saldos(p_proveedor_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_comp   record;
  v_antes  numeric;
  v_cambio int := 0;
BEGIN
  FOR v_comp IN
    SELECT DISTINCT c.id, c.saldo_pendiente
      FROM comprobantes_compra c
      JOIN cuenta_corriente_proveedores cc ON cc.referencia_tipo = 'comprobante_compra' AND cc.referencia_id = c.id
     WHERE p_proveedor_id IS NULL OR c.proveedor_id = p_proveedor_id
  LOOP
    v_antes := v_comp.saldo_pendiente;
    PERFORM cc_proveedor_sincronizar_comprobante(v_comp.id);
    IF (SELECT saldo_pendiente FROM comprobantes_compra WHERE id = v_comp.id) IS DISTINCT FROM v_antes THEN
      v_cambio := v_cambio + 1;
    END IF;
  END LOOP;
  RETURN v_cambio;
END;
$function$;

REVOKE ALL ON FUNCTION public.cc_proveedor_saldo_movimiento(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cc_proveedor_saldo_movimiento(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.cc_proveedor_sincronizar_comprobante(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cc_proveedor_sincronizar_comprobante(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.op_asentar_creditos(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.op_asentar_creditos(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.op_sincronizar_saldos_comprobantes(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.op_sincronizar_saldos_comprobantes(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.cc_proveedor_resincronizar_saldos(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cc_proveedor_resincronizar_saldos(uuid) TO service_role;

-- ═══ 4. op_confirmar v8 ═══
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

-- ═══ op_anular v5 ═══
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
$$;

REVOKE ALL ON FUNCTION public.op_anular(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.op_anular(uuid, uuid, text) TO service_role;

-- Control (SOLO LECTURA): comprobantes cuyo saldo propio NO coincide con la cuenta corriente.
-- Si devuelve filas, cc_proveedor_resincronizar_saldos() las empareja.
-- select p.nombre, c.tipo_comprobante, c.numero_comprobante, c.saldo_pendiente as saldo_comprobante,
--        sum(public.cc_proveedor_saldo_movimiento(cc.id)) as saldo_cuenta_corriente
--   from comprobantes_compra c
--   join cuenta_corriente_proveedores cc on cc.referencia_tipo = 'comprobante_compra' and cc.referencia_id = c.id
--   left join proveedores p on p.id = c.proveedor_id
--  group by p.nombre, c.id
-- having abs(coalesce(c.saldo_pendiente, 0) - sum(public.cc_proveedor_saldo_movimiento(cc.id))) > 0.01
--  order by 1, 3;
