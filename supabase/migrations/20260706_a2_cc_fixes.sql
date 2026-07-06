-- ─────────────────────────────────────────────────────────────────────────────
-- FASE A2 — Fixes de integridad de cuenta corriente
--
-- 1. cc_ajuste_manual: los ajustes manuales de saldo posteaban a
--    comprobantes_venta.saldo_pendiente SIN pasar por el libro mayor
--    (cc_postear) → v_saldo_clientes divergía para siempre. Ahora el ajuste
--    ES un movimiento del libro mayor y NO toca saldo_pendiente.
--
-- 2. cheque_rechazar: la versión TS generaba ND + posteo al libro mayor sin
--    verificar si el pago de origen estaba confirmado → si el pago estaba
--    pendiente (nunca acreditó el haber) el cliente quedaba con deuda
--    duplicada. Ahora: pago pendiente → se rechaza el pago sin ND; pago
--    confirmado → ND + libro mayor + kardex, con numeración transaccional
--    (bonus: la numeración NDC no existía y el número salía hardcodeado).
--
-- 3. v_cc_reconciliacion: vista de control permanente — saldo del libro
--    mayor vs suma de saldo_pendiente de documentos por cliente.
--
-- 4. cuenta_corriente_ajustes: DEPRECADA sin backfill. Verificado en datos:
--    sus 2 filas son las NCA 0007-00000001/2 que YA están posteadas en el
--    libro mayor vía cc_postear (backfillearlas duplicaría el crédito).
--
-- Idempotente: CREATE OR REPLACE / IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════
-- 1. cc_ajuste_manual — ajuste de cuenta corriente vía libro mayor
--    p_tipo: 'debito' (aumenta deuda) | 'credito' (reduce deuda)
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.cc_ajuste_manual(
  p_cliente_id uuid,
  p_tipo       text,
  p_monto      numeric,
  p_concepto   text,
  p_usuario_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_tipo NOT IN ('debito', 'credito') THEN
    RAISE EXCEPTION 'cc_ajuste_manual: p_tipo debe ser debito o credito (recibido: %)', p_tipo;
  END IF;
  IF COALESCE(p_monto, 0) <= 0 THEN
    RAISE EXCEPTION 'cc_ajuste_manual: p_monto debe ser > 0';
  END IF;
  IF COALESCE(trim(p_concepto), '') = '' THEN
    RAISE EXCEPTION 'cc_ajuste_manual: p_concepto es obligatorio';
  END IF;

  v_id := cc_postear(
    p_cliente_id, 'ajuste',
    CASE WHEN p_tipo = 'debito' THEN p_monto ELSE 0 END,
    CASE WHEN p_tipo = 'credito' THEN p_monto ELSE 0 END,
    'ajuste_manual', NULL,
    NULL, p_concepto, p_usuario_id
  );

  RETURN v_id;
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 2. cheque_rechazar — rechazo con validación del estado del pago origen
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.cheque_rechazar(
  p_cheque_id  uuid,
  p_usuario_id uuid,
  p_motivo     text DEFAULT NULL,
  p_gastos     numeric DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cheque     cheques%ROWTYPE;
  v_pago       pagos_clientes%ROWTYPE;
  v_pago_id    uuid;
  v_total      numeric;
  v_siguiente  bigint;
  v_numero_nd  text;
  v_nd_id      uuid;
  v_motivo     text := COALESCE(NULLIF(trim(p_motivo), ''), 'Cheque rechazado');
BEGIN
  SELECT * INTO v_cheque FROM cheques WHERE id = p_cheque_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cheque_rechazar: cheque % no encontrado', p_cheque_id;
  END IF;
  IF v_cheque.estado = 'RECHAZADO' THEN
    RETURN jsonb_build_object('success', true, 'ya_rechazado', true);
  END IF;

  -- Pago de origen del cheque (directo o vía items de depósito)
  SELECT pd.pago_id INTO v_pago_id
  FROM pagos_detalle pd
  WHERE pd.cheque_id = p_cheque_id
  UNION
  SELECT pd.pago_id
  FROM pago_deposito_items pdi
  JOIN pagos_detalle pd ON pd.id = pdi.pago_detalle_id
  WHERE pdi.cheque_id = p_cheque_id
  LIMIT 1;

  IF v_pago_id IS NOT NULL THEN
    SELECT * INTO v_pago FROM pagos_clientes WHERE id = v_pago_id FOR UPDATE;
  END IF;

  -- ── Cheque → RECHAZADO (siempre) ──
  UPDATE cheques
  SET estado = 'RECHAZADO',
      fecha_rechazo = (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date,
      motivo_rechazo = v_motivo
  WHERE id = p_cheque_id;

  -- ── CASO 1: pago origen NO confirmado → rechazar el pago, SIN ND ni CC ──
  -- El pago pendiente nunca acreditó el haber en el libro mayor: generar ND
  -- acá duplicaría la deuda (bug de la versión anterior).
  IF v_pago_id IS NOT NULL AND v_pago.estado IN ('pendiente', 'pendiente_rendicion') THEN
    UPDATE pagos_clientes
    SET estado = 'rechazado',
        motivo_rechazo = 'Cheque rechazado: ' || v_motivo,
        fecha_confirmacion = now()
    WHERE id = v_pago_id;

    DELETE FROM imputaciones WHERE pago_id = v_pago_id AND estado = 'pendiente';

    RETURN jsonb_build_object(
      'success', true, 'ya_rechazado', false,
      'pago_rechazado', true, 'pago_id', v_pago_id,
      'nd_generada', false,
      'mensaje', 'Cheque rechazado. El pago estaba sin confirmar: se rechazó el pago, sin generar débito.'
    );
  END IF;

  -- ── CASO 2: pago confirmado (o cheque sin pago rastreable) → ND + CC + kardex ──
  IF v_cheque.cliente_origen_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', true, 'ya_rechazado', false, 'nd_generada', false,
      'mensaje', 'Cheque rechazado. Sin cliente origen: no se generó débito automático.'
    );
  END IF;

  v_total := abs(v_cheque.monto) + GREATEST(COALESCE(p_gastos, 0), 0);

  -- Numeración NDC transaccional (se crea el contador si no existe)
  SELECT ultimo_numero + 1 INTO v_siguiente
  FROM numeracion_comprobantes
  WHERE tipo_comprobante = 'NDC' AND punto_venta = '0001'
  FOR UPDATE;

  IF v_siguiente IS NULL THEN
    v_siguiente := 1;
    INSERT INTO numeracion_comprobantes (tipo_comprobante, punto_venta, ultimo_numero)
    VALUES ('NDC', '0001', 1);
  ELSE
    UPDATE numeracion_comprobantes SET ultimo_numero = v_siguiente
    WHERE tipo_comprobante = 'NDC' AND punto_venta = '0001';
  END IF;

  v_numero_nd := '0001-' || lpad(v_siguiente::text, 8, '0');

  INSERT INTO comprobantes_venta (
    cliente_id, tipo_comprobante, numero_comprobante, fecha,
    total_neto, total_iva, total_factura, saldo_pendiente, estado_pago,
    observaciones, creado_por
  ) VALUES (
    v_cheque.cliente_origen_id, 'NDC', v_numero_nd,
    (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date,
    v_total, 0, v_total, v_total, 'pendiente',
    'Débito por cheque rechazado Nro. ' || COALESCE(v_cheque.numero, left(p_cheque_id::text, 8))
      || ' — ' || v_motivo
      || CASE WHEN COALESCE(p_gastos, 0) > 0
              THEN '. Incluye gastos bancarios: $' || p_gastos::text ELSE '' END,
    p_usuario_id
  ) RETURNING id INTO v_nd_id;

  PERFORM cc_postear(
    v_cheque.cliente_origen_id, 'nota_debito',
    v_total, 0,
    'comprobante_venta', v_nd_id,
    v_numero_nd,
    'Débito por cheque rechazado Nro. ' || COALESCE(v_cheque.numero, left(p_cheque_id::text, 8)),
    p_usuario_id
  );

  INSERT INTO kardex_contable (
    tipo_movimiento, concepto, monto, color,
    origen_tipo, origen_id, destino_tipo, destino_id, metodo,
    referencia_tipo, referencia_id, cheque_id, cliente_id, cobrador_id
  ) VALUES (
    'DEBITO_CHEQUE_RECHAZADO',
    'Cheque rechazado Nro. ' || COALESCE(v_cheque.numero, left(p_cheque_id::text, 8)) || ' — ND ' || v_numero_nd,
    v_total, v_cheque.color::text,
    'EN_CARTERA', p_cheque_id, 'CLIENTE', v_cheque.cliente_origen_id, 'CHEQUE_TERCERO',
    'cheque', p_cheque_id, p_cheque_id, v_cheque.cliente_origen_id, p_usuario_id
  );

  RETURN jsonb_build_object(
    'success', true, 'ya_rechazado', false,
    'pago_rechazado', false,
    'nd_generada', true, 'nd_id', v_nd_id, 'numero_nd', v_numero_nd,
    'total_debitado', v_total,
    'mensaje', 'Cheque rechazado. Se generó ND ' || v_numero_nd || ' por $' || v_total::text || ' al cliente.'
  );
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 3. v_cc_reconciliacion — control permanente libro mayor vs documentos
--    saldo_libro:      Σdebe − Σhaber (v_saldo_clientes)
--    saldo_documentos: Σ saldo_pendiente de comprobantes no anulados
--                      (las NC llevan saldo_pendiente negativo)
--    Diferencias esperables SOLO por pagos a cuenta sin imputar o NC sin
--    imputar contra FA (se cierran en Fase A3).
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.v_cc_reconciliacion AS
SELECT
  c.id            AS cliente_id,
  c.nombre        AS cliente_nombre,
  COALESCE(lm.saldo_libro, 0)      AS saldo_libro,
  COALESCE(doc.saldo_documentos, 0) AS saldo_documentos,
  COALESCE(lm.saldo_libro, 0) - COALESCE(doc.saldo_documentos, 0) AS diferencia
FROM clientes c
LEFT JOIN (
  SELECT cliente_id, sum(debe) - sum(haber) AS saldo_libro
  FROM cuenta_corriente_clientes
  GROUP BY cliente_id
) lm ON lm.cliente_id = c.id
LEFT JOIN (
  SELECT cliente_id, sum(saldo_pendiente) AS saldo_documentos
  FROM comprobantes_venta
  WHERE COALESCE(estado_pago, '') <> 'anulado'
  GROUP BY cliente_id
) doc ON doc.cliente_id = c.id
WHERE COALESCE(lm.saldo_libro, 0) <> 0 OR COALESCE(doc.saldo_documentos, 0) <> 0;

-- ═════════════════════════════════════════════════════════════════════════
-- 4. Deprecar cuenta_corriente_ajustes (sin backfill — ver header)
-- ═════════════════════════════════════════════════════════════════════════
COMMENT ON TABLE public.cuenta_corriente_ajustes IS
  'DEPRECADA (Fase A2, 2026-07-06). Sus 2 filas son las NCA 0007-00000001/2 ya '
  'posteadas en cuenta_corriente_clientes. Los ajustes manuales ahora van por '
  'cc_ajuste_manual() → libro mayor. No escribir más acá; drop previsto post-Fase B.';

-- ── Permisos ──
REVOKE ALL ON FUNCTION public.cc_ajuste_manual(uuid, text, numeric, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cheque_rechazar(uuid, uuid, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cc_ajuste_manual(uuid, text, numeric, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cheque_rechazar(uuid, uuid, text, numeric) TO authenticated, service_role;
GRANT SELECT ON public.v_cc_reconciliacion TO authenticated, service_role;
