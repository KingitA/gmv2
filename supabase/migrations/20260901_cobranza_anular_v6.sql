-- ============================================================================
-- cobranza_anular v6 — un pago RENDIDO Y CONFIRMADO no se puede anular
--
-- v6 = v5 + guard de rendición confirmada (regla del dueño, auditoría 31/08):
-- si el pago ya fue rendido por el cobrador y la oficina confirmó la rendición,
-- el efectivo ya viajó BILLETERA→CAJA por un kardex RENDICION_VIAJE aparte.
-- El paso 6 de esta función espeja el kardex del cobro original (destino
-- BILLETERA), así que anular acá dejaría la billetera del cobrador en negativo
-- y la caja con plata de más — bug reproducido en la auditoría. La corrección
-- de un cobro ya rendido+confirmado se hace con ajuste/contramovimiento.
--
-- (Hereda de v5: destildar kardex.comprobante_cobrado; de v4: reversa de
-- ajustes por redondeo vinculados [pago:]/[saldo:]; de v3: bonificaciones por
-- vínculo estructural — REV interna se revierte completa; NC fiscal con CAE
-- se informa para emitir ND.)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cobranza_anular(p_pago_id uuid, p_usuario_id uuid, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_kx                record;
  v_bonif             record;
  v_deb               record;
  v_ncs_fiscales      text[] := '{}';
  v_aj                record;
  v_aj_comp_id        uuid;
BEGIN
  SELECT * INTO v_pago FROM pagos_clientes WHERE id = p_pago_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cobranza_anular: pago % no encontrado', p_pago_id;
  END IF;
  IF v_pago.estado = 'anulado' THEN
    RETURN jsonb_build_object('success', true, 'ya_anulado', true);
  END IF;

  -- ── v6: pago rendido y confirmado → NO se anula ──
  -- El prefijo RENDIDO_CONFIRMADO es contrato con las API routes, que lo
  -- traducen a un 409 con mensaje amigable.
  IF EXISTS (
    SELECT 1
    FROM rendicion_items ri
    JOIN rendiciones r ON r.id = ri.rendicion_id
    WHERE ri.pago_id = p_pago_id
      AND r.estado = 'confirmada'
  ) THEN
    RAISE EXCEPTION 'RENDIDO_CONFIRMADO: el pago % ya fue rendido y confirmado — no se puede anular; corregilo con un ajuste o contramovimiento', left(p_pago_id::text, 8);
  END IF;

  v_estaba_confirmado := (v_pago.estado = 'confirmado');

  SELECT array_agg(DISTINCT comprobante_id) INTO v_comprobante_ids
  FROM imputaciones WHERE pago_id = p_pago_id AND comprobante_id IS NOT NULL;

  -- ── 1. Restaurar saldos de comprobantes (solo imputaciones confirmadas) ──
  FOR v_imp IN
    SELECT id, comprobante_id, monto_imputado, estado
    FROM imputaciones
    WHERE pago_id = p_pago_id AND comprobante_id IS NOT NULL
  LOOP
    SELECT id, tipo_comprobante, observaciones, saldo_pendiente, total_factura
    INTO v_comp FROM comprobantes_venta WHERE id = v_imp.comprobante_id FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;

    IF v_comp.tipo_comprobante IN ('REV', 'NCA', 'NCB', 'NCC')
       AND COALESCE(v_comp.observaciones, '') LIKE 'Bonificación contado%' THEN
      -- Modelo pozo (legado): la NC de bonificación estaba imputada AL pago.
      -- Prefijo estricto: las NC comerciales que solo mencionan "bonificación"
      -- en el texto ya no caen acá — se restauran como cualquier crédito.
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

  -- ── 1b. Bonificaciones del modelo actual (crédito imputado a los
  --        comprobantes de este pago) ──
  IF v_comprobante_ids IS NOT NULL THEN
    FOR v_bonif IN
      SELECT DISTINCT nc.id, nc.tipo_comprobante, nc.numero_comprobante, nc.total_factura, nc.cliente_id
      FROM imputaciones i
      JOIN comprobantes_venta nc ON nc.id = i.credito_comprobante_id
      WHERE i.comprobante_id = ANY (v_comprobante_ids)
        AND i.estado = 'confirmado'
        AND nc.tipo_comprobante IN ('REV', 'NCA', 'NCB', 'NCC')
        AND nc.anulado_en IS NULL
        AND nc.estado_pago <> 'anulado'
        AND COALESCE(nc.observaciones, '') LIKE 'Bonificación contado%'
    LOOP
      IF v_bonif.tipo_comprobante = 'REV' THEN
        -- REV interna: reversa completa.
        FOR v_imp IN
          SELECT id, comprobante_id, monto_imputado
          FROM imputaciones
          WHERE credito_comprobante_id = v_bonif.id
            AND comprobante_id = ANY (v_comprobante_ids)
            AND estado = 'confirmado'
        LOOP
          UPDATE imputaciones SET estado = 'anulado' WHERE id = v_imp.id;
          SELECT id, saldo_pendiente, total_factura INTO v_deb
          FROM comprobantes_venta WHERE id = v_imp.comprobante_id FOR UPDATE;
          IF FOUND THEN
            v_total_fact  := abs(COALESCE(v_deb.total_factura, 0));
            v_nuevo_saldo := LEAST(v_total_fact, COALESCE(v_deb.saldo_pendiente, 0) + abs(COALESCE(v_imp.monto_imputado, 0)));
            UPDATE comprobantes_venta
            SET saldo_pendiente = v_nuevo_saldo,
                estado_pago = CASE
                  WHEN v_nuevo_saldo <= 0 THEN 'pagado'
                  WHEN v_nuevo_saldo >= v_total_fact THEN 'pendiente'
                  ELSE 'parcial' END
            WHERE id = v_deb.id;
          END IF;
        END LOOP;

        UPDATE comprobantes_venta
        SET estado_pago = 'anulado', saldo_pendiente = 0, anulado_en = now()
        WHERE id = v_bonif.id;

        -- Contra-asiento en el libro (la REV había posteado un haber)
        IF NOT EXISTS (
          SELECT 1 FROM cuenta_corriente_clientes
          WHERE referencia_id = v_bonif.id AND debe > 0
        ) THEN
          PERFORM cc_postear(
            v_bonif.cliente_id, 'nota_credito',
            abs(v_bonif.total_factura), 0,
            'comprobante_venta', v_bonif.id,
            v_bonif.numero_comprobante,
            'Anulación bonificación 10% por anulación del pago ' || left(p_pago_id::text, 8),
            p_usuario_id
          );
        END IF;
      ELSE
        -- NC fiscal con CAE: no se anula desde acá — requiere ND.
        v_ncs_fiscales := array_append(v_ncs_fiscales, v_bonif.tipo_comprobante || ' ' || v_bonif.numero_comprobante);
      END IF;
    END LOOP;
  END IF;

  -- ── 1c. Ajustes por redondeo nacidos de este pago ──
  -- Se revierten con contra-asiento (marca [reversa:<id>], la misma del 🗑 de
  -- la cta cte) y, si el ajuste había saldado un comprobante ([saldo:<id>]),
  -- ese saldo se restaura.
  FOR v_aj IN
    SELECT id, cliente_id, debe, haber, observaciones
    FROM cuenta_corriente_clientes
    WHERE tipo_movimiento = 'ajuste'
      AND referencia_tipo = 'ajuste_manual'
      AND observaciones LIKE '%[pago:' || p_pago_id || ']%'
  LOOP
    -- Guard: ya revertido (por una anulación previa o por el 🗑 manual)
    IF EXISTS (
      SELECT 1 FROM cuenta_corriente_clientes
      WHERE observaciones LIKE '%[reversa:' || v_aj.id || ']%'
    ) THEN
      CONTINUE;
    END IF;

    PERFORM cc_postear(
      v_aj.cliente_id, 'ajuste',
      v_aj.haber, v_aj.debe,   -- contra-asiento exacto (invertido)
      'ajuste_manual', NULL, NULL,
      'Reversa de ajuste por anulación del pago ' || left(p_pago_id::text, 8) || ' [reversa:' || v_aj.id || ']',
      p_usuario_id
    );

    -- ¿El ajuste había saldado un comprobante? → restaurar su saldo
    v_aj_comp_id := (regexp_match(COALESCE(v_aj.observaciones, ''), '\[saldo:([0-9a-fA-F-]{36})\]'))[1]::uuid;
    IF v_aj_comp_id IS NOT NULL THEN
      SELECT id, saldo_pendiente, total_factura INTO v_deb
      FROM comprobantes_venta WHERE id = v_aj_comp_id FOR UPDATE;
      IF FOUND THEN
        v_total_fact  := abs(COALESCE(v_deb.total_factura, 0));
        v_nuevo_saldo := LEAST(v_total_fact, COALESCE(v_deb.saldo_pendiente, 0) + abs(v_aj.haber - v_aj.debe));
        UPDATE comprobantes_venta
        SET saldo_pendiente = v_nuevo_saldo,
            estado_pago = CASE
              WHEN v_nuevo_saldo <= 0 THEN 'pagado'
              WHEN v_nuevo_saldo >= v_total_fact THEN 'pendiente'
              ELSE 'parcial' END
        WHERE id = v_deb.id;
      END IF;
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

  -- ── 5. Libro mayor: contrapartida (guard) ──
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

  -- ── 6. Kardex + saldos: reversa línea por línea del kardex original (guard) ──
  IF NOT EXISTS (
    SELECT 1 FROM kardex_contable
    WHERE tipo_movimiento = 'ANULACION_COBRO'
      AND referencia_tipo = 'pago_anulacion' AND referencia_id = p_pago_id
  ) THEN
    FOR v_kx IN
      SELECT id, monto, color, origen_tipo, origen_id, destino_tipo, destino_id, metodo, cheque_id
      FROM kardex_contable
      WHERE tipo_movimiento = 'COBRO_CLIENTE'
        AND referencia_tipo = 'pago_cliente'
        AND referencia_id = p_pago_id
        AND kardex_reversa_de IS NULL
    LOOP
      -- la plata vuelve a salir de donde había entrado
      PERFORM kardex_registrar(
        p_tipo_movimiento => 'ANULACION_COBRO',
        p_concepto        => 'Anulación pago ' || left(p_pago_id::text, 8)
                             || CASE WHEN p_motivo IS NOT NULL AND p_motivo <> '' THEN ' — ' || p_motivo ELSE '' END,
        p_monto           => v_kx.monto,
        p_color           => v_kx.color,
        p_origen_tipo     => v_kx.destino_tipo,
        p_origen_id       => v_kx.destino_id,
        p_destino_tipo    => 'CLIENTE',
        p_destino_id      => v_pago.cliente_id,
        p_metodo          => v_kx.metodo,
        p_referencia_tipo => 'pago_anulacion',
        p_referencia_id   => p_pago_id,
        p_pago_id         => p_pago_id,
        p_cheque_id       => v_kx.cheque_id,
        p_cliente_id      => v_pago.cliente_id,
        p_cobrador_id     => p_usuario_id,
        p_usuario_id      => p_usuario_id,
        p_reversa_de      => v_kx.id
      );
    END LOOP;

    -- pago sin kardex previo (nunca confirmado): línea informativa única
    IF NOT FOUND THEN
      INSERT INTO kardex_contable (
        tipo_movimiento, concepto, monto, origen_tipo, origen_id,
        referencia_tipo, referencia_id, pago_id, cliente_id, cobrador_id
      )
      SELECT 'ANULACION_COBRO',
             'Anulación pago ' || left(p_pago_id::text, 8)
               || CASE WHEN p_motivo IS NOT NULL AND p_motivo <> '' THEN ' — ' || p_motivo ELSE '' END,
             -abs(v_pago.monto), 'CLIENTE', v_pago.cliente_id,
             'pago_anulacion', p_pago_id, p_pago_id, v_pago.cliente_id, p_usuario_id
      WHERE NOT EXISTS (
        SELECT 1 FROM kardex_contable
        WHERE tipo_movimiento = 'COBRO_CLIENTE'
          AND referencia_tipo = 'pago_cliente' AND referencia_id = p_pago_id
      );
    END IF;
  END IF;

  -- ── 7. Comisiones 'cobrada' de los comprobantes de este pago ──
  IF v_comprobante_ids IS NOT NULL THEN
    DELETE FROM comisiones
    WHERE tipo = 'cobrada'
      AND pagado = false
      AND comprobante_venta_id = ANY (v_comprobante_ids);

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

    UPDATE comisiones
    SET comprobante_cobrado = false, fecha_comprobante_cobrado = NULL
    WHERE tipo = 'vendida'
      AND comprobante_venta_id = ANY (v_comprobante_ids)
      AND comprobante_venta_id IN (
        SELECT id FROM comprobantes_venta WHERE estado_pago <> 'pagado'
      );
  END IF;

  -- ── 7b. Kardex de mercadería: destildar "cobrado" en los comprobantes que
  --        dejaron de estar pagados con esta anulación ──
  IF v_comprobante_ids IS NOT NULL THEN
    UPDATE kardex k
    SET comprobante_cobrado = false, fecha_comprobante_cobrado = NULL
    WHERE k.comprobante_venta_id = ANY (v_comprobante_ids)
      AND k.comprobante_cobrado = true
      AND EXISTS (
        SELECT 1 FROM comprobantes_venta cv
        WHERE cv.id = k.comprobante_venta_id AND cv.estado_pago <> 'pagado'
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
    'estaba_confirmado', v_estaba_confirmado,
    'bonificaciones_fiscales_pendientes',
      CASE WHEN array_length(v_ncs_fiscales, 1) > 0 THEN to_jsonb(v_ncs_fiscales) ELSE NULL END
  );
END;
$function$;

-- (El backfill de kardex.comprobante_cobrado de la v5 ya se aplicó con esa
-- migración; no se repite acá.)
