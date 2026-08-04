-- ─────────────────────────────────────────────────────────────────────────────
-- FASE S1 — Acuerdo de pago por canal (blanco/negro) + NC en la OP +
-- retención SOLO sobre comprobantes fiscales (REQUIERE R1-R7)
--
-- Reglas de negocio (definidas con el usuario 05-08-2026):
--   · Cada proveedor tiene un acuerdo por canal: medio (transferencia /
--     cheques / efectivo / cheques_y_efectivo), plazo de cheques, entrega
--     (transferencia / depósito bancario / retira oficina / envío Grimar),
--     plazo de pago en días y desde cuándo corre (factura o recepción).
--     Canal negro NULL = hereda el acuerdo blanco.
--   · Retención de Ganancias: SOLO facturas fiscales (FA/FB/FC/ND*). Las
--     Adquisiciones y provisiones JAMÁS retienen. Las NC fiscales restan
--     base (retención neta). Las Reversas (crédito negro) restan plata
--     pero NUNCA tocan la base.
--   · La OP acepta imputaciones negativas (créditos NC/Reversa) que se
--     descuentan del pago y consumen el saldo del crédito al confirmar.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ 1. Acuerdo de pago por canal en proveedores ═══
ALTER TABLE public.proveedores
  ADD COLUMN IF NOT EXISTS pago_blanco_medio        varchar(20),
  ADD COLUMN IF NOT EXISTS pago_blanco_plazo_cheque int,
  ADD COLUMN IF NOT EXISTS pago_blanco_entrega      varchar(20),
  ADD COLUMN IF NOT EXISTS pago_blanco_dias         int,
  ADD COLUMN IF NOT EXISTS pago_blanco_desde        varchar(10),
  ADD COLUMN IF NOT EXISTS pago_negro_medio         varchar(20),
  ADD COLUMN IF NOT EXISTS pago_negro_plazo_cheque  int,
  ADD COLUMN IF NOT EXISTS pago_negro_entrega       varchar(20),
  ADD COLUMN IF NOT EXISTS pago_negro_dias          int,
  ADD COLUMN IF NOT EXISTS pago_negro_desde         varchar(10);

