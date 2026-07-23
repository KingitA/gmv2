-- ─────────────────────────────────────────────────────────────────────────────
-- FASE I1 — Saneamiento de órdenes de pago a proveedores (REQUIERE B/C)
--
-- Antes: app/api/ordenes-pago/[id]/confirmar hacía ~7 escrituras sueltas SIN
-- transacción, NO posteaba kardex, NO bajaba el saldo de caja/banco, y usaba
-- el estado de cheque 'PASADO_PROVEEDOR' que no existe en el enum
-- (verificado 28-07-2026: ordenes_pago sin uso en producción y ningún cheque
-- en estado inválido → no hace falta backfill).
--
-- Ahora: op_confirmar / op_anular, atómicas, idempotentes, mismo patrón que
-- cobranza_confirmar. La route queda como thin wrapper.
--
-- El detalle de OP no guarda de qué cuenta sale la plata (solo datos del
-- destino), así que la cuenta origen entra por parámetro:
--   p_caja_id          → origen del efectivo   (default: Caja Grande)
--   p_cuenta_banco_id  → origen de transferencias (obligatorio si hay alguna)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.op_confirmar(
  p_op_id           uuid,
  p_usuario_id      uuid,
  p_caja_id         uuid DEFAULT NULL,
  p_cuenta_banco_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_op        ordenes_pago%ROWTYPE;
  v_det       record;
  v_imp       record;
  v_caja      uuid := p_caja_id;
  v_pago_mov  uuid;
  v_cheque    cheques%ROWTYPE;
  v_cheque_id uuid;
  v_kardex    int := 0;
  v_hoy_ar    date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_cc_ids    uuid[] := '{}';
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

  -- Validaciones de origen de fondos ANTES de escribir nada
  IF EXISTS (SELECT 1 FROM ordenes_pago_detalle d WHERE d.orden_pago_id = p_op_id AND d.medio = 'transferencia')
     AND p_cuenta_banco_id IS NULL THEN
    RAISE EXCEPTION 'op_confirmar: la OP incluye transferencias — indicá desde qué cuenta bancaria salen (p_cuenta_banco_id)';
  END IF;
  IF v_caja IS NULL THEN
    SELECT id INTO v_caja FROM cajas_financieras WHERE nombre = 'Caja Grande' AND activo LIMIT 1;
  END IF;

  -- 1. CC proveedor: pago + retenciones (guard de idempotencia)
  IF NOT EXISTS (
    SELECT 1 FROM cuenta_corriente_proveedores
    WHERE referencia_tipo = 'orden_pago' AND referencia_id = p_op_id AND tipo_movimiento = 'pago'
  ) THEN
    INSERT INTO cuenta_corriente_proveedores (
      proveedor_id, fecha, tipo_movimiento, monto, descripcion,
      referencia_id, referencia_tipo, numero_comprobante, tipo_comprobante
    ) VALUES (
      v_op.proveedor_id, now(), 'pago', -(v_op.neto_a_pagar),
      'Pago ' || v_op.numero_op, p_op_id, 'orden_pago', v_op.numero_op, 'OP'
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
  ELSE
    SELECT id INTO v_pago_mov FROM cuenta_corriente_proveedores
    WHERE referencia_tipo = 'orden_pago' AND referencia_id = p_op_id AND tipo_movimiento = 'pago' LIMIT 1;
  END IF;

  -- 2. Imputaciones legacy + vencimientos pagados
  FOR v_imp IN
    SELECT * FROM ordenes_pago_imputaciones WHERE orden_pago_id = p_op_id
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
    IF v_imp.vencimiento_id IS NOT NULL THEN
      UPDATE vencimientos SET estado = 'pagado', orden_pago_id = p_op_id, updated_at = now()
      WHERE id = v_imp.vencimiento_id AND estado = 'pendiente';
    END IF;
  END LOOP;
  IF array_length(v_cc_ids, 1) > 0 THEN
    UPDATE vencimientos SET estado = 'pagado', orden_pago_id = p_op_id, updated_at = now()
    WHERE referencia_id = ANY(v_cc_ids) AND referencia_tipo = 'cuenta_corriente' AND estado = 'pendiente';
  END IF;

  -- 3. Medios de pago → kardex (guard) + estado de cheques
  IF NOT EXISTS (
    SELECT 1 FROM kardex_contable WHERE referencia_tipo = 'orden_pago' AND referencia_id = p_op_id
  ) THEN
    FOR v_det IN
      SELECT * FROM ordenes_pago_detalle WHERE orden_pago_id = p_op_id
    LOOP
      IF COALESCE(v_det.monto, 0) <= 0 THEN CONTINUE; END IF;

      IF v_det.medio = 'cheque' AND v_det.cheque_id IS NOT NULL THEN
        -- Cheque de terceros en cartera → entregado al proveedor (sin mov. de saldo)
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
        -- Cheque propio nuevo: nace entregado; el saldo baja recién al debitarse
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
        IF v_caja IS NULL THEN
          RAISE EXCEPTION 'op_confirmar: no hay caja de efectivo (Caja Grande inactiva y sin p_caja_id)';
        END IF;
        PERFORM kardex_registrar(
          p_tipo_movimiento => 'PAGO_PROVEEDOR',
          p_concepto        => 'Pago ' || v_op.numero_op || ' — efectivo',
          p_monto           => v_det.monto,
          p_origen_tipo     => 'CAJA',
          p_origen_id       => v_caja,
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
        PERFORM kardex_registrar(
          p_tipo_movimiento => 'PAGO_PROVEEDOR',
          p_concepto        => 'Pago ' || v_op.numero_op || ' — transferencia' ||
                               COALESCE(' ' || v_det.numero_transferencia, ''),
          p_monto           => v_det.monto,
          p_origen_tipo     => 'BANCO',
          p_origen_id       => p_cuenta_banco_id,
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

  -- 4. OP pagada
  UPDATE ordenes_pago SET estado = 'pagada', updated_at = now() WHERE id = p_op_id;

  RETURN jsonb_build_object(
    'success', true, 'ya_confirmada', false,
    'cc_pago_id', v_pago_mov, 'kardex_lineas', v_kardex
  );
END;
$$;

REVOKE ALL ON FUNCTION public.op_confirmar(uuid, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.op_confirmar(uuid, uuid, uuid, uuid) TO authenticated, service_role;

-- ═════════════════════════════════════════════════════════════════════════
-- op_anular — reversa completa por contrapartida (nunca DELETE del ledger)
-- ═════════════════════════════════════════════════════════════════════════
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
  v_revs int := 0;
BEGIN
  SELECT * INTO v_op FROM ordenes_pago WHERE id = p_op_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'op_anular: orden de pago % no encontrada', p_op_id;
  END IF;
  IF v_op.estado <> 'pagada' THEN
    RAISE EXCEPTION 'op_anular: la OP está % — solo se anulan OP pagadas', v_op.estado;
  END IF;

  -- 1. Reversa kardex línea por línea (restaura saldos de caja/banco)
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

  -- 2. Cheques: terceros vuelven a cartera; propios se anulan
  UPDATE cheques SET estado = 'EN_CARTERA', proveedor_destino_id = NULL, orden_pago_id = NULL
  WHERE orden_pago_id = p_op_id AND tipo = 'TERCERO' AND estado = 'ENTREGADO_A_PROVEEDOR';
  UPDATE cheques SET estado = 'ANULADO'
  WHERE orden_pago_id = p_op_id AND tipo = 'PROPIO' AND estado = 'ENTREGADO_A_PROVEEDOR';

  -- 3. CC proveedor: contrapartida de pago y retenciones + limpiar imputaciones
  FOR v_mov IN
    SELECT * FROM cuenta_corriente_proveedores
    WHERE referencia_tipo = 'orden_pago' AND referencia_id = p_op_id
  LOOP
    INSERT INTO cuenta_corriente_proveedores (proveedor_id, fecha, tipo_movimiento, monto, descripcion, referencia_id, referencia_tipo)
    VALUES (v_mov.proveedor_id, now(), 'anulacion', -(v_mov.monto),
            'ANULACIÓN ' || COALESCE(v_mov.descripcion, v_op.numero_op), p_op_id, 'orden_pago_anulacion');
    DELETE FROM imputaciones_proveedores WHERE id_movimiento_pago = v_mov.id;
  END LOOP;

  -- 4. Vencimientos que esta OP marcó como pagados → pendientes
  UPDATE vencimientos SET estado = 'pendiente', orden_pago_id = NULL, updated_at = now()
  WHERE orden_pago_id = p_op_id AND estado = 'pagado';

  -- 5. Estado final
  UPDATE ordenes_pago
  SET estado = 'anulada',
      observaciones = COALESCE(observaciones || E'\n', '') || 'ANULADA: ' || COALESCE(p_motivo, 'sin motivo') ||
                      ' (' || to_char(now() AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD-MM-YYYY HH24:MI') || ')',
      updated_at = now()
  WHERE id = p_op_id;

  RETURN jsonb_build_object('success', true, 'kardex_reversas', v_revs);
END;
$$;

REVOKE ALL ON FUNCTION public.op_anular(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.op_anular(uuid, uuid, text) TO authenticated, service_role;
