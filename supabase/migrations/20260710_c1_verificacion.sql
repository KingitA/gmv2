-- ─────────────────────────────────────────────────────────────────────────────
-- FASE C1 — Modelo de doble verificación (REQUIERE Fase B aplicada)
--
-- Requisito del negocio: toda cobranza verificada DOS veces —
--   Firma 1 = quien cobra  (pagos_clientes.creado_por)
--   Firma 2 = quien rinde/concilia/revisa (pagos_clientes.verificado_por)
-- y visible en todo momento (badge estado + verificado en todas las pantallas).
--
-- Reglas:
--   · cobranza_confirmar setea la firma 2 SOLO si el confirmador ≠ creador.
--   · El efectivo de mostrador auto-confirmado queda 'confirmado' pero NO
--     verificado → visible en el tablero hasta el arqueo/verificación de
--     otro usuario.
--   · pago_verificar() exige usuario ≠ creador y propaga verificado=true a
--     las líneas kardex del pago.
--   · verificacion_fuente queda preparada para APIs bancarias futuras
--     ('manual' hoy; 'api_banco'/'api_mp' cuando lleguen — mismo RPC).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.pagos_clientes
  ADD COLUMN IF NOT EXISTS cobrador_tipo       varchar(20) NOT NULL DEFAULT 'oficina',
  ADD COLUMN IF NOT EXISTS verificado_por      uuid,
  ADD COLUMN IF NOT EXISTS verificado_at       timestamptz,
  ADD COLUMN IF NOT EXISTS verificacion_metodo varchar(20),
  ADD COLUMN IF NOT EXISTS verificacion_fuente varchar(20) NOT NULL DEFAULT 'manual';

