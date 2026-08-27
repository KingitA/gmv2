-- ============================================================================
-- cobranza_confirmar — el efectivo cobrado EN LA CALLE va a la BILLETERA
-- ============================================================================
-- Bug (27/08/2026, prueba Fitterer): al confirmar un cobro de viajante/chofer
-- el efectivo se registraba COBRO_CLIENTE → CAJA (Caja Chica) y después la
-- rendición volvía a meterlo BILLETERA → CAJA: la caja sumaba la plata dos
-- veces (241.500 + 241.000) y la Caja del Día mostraba dos entradas.
--
-- Ahora: si el pago es de la calle (cobrador_tipo viajante/chofer), el
-- efectivo se asienta CLIENTE → BILLETERA del cobrador (no mueve fondos de
-- caja: BILLETERA no es CAJA/BANCO). A la caja entra una sola vez, con la
-- rendición. Cheques → EN_CARTERA y transferencias → BANCO, como siempre.
-- Cobros de oficina: sin cambios (CAJA).
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

      -- Destino del dinero:
      --   cheque/depósito → EN_CARTERA
      --   efectivo        → BILLETERA del cobrador si es cobro de calle, si no CAJA
      --   transferencia   → BANCO
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
$function$;


-- ============================================================================
-- Corrección de datos de la prueba Fitterer (27/08): REC-0001-00000032
-- ============================================================================
-- 1) La Caja Chica recibió 241.500 al confirmar el cobro Y 241.000 con la
--    rendición 59f655ad. Se saca la primera (la plata entró UNA vez, con la
--    rendición), dejando rastro.
-- 2) Las comisiones 'cobradas' del PRES 0001-00000010 no se insertaron
--    (solo quedaron las 'vendidas'); se generan desde el kardex, con el
--    débito del 10% por la REV de contado, igual que hace post-confirmación.
DO $$
DECLARE
  v_caja_chica uuid;
  v_rossi      uuid := '8146a51a-b423-4a0f-b207-2b78341e1b91';
  v_pres       uuid;
  v_pedido     uuid;
  v_kx         record;
  v_total_com  numeric := 0;
  v_motivo     text := 'Débito por NC financiera 10% (descuento contado) sobre comisión ya cobrada';
BEGIN
  SELECT id INTO v_caja_chica FROM cajas_financieras WHERE nombre = 'Caja Chica' LIMIT 1;
  IF v_caja_chica IS NULL THEN RAISE EXCEPTION 'No encuentro Caja Chica'; END IF;

  -- 1) Caja: sacar los 241.500 contados de más (idempotente por concepto)
  IF NOT EXISTS (
    SELECT 1 FROM kardex_contable WHERE concepto LIKE 'Corrección: cobro en calle REC-0001-00000032%'
  ) THEN
    PERFORM kardex_registrar(
      p_tipo_movimiento => 'AJUSTE_CAJA',
      p_concepto        => 'Corrección: cobro en calle REC-0001-00000032 se había contado en Caja Chica al confirmar; la plata entró con la rendición 59f655ad',
      p_monto           => 241500,
      p_color           => 'BLANCO',
      p_origen_tipo     => 'CAJA',
      p_origen_id       => v_caja_chica,
      p_destino_tipo    => 'BILLETERA',
      p_destino_id      => v_rossi,
      p_metodo          => 'EFECTIVO',
      p_referencia_tipo => 'correccion',
      p_cobrador_id     => v_rossi,
      p_verificado      => true
    );
    -- y el asiento original pasa a decir la verdad (destino billetera)
    UPDATE kardex_contable
    SET destino_tipo = 'BILLETERA', destino_id = v_rossi, concepto = concepto || ' (en calle)'
    WHERE tipo_movimiento = 'COBRO_CLIENTE' AND concepto = 'Cobro REC-0001-00000032 — EFECTIVO'
      AND destino_tipo = 'CAJA';
  END IF;

  -- 2) Comisiones cobradas del PRES 0001-00000010
  SELECT id, pedido_id INTO v_pres, v_pedido
  FROM comprobantes_venta WHERE tipo_comprobante = 'PRES' AND numero_comprobante = '0001-00000010' AND anulado_en IS NULL;
  IF v_pres IS NULL THEN RAISE EXCEPTION 'No encuentro PRES 0001-00000010'; END IF;

  IF NOT EXISTS (SELECT 1 FROM comisiones WHERE comprobante_venta_id = v_pres AND tipo = 'cobrada' AND monto > 0) THEN
    FOR v_kx IN
      SELECT k.id, k.articulo_id, k.cantidad, k.precio_unitario_final, k.comision_viajante_pct, k.comision_viajante_monto,
             k.vendedor_id, k.pedido_id, a.segmento_precio
      FROM kardex k LEFT JOIN articulos a ON a.id = k.articulo_id
      WHERE k.comprobante_venta_id = v_pres AND k.tipo_movimiento = 'venta'
        AND k.comision_viajante_monto IS NOT NULL AND k.comision_viajante_monto <> 0 AND k.vendedor_id IS NOT NULL
    LOOP
      INSERT INTO comisiones (viajante_id, pedido_id, comprobante_venta_id, kardex_id, tipo, articulo_id, segmento,
                              cantidad, precio_neto_unitario, porcentaje, monto, comprobante_cobrado, fecha_comprobante_cobrado, pagado)
      VALUES (v_kx.vendedor_id, v_kx.pedido_id, v_pres, v_kx.id, 'cobrada', v_kx.articulo_id, v_kx.segmento_precio,
              v_kx.cantidad, v_kx.precio_unitario_final, v_kx.comision_viajante_pct, v_kx.comision_viajante_monto, true, now(), false);
      v_total_com := v_total_com + v_kx.comision_viajante_monto;
    END LOOP;

    -- Débito 10% (hay REV de bonificación contado viva sobre este PRES)
    IF v_total_com <> 0 AND EXISTS (
      SELECT 1 FROM imputaciones i JOIN comprobantes_venta cr ON cr.id = i.credito_comprobante_id
      WHERE i.comprobante_id = v_pres AND i.estado <> 'anulado' AND cr.anulado_en IS NULL
        AND cr.observaciones LIKE 'Bonificación contado%'
    ) THEN
      INSERT INTO comisiones (viajante_id, pedido_id, comprobante_venta_id, tipo, monto, porcentaje,
                              comprobante_cobrado, fecha_comprobante_cobrado, pagado, motivo)
      VALUES (v_rossi, v_pedido, v_pres, 'cobrada', -round(v_total_com * 0.10, 2), 10, true, now(), false, v_motivo);
    END IF;
  END IF;

  RAISE NOTICE 'OK: caja corregida, comisiones cobradas del PRES 10 = % (menos 10%%)', v_total_com;
END $$;
