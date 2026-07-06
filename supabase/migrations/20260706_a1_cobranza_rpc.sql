-- ─────────────────────────────────────────────────────────────────────────────
-- FASE A1 — Núcleo transaccional de cobranzas
--
-- Problema: confirmarCobranza() (lib/actions/cobranzas.ts) y la anulación
-- (app/api/pagos-clientes/[id]/anular) encadenaban ~6 escrituras Supabase
-- sueltas SIN transacción: un fallo a mitad dejaba saldos restados con
-- imputaciones pendientes, recibos sin kardex, o anulaciones a medias.
--
-- Solución: TODO el circuito confirmar/anular pasa a DOS funciones plpgsql
-- atómicas (patrón fin_confirmar_pago_pendiente). El código TS queda como
-- wrapper fino que llama al RPC.
--
--   cobranza_confirmar(p_pago_id, p_usuario_id) → jsonb
--   cobranza_anular(p_pago_id, p_usuario_id, p_motivo) → jsonb
--
-- Semántica de RETENCIONES (decisión de negocio documentada):
--   la retención ES parte del monto cobrado — se imputa contra comprobantes
--   igual que el resto del pago; en kardex va como línea propia con
--   metodo='RETENCION' y destino_tipo='RETENCIONES' (activo fiscal a
--   recuperar). pagos_clientes.monto ya la incluye.
--
-- Nota A0: el plan preveía ALTER TYPE cheque_status ADD VALUE 'ANULADO';
-- verificado en DB: el valor YA existe — no se necesita enum prep.
--
-- Idempotente: CREATE OR REPLACE; re-ejecutar cobranza_confirmar sobre un
-- pago ya confirmado no duplica libro mayor, recibo ni kardex (guards).
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════
-- 1. cobranza_confirmar
--    Puerta ÚNICA por la que un pago pendiente "se vuelve plata real":
--    imputaciones → saldos de comprobantes, haber al libro mayor (cc_postear),
--    recibo numerado (FOR UPDATE sobre numeracion_comprobantes: elimina la
--    race de numeración), kardex_contable por método, pago → 'confirmado'.
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.cobranza_confirmar(
  p_pago_id    uuid,
  p_usuario_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pago            pagos_clientes%ROWTYPE;
  v_ya_confirmado   boolean;
  v_imp             record;
  v_comp            record;
  v_nuevo_saldo     numeric;
  v_estado_pago     text;
  v_paid_ids        uuid[] := '{}';
  v_recibo_id       uuid;
  v_numero_recibo   text;
  v_siguiente       bigint;
  v_det             record;
  v_total_ret       numeric;
  v_fecha_ar        timestamptz := now();
  v_hoy_ar          date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
BEGIN
  -- ── Lock del pago ──
  SELECT * INTO v_pago FROM pagos_clientes WHERE id = p_pago_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cobranza_confirmar: pago % no encontrado', p_pago_id;
  END IF;
  IF v_pago.estado IN ('anulado', 'rechazado') THEN
    RAISE EXCEPTION 'cobranza_confirmar: no se puede confirmar un pago en estado %', v_pago.estado;
  END IF;

  v_ya_confirmado := (v_pago.estado = 'confirmado');

  -- ── 1. Imputaciones pendientes → saldo de comprobantes (con lock por fila) ──
  FOR v_imp IN
    SELECT id, comprobante_id, monto_imputado
    FROM imputaciones
    WHERE pago_id = p_pago_id
      AND estado <> 'confirmado'
      AND estado <> 'anulado'
      AND comprobante_id IS NOT NULL
    ORDER BY created_at
  LOOP
    SELECT id, saldo_pendiente, total_factura INTO v_comp
    FROM comprobantes_venta WHERE id = v_imp.comprobante_id FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;

    v_nuevo_saldo := GREATEST(0, COALESCE(v_comp.saldo_pendiente, 0) - COALESCE(v_imp.monto_imputado, 0));
    v_estado_pago := CASE WHEN v_nuevo_saldo <= 0 THEN 'pagado' ELSE 'parcial' END;

    UPDATE comprobantes_venta
    SET saldo_pendiente = v_nuevo_saldo, estado_pago = v_estado_pago
    WHERE id = v_imp.comprobante_id;

    UPDATE imputaciones SET estado = 'confirmado' WHERE id = v_imp.id;

    IF v_estado_pago = 'pagado' THEN
      v_paid_ids := array_append(v_paid_ids, v_imp.comprobante_id);
    END IF;
  END LOOP;

  -- ── 2. Libro mayor: haber del pago (guard de idempotencia) ──
  IF NOT EXISTS (
    SELECT 1 FROM cuenta_corriente_clientes
    WHERE referencia_tipo = 'pago_cliente' AND referencia_id = p_pago_id
  ) THEN
    PERFORM cc_postear(
      v_pago.cliente_id, 'pago',
      0, abs(v_pago.monto),
      'pago_cliente', p_pago_id,
      NULL, COALESCE(v_pago.observaciones, 'Pago'), p_usuario_id
    );
  END IF;

  -- ── 3. Recibo numerado (guard + FOR UPDATE en numeración: sin races) ──
  SELECT id, numero_recibo INTO v_recibo_id, v_numero_recibo
  FROM recibos WHERE pago_id = p_pago_id LIMIT 1;

  IF v_recibo_id IS NULL THEN
    SELECT ultimo_numero + 1 INTO v_siguiente
    FROM numeracion_comprobantes
    WHERE tipo_comprobante = 'RECIBO' AND punto_venta = '0001'
    FOR UPDATE;

    IF v_siguiente IS NULL THEN
      v_siguiente := 1;
      INSERT INTO numeracion_comprobantes (tipo_comprobante, punto_venta, ultimo_numero)
      VALUES ('RECIBO', '0001', 1);
    ELSE
      UPDATE numeracion_comprobantes SET ultimo_numero = v_siguiente
      WHERE tipo_comprobante = 'RECIBO' AND punto_venta = '0001';
    END IF;

    v_numero_recibo := 'REC-0001-' || lpad(v_siguiente::text, 8, '0');

    INSERT INTO recibos (numero_recibo, pago_id, cliente_id, fecha, monto_total, generado_por)
    VALUES (v_numero_recibo, p_pago_id, v_pago.cliente_id,
            COALESCE(v_pago.fecha_pago, v_hoy_ar), v_pago.monto, p_usuario_id)
    RETURNING id INTO v_recibo_id;
  END IF;

  -- ── 4. Kardex contable: una línea por método de pago (guard) ──
  IF NOT EXISTS (
    SELECT 1 FROM kardex_contable
    WHERE referencia_tipo = 'pago_cliente' AND referencia_id = p_pago_id
  ) THEN
    FOR v_det IN
      SELECT tipo_pago, monto, caja_id, cuenta_bancaria_id, color_cheque
      FROM pagos_detalle WHERE pago_id = p_pago_id
    LOOP
      INSERT INTO kardex_contable (
        tipo_movimiento, concepto, monto, color,
        origen_tipo, origen_id, destino_tipo, destino_id, metodo,
        referencia_tipo, referencia_id, pago_id, recibo_id,
        cliente_id, cobrador_id
      ) VALUES (
        'COBRO_CLIENTE',
        'Cobro ' || COALESCE(v_numero_recibo, '') || ' — ' || upper(COALESCE(v_det.tipo_pago, '')),
        v_det.monto,
        v_det.color_cheque,
        'CLIENTE', v_pago.cliente_id,
        CASE WHEN v_det.tipo_pago IN ('cheque', 'deposito') THEN 'EN_CARTERA'
             WHEN v_det.tipo_pago = 'efectivo' THEN 'CAJA'
             ELSE 'BANCO' END,
        CASE WHEN v_det.tipo_pago = 'efectivo' THEN v_det.caja_id
             WHEN v_det.tipo_pago IN ('transferencia', 'deposito') THEN v_det.cuenta_bancaria_id
             ELSE NULL END,
        CASE WHEN v_det.tipo_pago = 'cheque' THEN 'CHEQUE_TERCERO'
             WHEN v_det.tipo_pago = 'transferencia' THEN 'TRANSFERENCIA'
             WHEN v_det.tipo_pago = 'deposito' THEN 'DEPOSITO'
             ELSE 'EFECTIVO' END,
        'pago_cliente', p_pago_id, p_pago_id, v_recibo_id,
        v_pago.cliente_id, p_usuario_id
      );
    END LOOP;

    -- Retenciones: línea contable adicional (activo fiscal a recuperar)
    SELECT COALESCE(sum(monto), 0) INTO v_total_ret
    FROM retenciones WHERE pago_id = p_pago_id;
    IF v_total_ret > 0 THEN
      INSERT INTO kardex_contable (
        tipo_movimiento, concepto, monto, color,
        origen_tipo, origen_id, destino_tipo, destino_id, metodo,
        referencia_tipo, referencia_id, pago_id, recibo_id, cliente_id, cobrador_id
      ) VALUES (
        'COBRO_CLIENTE',
        'Retenciones ' || COALESCE(v_numero_recibo, ''),
        v_total_ret, NULL,
        'CLIENTE', v_pago.cliente_id, 'RETENCIONES', NULL, 'RETENCION',
        'pago_cliente', p_pago_id, p_pago_id, v_recibo_id, v_pago.cliente_id, p_usuario_id
      );
    END IF;
  END IF;

  -- ── 5. Pago → confirmado ──
  IF NOT v_ya_confirmado THEN
    UPDATE pagos_clientes
    SET estado = 'confirmado',
        confirmado_por = p_usuario_id::text,
        fecha_confirmacion = v_fecha_ar
    WHERE id = p_pago_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'ya_confirmado', v_ya_confirmado,
    'recibo_id', v_recibo_id,
    'numero_recibo', v_numero_recibo,
    'paid_comprobante_ids', to_jsonb(v_paid_ids)
  );
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 2. cobranza_anular
--    Reversa COMPLETA y atómica de un pago: saldos de comprobantes,
--    imputaciones, recibo, cheques, libro mayor, kardex, y — lo que la
--    versión TS NO hacía — comisiones 'cobrada' y billetera del viajante.
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.cobranza_anular(
  p_pago_id    uuid,
  p_usuario_id uuid,
  p_motivo     text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pago              pagos_clientes%ROWTYPE;
  v_estaba_confirmado boolean;
  v_imp               record;
  v_comp              record;
  v_total_fact        numeric;
  v_nuevo_saldo       numeric;
  v_nuevo_estado      text;
  v_comprobante_ids   uuid[];
  v_cobro_billetera   record;
BEGIN
  SELECT * INTO v_pago FROM pagos_clientes WHERE id = p_pago_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cobranza_anular: pago % no encontrado', p_pago_id;
  END IF;
  IF v_pago.estado = 'anulado' THEN
    RETURN jsonb_build_object('success', true, 'ya_anulado', true);
  END IF;

  v_estaba_confirmado := (v_pago.estado = 'confirmado');

  SELECT array_agg(DISTINCT comprobante_id) INTO v_comprobante_ids
  FROM imputaciones WHERE pago_id = p_pago_id AND comprobante_id IS NOT NULL;

  -- ── 1. Restaurar saldos de comprobantes ──
  -- Solo las imputaciones CONFIRMADAS restaron saldo; las pendientes no
  -- (fix sobre la versión TS, que restauraba todas y podía inflar saldos).
  FOR v_imp IN
    SELECT id, comprobante_id, monto_imputado, estado
    FROM imputaciones
    WHERE pago_id = p_pago_id AND comprobante_id IS NOT NULL
  LOOP
    SELECT id, tipo_comprobante, observaciones, saldo_pendiente, total_factura
    INTO v_comp FROM comprobantes_venta WHERE id = v_imp.comprobante_id FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;

    IF v_comp.tipo_comprobante IN ('REV', 'NCA', 'NCB', 'NCC')
       AND lower(COALESCE(v_comp.observaciones, '')) LIKE '%bonificaci%' THEN
      -- NC/REV autogenerada por bonificación de este pago: deja de representar crédito
      UPDATE comprobantes_venta
      SET estado_pago = 'anulado', saldo_pendiente = 0
      WHERE id = v_comp.id;
    ELSIF v_imp.estado = 'confirmado' THEN
      v_total_fact  := abs(COALESCE(v_comp.total_factura, 0));
      v_nuevo_saldo := LEAST(v_total_fact, COALESCE(v_comp.saldo_pendiente, 0) + abs(COALESCE(v_imp.monto_imputado, 0)));
      v_nuevo_estado := CASE
        WHEN v_nuevo_saldo <= 0 THEN 'pagado'
        WHEN v_nuevo_saldo >= v_total_fact THEN 'pendiente'
        ELSE 'parcial' END;
      UPDATE comprobantes_venta
      SET saldo_pendiente = v_nuevo_saldo, estado_pago = v_nuevo_estado
      WHERE id = v_comp.id;
    END IF;
  END LOOP;

  -- ── 2. Imputaciones → anuladas ──
  UPDATE imputaciones SET estado = 'anulado' WHERE pago_id = p_pago_id;

  -- ── 3. Recibo → anulado ──
  UPDATE recibos
  SET estado = 'anulado', anulado_at = now(), anulado_por = p_usuario_id
  WHERE pago_id = p_pago_id;

  -- ── 4. Cheques del pago EN_CARTERA → ANULADO ──
  UPDATE cheques SET estado = 'ANULADO'
  WHERE estado = 'EN_CARTERA'
    AND id IN (
      SELECT cheque_id FROM pagos_detalle WHERE pago_id = p_pago_id AND cheque_id IS NOT NULL
      UNION
      SELECT pdi.cheque_id
      FROM pago_deposito_items pdi
      JOIN pagos_detalle pd ON pd.id = pdi.pago_detalle_id
      WHERE pd.pago_id = p_pago_id AND pdi.cheque_id IS NOT NULL
    );

  -- ── 5. Libro mayor: contrapartida (solo si estaba confirmado; guard) ──
  IF v_estaba_confirmado AND NOT EXISTS (
    SELECT 1 FROM cuenta_corriente_clientes
    WHERE referencia_tipo = 'pago_anulacion' AND referencia_id = p_pago_id
  ) THEN
    PERFORM cc_postear(
      v_pago.cliente_id, 'ajuste',
      abs(v_pago.monto), 0,
      'pago_anulacion', p_pago_id,
      NULL,
      'Anulación de pago' || CASE WHEN p_motivo IS NOT NULL AND p_motivo <> '' THEN ' — ' || p_motivo ELSE '' END,
      p_usuario_id
    );
  END IF;

  -- ── 6. Kardex: reversa (guard) ──
  IF NOT EXISTS (
    SELECT 1 FROM kardex_contable
    WHERE tipo_movimiento = 'ANULACION_COBRO'
      AND referencia_tipo = 'pago_cliente' AND referencia_id = p_pago_id
  ) THEN
    INSERT INTO kardex_contable (
      tipo_movimiento, concepto, monto, color,
      origen_tipo, origen_id,
      referencia_tipo, referencia_id, pago_id, cliente_id, cobrador_id
    ) VALUES (
      'ANULACION_COBRO',
      'Anulación pago ' || left(p_pago_id::text, 8)
        || CASE WHEN p_motivo IS NOT NULL AND p_motivo <> '' THEN ' — ' || p_motivo ELSE '' END,
      -abs(v_pago.monto), NULL,
      'CLIENTE', v_pago.cliente_id,
      'pago_cliente', p_pago_id, p_pago_id, v_pago.cliente_id, p_usuario_id
    );
  END IF;

  -- ── 7. Comisiones 'cobrada' de los comprobantes de este pago ──
  -- (comisiones no tiene pago_id: se llega por comprobante_venta_id)
  IF v_comprobante_ids IS NOT NULL THEN
    -- no pagadas al viajante todavía → se eliminan
    DELETE FROM comisiones
    WHERE tipo = 'cobrada'
      AND pagado = false
      AND comprobante_venta_id = ANY (v_comprobante_ids);

    -- ya pagadas → contra-asiento negativo (no se puede borrar plata entregada)
    INSERT INTO comisiones (
      viajante_id, pedido_id, comprobante_venta_id, tipo, articulo_id, segmento,
      cantidad, precio_neto_unitario, porcentaje, monto,
      comprobante_cobrado, pagado, motivo
    )
    SELECT viajante_id, pedido_id, comprobante_venta_id, 'cobrada', articulo_id, segmento,
           cantidad, precio_neto_unitario, porcentaje, -monto,
           false, false, 'Reversa por anulación de pago ' || left(p_pago_id::text, 8)
    FROM comisiones c
    WHERE c.tipo = 'cobrada'
      AND c.pagado = true
      AND c.comprobante_venta_id = ANY (v_comprobante_ids)
      AND c.monto <> 0
      AND NOT EXISTS (
        SELECT 1 FROM comisiones r
        WHERE r.tipo = 'cobrada'
          AND r.comprobante_venta_id = c.comprobante_venta_id
          AND r.motivo = 'Reversa por anulación de pago ' || left(p_pago_id::text, 8)
      );

    -- comisiones 'vendida': el comprobante ya no está cobrado
    UPDATE comisiones
    SET comprobante_cobrado = false, fecha_comprobante_cobrado = NULL
    WHERE tipo = 'vendida'
      AND comprobante_venta_id = ANY (v_comprobante_ids)
      AND comprobante_venta_id IN (
        SELECT id FROM comprobantes_venta WHERE estado_pago <> 'pagado'
      );
  END IF;

  -- ── 8. Billetera: débito compensatorio del cobro (guard) ──
  FOR v_cobro_billetera IN
    SELECT viajante_id, sum(monto) AS total
    FROM billetera_movimientos
    WHERE tipo = 'cobro_cliente'
      AND referencia_tipo = 'pago_cliente'
      AND referencia_id = p_pago_id
    GROUP BY viajante_id
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM billetera_movimientos
      WHERE tipo = 'debito'
        AND referencia_tipo = 'pago_anulacion'
        AND referencia_id = p_pago_id
        AND viajante_id = v_cobro_billetera.viajante_id
    ) THEN
      INSERT INTO billetera_movimientos (
        viajante_id, tipo, monto, concepto, referencia_id, referencia_tipo, fecha, creado_por
      ) VALUES (
        v_cobro_billetera.viajante_id, 'debito', -abs(v_cobro_billetera.total),
        'Reversa por anulación de pago ' || left(p_pago_id::text, 8),
        p_pago_id, 'pago_anulacion', now(), p_usuario_id
      );
    END IF;
  END LOOP;

  -- ── 9. Pago → anulado ──
  UPDATE pagos_clientes
  SET estado = 'anulado',
      anulado_por = p_usuario_id,
      anulado_at = now(),
      motivo_anulacion = NULLIF(p_motivo, '')
  WHERE id = p_pago_id;

  RETURN jsonb_build_object(
    'success', true,
    'ya_anulado', false,
    'estaba_confirmado', v_estaba_confirmado
  );
END;
$$;

-- ── Permisos: solo usuarios autenticados y service role ──
REVOKE ALL ON FUNCTION public.cobranza_confirmar(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cobranza_anular(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cobranza_confirmar(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cobranza_anular(uuid, uuid, text) TO authenticated, service_role;
