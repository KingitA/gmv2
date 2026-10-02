-- ============================================================================
-- cobranza_confirmar — ECHEQ confirma: el color 'ECHEQ' se sanea antes del cast
-- ============================================================================
-- Hallazgo 02/10 (GRUPO HEMA): pagos_detalle.color_cheque usa 'ECHEQ' como
-- marcador de canal digital, pero el enum money_color es BLANCO/NEGRO/PENDIENTE
-- — el cast reventaba la confirmación y NINGÚN echeq se pudo confirmar jamás
-- (cero confirmados en toda la historia). Dos arreglos:
--   1) alta del cheque: color 'ECHEQ' → BLANCO (es bancario) y se marca
--      es_echeq = true (antes el flag quedaba apagado);
--   2) kardex del cobro: mismo saneo del color.
-- Basada en el dump vivo (20260827 + fixes) — solo cambian esos dos puntos.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.cobranza_confirmar(p_pago_id uuid, p_usuario_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_es_calle        boolean;
  v_billetera_id    uuid;
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

  -- Cobro en la calle: el efectivo está en la billetera del cobrador
  v_es_calle := COALESCE(v_pago.cobrador_tipo, 'oficina') IN ('viajante', 'chofer');
  IF v_es_calle THEN
    v_billetera_id := v_pago.vendedor_id;
    IF v_billetera_id IS NULL AND v_pago.viaje_id IS NOT NULL THEN
      SELECT chofer_id INTO v_billetera_id FROM viajes WHERE id = v_pago.viaje_id;
    END IF;
    IF v_billetera_id IS NULL THEN
      v_billetera_id := v_pago.creado_por;
    END IF;
  END IF;

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
          monto, color, cliente_origen_id, es_echeq
        ) VALUES (
          'TERCERO', 'EN_CARTERA',
          COALESCE(v_det.banco, 'S/D'), COALESCE(v_det.numero_cheque, 'S/N'),
          v_hoy_ar, COALESCE(v_det.fecha_cheque, v_hoy_ar + 30),
          v_det.monto,
          -- ECHEQ marca el CANAL (digital), no el color del dinero: al enum va
          -- BLANCO (bancario); PENDIENTE ya viene resuelto por las rutas.
          (CASE WHEN v_det.color_cheque = 'ECHEQ' OR v_det.color_cheque IS NULL
                THEN 'BLANCO' ELSE v_det.color_cheque END)::money_color,
          v_pago.cliente_id,
          (v_det.color_cheque = 'ECHEQ')
        ) RETURNING id INTO v_cheque_id;
        UPDATE pagos_detalle SET cheque_id = v_cheque_id WHERE id = v_det.id;
      END IF;

      -- Destino: cheque/depósito → EN_CARTERA · efectivo → BILLETERA (calle) o CAJA · transferencia → BANCO
      v_destino_tipo := CASE WHEN v_det.tipo_pago IN ('cheque', 'deposito') THEN 'EN_CARTERA'
                             WHEN v_det.tipo_pago = 'efectivo' THEN
                               CASE WHEN v_es_calle AND v_billetera_id IS NOT NULL THEN 'BILLETERA' ELSE 'CAJA' END
                             ELSE 'BANCO' END;
      v_destino_id   := CASE WHEN v_det.tipo_pago = 'efectivo' THEN
                               CASE WHEN v_es_calle AND v_billetera_id IS NOT NULL THEN v_billetera_id
                                    ELSE COALESCE(v_det.caja_id, v_caja_default) END
                             WHEN v_det.tipo_pago IN ('transferencia', 'deposito') THEN v_det.cuenta_bancaria_id
                             ELSE NULL END;

      PERFORM kardex_registrar(
        p_tipo_movimiento => 'COBRO_CLIENTE',
        p_concepto        => 'Cobro ' || COALESCE(v_numero_recibo, '') || ' — ' || upper(COALESCE(v_det.tipo_pago, ''))
                             || CASE WHEN v_destino_tipo = 'BILLETERA' THEN ' (en calle)' ELSE '' END,
        p_monto           => v_det.monto,
        p_color           => CASE WHEN v_det.color_cheque = 'ECHEQ' THEN 'BLANCO' ELSE v_det.color_cheque END,
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
        p_cobrador_id     => COALESCE(v_billetera_id, p_usuario_id),
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
$function$
;