DO $$
BEGIN
  ALTER TABLE public.pagos_clientes
    ADD CONSTRAINT pagos_clientes_cobrador_tipo_check
    CHECK (cobrador_tipo IN ('oficina', 'chofer', 'viajante'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.pagos_clientes
    ADD CONSTRAINT pagos_clientes_verificacion_metodo_check
    CHECK (verificacion_metodo IS NULL OR verificacion_metodo IN ('rendicion', 'conciliacion', 'revision', 'arqueo'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Backfill: pagos con viaje son de chofer
UPDATE public.pagos_clientes SET cobrador_tipo = 'chofer'
WHERE viaje_id IS NOT NULL AND cobrador_tipo = 'oficina';

CREATE INDEX IF NOT EXISTS idx_pagos_clientes_sin_verificar
  ON public.pagos_clientes (estado, cobrador_tipo)
  WHERE verificado_por IS NULL AND estado IN ('pendiente', 'pendiente_rendicion', 'confirmado');

-- ═════════════════════════════════════════════════════════════════════════
-- pago_verificar — la segunda firma
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.pago_verificar(
  p_pago_id    uuid,
  p_usuario_id uuid,
  p_metodo     text DEFAULT 'revision',   -- rendicion|conciliacion|revision|arqueo
  p_fuente     text DEFAULT 'manual'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pago pagos_clientes%ROWTYPE;
BEGIN
  SELECT * INTO v_pago FROM pagos_clientes WHERE id = p_pago_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pago_verificar: pago % no encontrado', p_pago_id;
  END IF;
  IF v_pago.estado <> 'confirmado' THEN
    RAISE EXCEPTION 'pago_verificar: el pago está % — solo se verifican pagos confirmados', v_pago.estado;
  END IF;
  IF v_pago.verificado_por IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'ya_verificado', true);
  END IF;
  IF v_pago.creado_por IS NOT NULL AND v_pago.creado_por = p_usuario_id THEN
    RAISE EXCEPTION 'pago_verificar: la segunda firma debe ser de un usuario distinto al que cobró';
  END IF;

  UPDATE pagos_clientes
  SET verificado_por = p_usuario_id,
      verificado_at = now(),
      verificacion_metodo = p_metodo,
      verificacion_fuente = COALESCE(p_fuente, 'manual')
  WHERE id = p_pago_id;

  UPDATE kardex_contable
  SET verificado = true, verificado_por = p_usuario_id, verificado_at = now()
  WHERE pago_id = p_pago_id AND verificado = false;

  RETURN jsonb_build_object('success', true, 'ya_verificado', false);
END;
$$;

REVOKE ALL ON FUNCTION public.pago_verificar(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pago_verificar(uuid, uuid, text, text) TO authenticated, service_role;

-- ═════════════════════════════════════════════════════════════════════════
-- cobranza_confirmar v3 — agrega la firma 2 automática cuando el
-- confirmador es distinto del creador (revisión de pagos).
-- Cambio acotado: solo el paso 5; el resto es idéntico a la v2 (B1).
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
  v_hoy_ar          date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_caja_default    uuid;
  v_cheque_id       uuid;
  v_destino_tipo    text;
  v_destino_id      uuid;
  v_es_segunda_firma boolean;
BEGIN
  SELECT * INTO v_pago FROM pagos_clientes WHERE id = p_pago_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cobranza_confirmar: pago % no encontrado', p_pago_id;
  END IF;
  IF v_pago.estado IN ('anulado', 'rechazado') THEN
    RAISE EXCEPTION 'cobranza_confirmar: no se puede confirmar un pago en estado %', v_pago.estado;
  END IF;

  v_ya_confirmado := (v_pago.estado = 'confirmado');
  v_es_segunda_firma := (v_pago.creado_por IS NULL OR v_pago.creado_por <> p_usuario_id);

  -- ── 1. Imputaciones pendientes → saldo de comprobantes ──
  FOR v_imp IN
    SELECT id, comprobante_id, monto_imputado
    FROM imputaciones
    WHERE pago_id = p_pago_id
      AND estado NOT IN ('confirmado', 'anulado')
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

  -- ── 2. Libro mayor (guard) ──
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

  -- ── 3. Recibo numerado (guard + FOR UPDATE) ──
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

  -- ── 4. Kardex + saldos + cheques (guard) ──
  IF NOT EXISTS (
    SELECT 1 FROM kardex_contable
    WHERE referencia_tipo = 'pago_cliente' AND referencia_id = p_pago_id
  ) THEN
    SELECT id INTO v_caja_default FROM cajas_financieras WHERE nombre = 'Caja Chica' LIMIT 1;

    FOR v_det IN
      SELECT id, tipo_pago, monto, caja_id, cuenta_bancaria_id, color_cheque,
             numero_cheque, banco, fecha_cheque, cuit_emisor, cheque_id
      FROM pagos_detalle WHERE pago_id = p_pago_id
    LOOP
      v_cheque_id := v_det.cheque_id;

      IF v_det.tipo_pago = 'cheque' AND v_cheque_id IS NULL THEN
        INSERT INTO cheques (
          tipo, estado, banco, numero, fecha_emision, fecha_vencimiento,
          monto, color, cliente_origen_id
        ) VALUES (
          'TERCERO', 'EN_CARTERA',
          COALESCE(v_det.banco, 'S/D'), COALESCE(v_det.numero_cheque, 'S/N'),
          v_hoy_ar, COALESCE(v_det.fecha_cheque, v_hoy_ar + 30),
          v_det.monto, COALESCE(v_det.color_cheque, 'BLANCO')::money_color,
          v_pago.cliente_id
        ) RETURNING id INTO v_cheque_id;
        UPDATE pagos_detalle SET cheque_id = v_cheque_id WHERE id = v_det.id;
      END IF;

      v_destino_tipo := CASE WHEN v_det.tipo_pago IN ('cheque', 'deposito') THEN 'EN_CARTERA'
                             WHEN v_det.tipo_pago = 'efectivo' THEN 'CAJA'
                             ELSE 'BANCO' END;
      v_destino_id   := CASE WHEN v_det.tipo_pago = 'efectivo' THEN COALESCE(v_det.caja_id, v_caja_default)
                             WHEN v_det.tipo_pago IN ('transferencia', 'deposito') THEN v_det.cuenta_bancaria_id
                             ELSE NULL END;

      PERFORM kardex_registrar(
        p_tipo_movimiento => 'COBRO_CLIENTE',
        p_concepto        => 'Cobro ' || COALESCE(v_numero_recibo, '') || ' — ' || upper(COALESCE(v_det.tipo_pago, '')),
        p_monto           => v_det.monto,
        p_color           => v_det.color_cheque,
        p_origen_tipo     => 'CLIENTE',
        p_origen_id       => v_pago.cliente_id,
        p_destino_tipo    => v_destino_tipo,
        p_destino_id      => v_destino_id,
        p_metodo          => CASE WHEN v_det.tipo_pago = 'cheque' THEN 'CHEQUE_TERCERO'
                                  WHEN v_det.tipo_pago = 'transferencia' THEN 'TRANSFERENCIA'
                                  WHEN v_det.tipo_pago = 'deposito' THEN 'DEPOSITO'
                                  ELSE 'EFECTIVO' END,
        p_referencia_tipo => 'pago_cliente',
        p_referencia_id   => p_pago_id,
        p_pago_id         => p_pago_id,
        p_recibo_id       => v_recibo_id,
        p_cheque_id       => v_cheque_id,
        p_cliente_id      => v_pago.cliente_id,
        p_viaje_id        => v_pago.viaje_id,
        p_cobrador_id     => p_usuario_id,
        p_usuario_id      => p_usuario_id,
        p_verificado      => v_es_segunda_firma
      );
    END LOOP;

    SELECT COALESCE(sum(monto), 0) INTO v_total_ret
    FROM retenciones WHERE pago_id = p_pago_id;
    IF v_total_ret > 0 THEN
      PERFORM kardex_registrar(
        p_tipo_movimiento => 'COBRO_CLIENTE',
        p_concepto        => 'Retenciones ' || COALESCE(v_numero_recibo, ''),
        p_monto           => v_total_ret,
        p_origen_tipo     => 'CLIENTE',
        p_origen_id       => v_pago.cliente_id,
        p_destino_tipo    => 'RETENCIONES',
        p_metodo          => 'RETENCION',
        p_referencia_tipo => 'pago_cliente',
        p_referencia_id   => p_pago_id,
        p_pago_id         => p_pago_id,
        p_recibo_id       => v_recibo_id,
        p_cliente_id      => v_pago.cliente_id,
        p_cobrador_id     => p_usuario_id,
        p_usuario_id      => p_usuario_id,
        p_verificado      => v_es_segunda_firma
      );
    END IF;
  END IF;

  -- ── 5. Pago → confirmado (+ segunda firma si corresponde) ──
  IF NOT v_ya_confirmado THEN
    UPDATE pagos_clientes
    SET estado = 'confirmado',
        confirmado_por = p_usuario_id::text,
        fecha_confirmacion = now(),
        verificado_por = CASE WHEN v_es_segunda_firma THEN p_usuario_id ELSE verificado_por END,
        verificado_at = CASE WHEN v_es_segunda_firma THEN now() ELSE verificado_at END,
        verificacion_metodo = CASE WHEN v_es_segunda_firma THEN COALESCE(verificacion_metodo, 'revision') ELSE verificacion_metodo END
    WHERE id = p_pago_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'ya_confirmado', v_ya_confirmado,
    'recibo_id', v_recibo_id,
    'numero_recibo', v_numero_recibo,
    'paid_comprobante_ids', to_jsonb(v_paid_ids),
    'verificado', v_es_segunda_firma
  );
END;
$$;
