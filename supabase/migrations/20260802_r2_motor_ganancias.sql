-- ─────────────────────────────────────────────────────────────────────────────
-- FASE R2 — Motor de cálculo de retención de Ganancias RG 830 (REQUIERE R1)
--
-- Reglas implementadas (todas parametrizadas en retencion_regimenes):
--   · La retención se practica EN EL PAGO, POR PROVEEDOR (no por documento).
--   · Base = neto gravado. Facturas: total_neto prorrateado por lo imputado.
--     Adquisiciones/provisiones sin factura: estimada = monto ÷ 1,21.
--   · Acumulado mensual: bases de OPs pagadas del mes + la base actual;
--     retención = alícuota × (acumulado − mínimo) − ya retenido en el mes.
--   · No se practica si el resultado es menor a la retención mínima.
--   · No inscriptos: alícuota agravada y SIN mínimo no sujeto.
--   · Certificado de exclusión vigente (excenciones_impositivas): reduce o
--     anula la retención según porcentaje_excencion.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.ordenes_pago
  ADD COLUMN IF NOT EXISTS base_ganancias numeric(14,2),
  ADD COLUMN IF NOT EXISTS ganancias_ajuste_manual boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ganancias_motivo text;

-- ═══ Resolver de bases: de las imputaciones de una OP a la base RG 830 ═══
-- p_imputaciones: [{ movimiento_cc_id?, vencimiento_id?, comprobante_compra_id?, monto_imputado }]
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
    IF v_monto <= 0 THEN CONTINUE; END IF;

    v_comp_id := NULL;
    v_etiqueta := 'imputación';

    -- Resolver hasta el comprobante de compra si existe en la cadena
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

    IF v_comp_id IS NOT NULL THEN
      SELECT numero_comprobante, total_neto,
             COALESCE(NULLIF(total_factura_declarado, 0), NULLIF(total_calculado, 0)) AS total
      INTO v_comp
      FROM comprobantes_compra WHERE id = v_comp_id;
    END IF;

    IF v_comp_id IS NOT NULL AND FOUND AND COALESCE(v_comp.total, 0) > 0 AND COALESCE(v_comp.total_neto, 0) > 0 THEN
      -- Factura real: neto exacto, prorrateado por la proporción imputada
      v_base := round(v_comp.total_neto * LEAST(v_monto / v_comp.total, 1), 2);
      v_tipo := 'factura';
      v_etiqueta := COALESCE(v_comp.numero_comprobante, v_etiqueta);
    ELSE
      -- Sin factura (provisión de OC, pago a cuenta): neto estimado = monto/1,21
      v_base := round(v_monto / 1.21, 2);
      v_tipo := 'estimada';
    END IF;

    v_total := v_total + v_base;
    v_detalle := v_detalle || jsonb_build_object(
      'etiqueta', v_etiqueta, 'monto_imputado', v_monto, 'base', v_base, 'tipo', v_tipo
    );
  END LOOP;

  RETURN jsonb_build_object('total_base', round(v_total, 2), 'detalle', v_detalle);
END;
$$;