DO $$
BEGIN
  ALTER TABLE public.proveedores ADD CONSTRAINT prov_pago_blanco_medio_check
    CHECK (pago_blanco_medio IS NULL OR pago_blanco_medio IN ('transferencia','cheques','efectivo','cheques_y_efectivo'));
  ALTER TABLE public.proveedores ADD CONSTRAINT prov_pago_negro_medio_check
    CHECK (pago_negro_medio IS NULL OR pago_negro_medio IN ('transferencia','cheques','efectivo','cheques_y_efectivo'));
  ALTER TABLE public.proveedores ADD CONSTRAINT prov_pago_blanco_entrega_check
    CHECK (pago_blanco_entrega IS NULL OR pago_blanco_entrega IN ('transferencia','deposito_bancario','retira_oficina','envio_grimar'));
  ALTER TABLE public.proveedores ADD CONSTRAINT prov_pago_negro_entrega_check
    CHECK (pago_negro_entrega IS NULL OR pago_negro_entrega IN ('transferencia','deposito_bancario','retira_oficina','envio_grimar'));
  ALTER TABLE public.proveedores ADD CONSTRAINT prov_pago_blanco_desde_check
    CHECK (pago_blanco_desde IS NULL OR pago_blanco_desde IN ('factura','recepcion'));
  ALTER TABLE public.proveedores ADD CONSTRAINT prov_pago_negro_desde_check
    CHECK (pago_negro_desde IS NULL OR pago_negro_desde IN ('factura','recepcion'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Backfill desde lo existente (R7 forma_pago_default + dias_vencimiento)
UPDATE public.proveedores SET
  pago_blanco_medio = CASE forma_pago_default
    WHEN 'cheque' THEN 'cheques'
    WHEN 'transferencia' THEN 'transferencia'
    WHEN 'efectivo' THEN 'efectivo'
    ELSE pago_blanco_medio END,
  pago_blanco_entrega = CASE forma_pago_default
    WHEN 'transferencia' THEN 'transferencia'
    ELSE pago_blanco_entrega END
WHERE forma_pago_default IS NOT NULL AND pago_blanco_medio IS NULL;

UPDATE public.proveedores SET pago_blanco_dias = dias_vencimiento
WHERE pago_blanco_dias IS NULL AND dias_vencimiento IS NOT NULL;

UPDATE public.proveedores SET pago_blanco_desde = 'factura'
WHERE pago_blanco_desde IS NULL;

-- ═══ 2. Canal en vencimientos + modalidad 'grimar' ═══
ALTER TABLE public.vencimientos
  ADD COLUMN IF NOT EXISTS canal varchar(10) NOT NULL DEFAULT 'blanco';
DO $$
BEGIN
  ALTER TABLE public.vencimientos ADD CONSTRAINT vencimientos_canal_check
    CHECK (canal IN ('blanco','negro'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.vencimientos DROP CONSTRAINT IF EXISTS vencimientos_modalidad_check;
ALTER TABLE public.vencimientos ADD CONSTRAINT vencimientos_modalidad_check
  CHECK (modalidad IS NULL OR modalidad IN ('deposito','entrega','grimar'));

-- ═══ 3. Créditos descontados en la OP ═══
ALTER TABLE public.ordenes_pago
  ADD COLUMN IF NOT EXISTS total_creditos numeric(14,2) NOT NULL DEFAULT 0;

-- ═══ 4. op_ganancias_bases v3 — retención SOLO comprobantes fiscales ═══
--   FA/FB/FC/ND* → base positiva (neto prorrateado)
--   NC/NCA/NCB/NCC → base NEGATIVA (neto prorrateado) — retención neta de NC
--   Adquisicion / Reversa / Remito / provisiones / pago a cuenta → base 0
CREATE OR REPLACE FUNCTION public.op_ganancias_bases(
  p_imputaciones jsonb
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item        jsonb;
  v_monto       numeric;
  v_comp_id     uuid;
  v_cc          record;
  v_venc        record;
  v_comp        record;
  v_base        numeric;
  v_tipo        text;
  v_detalle     jsonb := '[]'::jsonb;
  v_total       numeric := 0;
  v_etiqueta    text;
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_imputaciones, '[]'::jsonb))
  LOOP
    v_monto := COALESCE((v_item->>'monto_imputado')::numeric, 0);
    IF v_monto = 0 THEN CONTINUE; END IF;

    v_comp_id := NULL;
    v_etiqueta := 'imputación';

    IF v_item->>'comprobante_compra_id' IS NOT NULL THEN
      v_comp_id := (v_item->>'comprobante_compra_id')::uuid;
    ELSIF v_item->>'movimiento_cc_id' IS NOT NULL THEN
      SELECT referencia_tipo, referencia_id, descripcion INTO v_cc
      FROM cuenta_corriente_proveedores WHERE id = (v_item->>'movimiento_cc_id')::uuid;
      IF FOUND THEN
        v_etiqueta := COALESCE(v_cc.descripcion, 'mov. cuenta corriente');
        IF v_cc.referencia_tipo = 'comprobante_compra' THEN
          v_comp_id := v_cc.referencia_id;
        END IF;
      END IF;
    ELSIF v_item->>'vencimiento_id' IS NOT NULL THEN
      SELECT referencia_tipo, referencia_id, concepto INTO v_venc
      FROM vencimientos WHERE id = (v_item->>'vencimiento_id')::uuid;
      IF FOUND THEN
        v_etiqueta := COALESCE(v_venc.concepto, 'vencimiento');
        IF v_venc.referencia_tipo = 'cuenta_corriente' THEN
          SELECT referencia_tipo, referencia_id, descripcion INTO v_cc
          FROM cuenta_corriente_proveedores WHERE id = v_venc.referencia_id;
          IF FOUND AND v_cc.referencia_tipo = 'comprobante_compra' THEN
            v_comp_id := v_cc.referencia_id;
          END IF;
        END IF;
      END IF;
    END IF;

    v_comp := NULL;
    IF v_comp_id IS NOT NULL THEN
      SELECT tipo_comprobante, numero_comprobante, total_neto,
             COALESCE(NULLIF(abs(total_factura_declarado), 0), NULLIF(abs(total_calculado), 0)) AS total
      INTO v_comp
      FROM comprobantes_compra WHERE id = v_comp_id;
    END IF;

    IF v_comp_id IS NOT NULL AND v_comp.tipo_comprobante IN ('FA','FB','FC','ND','NDA','NDB','NDC')
       AND COALESCE(v_comp.total, 0) > 0 AND COALESCE(v_comp.total_neto, 0) > 0 THEN
      -- Factura fiscal: base positiva, neto prorrateado
      v_base := round(v_comp.total_neto * LEAST(abs(v_monto) / v_comp.total, 1), 2);
      v_tipo := 'factura';
      v_etiqueta := COALESCE(v_comp.numero_comprobante, v_etiqueta);
    ELSIF v_comp_id IS NOT NULL AND v_comp.tipo_comprobante IN ('NC','NCA','NCB','NCC')
       AND COALESCE(v_comp.total, 0) > 0 AND COALESCE(v_comp.total_neto, 0) <> 0 THEN
      -- NC fiscal descontada: base NEGATIVA (retención neta de NC)
      v_base := -round(abs(v_comp.total_neto) * LEAST(abs(v_monto) / v_comp.total, 1), 2);
      v_tipo := 'nota_credito';
      v_etiqueta := COALESCE(v_comp.numero_comprobante, v_etiqueta);
    ELSE
      -- Adquisición, Reversa, Remito, provisión de OC, pago a cuenta:
      -- SIN comprobante fiscal → JAMÁS integra la base de retención.
      v_base := 0;
      v_tipo := 'sin_retencion';
      IF v_comp_id IS NOT NULL THEN
        v_etiqueta := COALESCE(v_comp.numero_comprobante, v_etiqueta) || ' (' || COALESCE(v_comp.tipo_comprobante, '—') || ')';
      END IF;
    END IF;

    v_total := v_total + v_base;
    v_detalle := v_detalle || jsonb_build_object(
      'etiqueta', v_etiqueta, 'monto_imputado', v_monto, 'base', v_base, 'tipo', v_tipo
    );
  END LOOP;

  RETURN jsonb_build_object('total_base', GREATEST(0, round(v_total, 2)), 'detalle', v_detalle);
END;
$$;

REVOKE ALL ON FUNCTION public.op_ganancias_bases(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.op_ganancias_bases(jsonb) TO authenticated, service_role;

-- ═══ 5. op_confirmar v4 — créditos (NC/Reversa) descontados en la OP ═══
-- Cambios sobre la v3 (R3): las imputaciones NEGATIVAS consumen el saldo del
-- crédito (comprobantes_compra.saldo_pendiente hacia 0) y las positivas con
-- comprobante bajan el saldo de la factura. op_anular v3 los restaura.
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

  IF EXISTS (SELECT 1 FROM ordenes_pago_detalle d WHERE d.orden_pago_id = p_op_id AND d.medio = 'transferencia')
     AND p_cuenta_banco_id IS NULL THEN
    RAISE EXCEPTION 'op_confirmar: la OP incluye transferencias — indicá desde qué cuenta bancaria salen (p_cuenta_banco_id)';
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
    IF v_imp.vencimiento_id IS NOT NULL THEN
      UPDATE vencimientos SET estado = 'pagado', orden_pago_id = p_op_id, updated_at = now()
      WHERE id = v_imp.vencimiento_id AND estado = 'pendiente';
    END IF;
  END LOOP;
  IF array_length(v_cc_ids, 1) > 0 THEN
    UPDATE vencimientos SET estado = 'pagado', orden_pago_id = p_op_id, updated_at = now()
    WHERE referencia_id = ANY(v_cc_ids) AND referencia_tipo = 'cuenta_corriente' AND estado = 'pendiente';
  END IF;

  -- ── 4. Medios de pago → kardex (guard) + cheques ──
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

  UPDATE ordenes_pago SET estado = 'pagada', updated_at = now() WHERE id = p_op_id;

  RETURN jsonb_build_object(
    'success', true, 'ya_confirmada', false,
    'cc_pago_id', v_pago_mov, 'kardex_lineas', v_kardex,
    'certificado_id', v_cert_id, 'numero_certificado', v_num_cert
  );
END;
$$;

REVOKE ALL ON FUNCTION public.op_confirmar(uuid, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.op_confirmar(uuid, uuid, uuid, uuid) TO authenticated, service_role;

-- ═══ 6. op_anular v3 — restaura saldos de créditos y facturas ═══
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

  UPDATE vencimientos SET estado = 'pendiente', orden_pago_id = NULL, updated_at = now()
  WHERE orden_pago_id = p_op_id AND estado = 'pagado';

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

REVOKE ALL ON FUNCTION public.op_anular(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.op_anular(uuid, uuid, text) TO authenticated, service_role;