REVOKE ALL ON FUNCTION public.op_ganancias_bases(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.op_ganancias_bases(jsonb) TO authenticated, service_role;

-- ═══ Cálculo RG 830 con acumulado mensual ═══
CREATE OR REPLACE FUNCTION public.ganancias_calcular(
  p_proveedor_id uuid,
  p_base         numeric,
  p_fecha        date DEFAULT NULL,
  p_excluir_op   uuid DEFAULT NULL   -- al recalcular una OP existente, excluirla del acumulado
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fecha       date := COALESCE(p_fecha, (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date);
  v_prov        record;
  v_reg         record;
  v_exclusion   numeric := 0;
  v_acum_previo numeric;
  v_ret_previa  numeric;
  v_alicuota    numeric;
  v_minimo      numeric;
  v_teorica     numeric;
  v_ret         numeric;
  v_motivo      text := NULL;
BEGIN
  SELECT nombre, cuit, regimen_ganancias, condicion_ganancias INTO v_prov
  FROM proveedores WHERE id = p_proveedor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ganancias_calcular: proveedor % no encontrado', p_proveedor_id;
  END IF;

  SELECT * INTO v_reg FROM retencion_regimenes
  WHERE clave = COALESCE(v_prov.regimen_ganancias, 'bienes')
    AND vigencia_desde <= v_fecha
    AND (vigencia_hasta IS NULL OR vigencia_hasta >= v_fecha)
  ORDER BY vigencia_desde DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ganancias_calcular: sin régimen vigente para clave % al %', v_prov.regimen_ganancias, v_fecha;
  END IF;

  -- Certificado de exclusión vigente
  SELECT COALESCE(max(porcentaje_excencion), 0) INTO v_exclusion
  FROM excenciones_impositivas
  WHERE proveedor_id = p_proveedor_id
    AND tipo = 'retencion_ganancias'
    AND activo = true
    AND fecha_desde <= v_fecha
    AND (fecha_hasta IS NULL OR fecha_hasta >= v_fecha);

  -- Acumulado del mes calendario (bases de OPs pagadas) y retenido previo
  SELECT COALESCE(sum(base_ganancias), 0) INTO v_acum_previo
  FROM ordenes_pago
  WHERE proveedor_id = p_proveedor_id
    AND estado = 'pagada'
    AND date_trunc('month', fecha) = date_trunc('month', v_fecha)
    AND (p_excluir_op IS NULL OR id <> p_excluir_op);

  SELECT COALESCE(sum(monto), 0) INTO v_ret_previa
  FROM retenciones_emitidas
  WHERE proveedor_id = p_proveedor_id
    AND estado = 'emitida'
    AND date_trunc('month', fecha) = date_trunc('month', v_fecha)
    AND (p_excluir_op IS NULL OR orden_pago_id <> p_excluir_op);

  IF v_prov.condicion_ganancias = 'no_inscripto' THEN
    v_alicuota := v_reg.alicuota_no_inscripto;
    v_minimo := 0;  -- no inscriptos: sin monto no sujeto
  ELSE
    v_alicuota := v_reg.alicuota_inscripto;
    v_minimo := v_reg.minimo_no_sujeto;
  END IF;

  v_teorica := round((v_alicuota / 100.0) * GREATEST(0, v_acum_previo + COALESCE(p_base, 0) - v_minimo), 2);
  v_ret := GREATEST(0, round(v_teorica - v_ret_previa, 2));

  IF v_ret > 0 AND v_ret < v_reg.retencion_minima THEN
    v_motivo := 'menor a retención mínima (' || v_reg.retencion_minima || ')';
    v_ret := 0;
  ELSIF v_acum_previo + COALESCE(p_base, 0) <= v_minimo THEN
    v_motivo := 'acumulado del mes no supera el mínimo no sujeto';
  END IF;

  IF v_exclusion > 0 AND v_ret > 0 THEN
    v_ret := round(v_ret * (1 - v_exclusion / 100.0), 2);
    v_motivo := 'certificado de exclusión ' || v_exclusion || '%';
  END IF;

  RETURN jsonb_build_object(
    'proveedor', v_prov.nombre,
    'cuit', v_prov.cuit,
    'regimen_id', v_reg.id,
    'regimen', v_reg.clave,
    'regimen_descripcion', v_reg.descripcion,
    'condicion', v_prov.condicion_ganancias,
    'alicuota', v_alicuota,
    'minimo_no_sujeto', v_minimo,
    'retencion_minima', v_reg.retencion_minima,
    'exclusion_pct', v_exclusion,
    'base', round(COALESCE(p_base, 0), 2),
    'acumulado_previo_mes', v_acum_previo,
    'acumulado_total_mes', round(v_acum_previo + COALESCE(p_base, 0), 2),
    'retenido_previo_mes', v_ret_previa,
    'retencion', v_ret,
    'motivo_sin_retencion', v_motivo
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ganancias_calcular(uuid, numeric, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ganancias_calcular(uuid, numeric, date, uuid) TO authenticated, service_role;

-- ═══ Preview completo para la pantalla de Nueva OP ═══
CREATE OR REPLACE FUNCTION public.op_ganancias_preview(
  p_proveedor_id uuid,
  p_imputaciones jsonb,
  p_fecha        date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bases jsonb;
  v_calc  jsonb;
BEGIN
  v_bases := op_ganancias_bases(p_imputaciones);
  v_calc := ganancias_calcular(p_proveedor_id, (v_bases->>'total_base')::numeric, p_fecha);
  RETURN v_calc || jsonb_build_object('bases_detalle', v_bases->'detalle');
END;
$$;

REVOKE ALL ON FUNCTION public.op_ganancias_preview(uuid, jsonb, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.op_ganancias_preview(uuid, jsonb, date) TO authenticated, service_role;
