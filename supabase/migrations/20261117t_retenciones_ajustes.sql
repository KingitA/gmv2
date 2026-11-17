-- ═════════════════════════════════════════════════════════════════════════════
-- Retenciones de Ganancias: tres ajustes
-- Prueba integral de ENTRADA, Tanda 1-D (17/11/2026): E-57, E-58, E-61.
--
-- E-57  El acumulado del mes y lo ya retenido en el mes se contaban con fechas
--       distintas (fecha de la orden vs. día de la confirmación). Ahora las dos cosas,
--       y la fecha del certificado, usan la FECHA DE LA ORDEN DE PAGO.
--       · ganancias_calcular v3 = cuerpo EXACTO de la v2 (20261116p) con esa consulta cambiada.
--       · op_confirmar v9 = cuerpo EXACTO de la v8 (20261117r) con UNA línea cambiada.
-- E-58  Una factura fiscal sin neto cargado (comprobantes sin orden de compra) daba base 0
--       y no retenía. Ahora la base se estima (imputado ÷ 1,21) y la pantalla lo avisa.
--       · op_ganancias_bases v7 = cuerpo EXACTO de la v6 (20261117a) + una rama marcada "v7".
-- E-61  Eliminar una orden borraba su certificado y liberaba el número aunque el período
--       ya se hubiera presentado. Ahora se anota cada exportación del TXT de SICORE
--       (retenciones_exportaciones) y op_eliminar se niega si el certificado es de un
--       período exportado: hay que anular.
--       · op_eliminar v2 = cuerpo EXACTO de 20260807 + el control marcado "v2".
--
-- REQUIERE 20261117r (y por lo tanto 20261117q). Generado por script. Seguro de
-- re-ejecutar. No toca datos. No cambia alícuotas, mínimos ni exclusiones.
-- ═════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF to_regprocedure('public.op_sincronizar_saldos_comprobantes(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Falta aplicar ANTES la migración 20261117r_cc_proveedor_saldo_unico.sql. No se cambió nada.';
  END IF;
END $$;

-- ═══ E-61: registro de exportaciones a SICORE ═══
CREATE TABLE IF NOT EXISTS public.retenciones_exportaciones (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  formato     varchar(10) NOT NULL,          -- 'txt' (SICORE) | 'planilla'
  desde       date NOT NULL,
  hasta       date NOT NULL,
  certificados integer NOT NULL DEFAULT 0,
  total       numeric(20,2) NOT NULL DEFAULT 0,
  usuario_id  uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ret_exportaciones_hasta ON public.retenciones_exportaciones (formato, hasta);
ALTER TABLE public.retenciones_exportaciones ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.retenciones_exportaciones IS
  'Cada vez que se baja el TXT de SICORE (o la planilla) de retenciones emitidas. Un certificado con fecha <= al último "hasta" exportado en TXT no se puede eliminar: se anula.';

-- ═══ E-58: op_ganancias_bases v7 ═══
CREATE OR REPLACE FUNCTION public.op_ganancias_bases(p_imputaciones jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

    -- v5: antes era "v_comp := NULL;", que deja el registro SIN forma: si la
    -- imputación no tiene comprobante (vencimiento cargado a mano, provisión,
    -- saldo inicial) las condiciones de abajo cortaban con
    -- 'record "v_comp" is not assigned yet'. Mismo efecto (todo en NULL), con forma.
    SELECT NULL::text AS tipo_comprobante, NULL::text AS numero_comprobante, NULL::numeric AS total_neto,
           NULL::date AS fecha_comprobante, NULL::numeric AS total
    INTO v_comp;
    IF v_comp_id IS NOT NULL THEN
      SELECT tipo_comprobante, numero_comprobante, total_neto, fecha_comprobante,
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
    ELSIF v_comp_id IS NOT NULL AND v_comp.tipo_comprobante IN ('FA','FB','FC','ND','NDA','NDB','NDC')
       AND COALESCE(v_comp.total, 0) > 0 THEN
      -- v7 (E-58): factura fiscal SIN neto cargado (pasa con comprobantes sin orden de compra).
      -- Antes la base quedaba en 0 y no se retenía nada. Ahora se estima: lo imputado ÷ 1,21.
      -- La pantalla avisa que la base es estimada.
      v_base := round(LEAST(abs(v_monto), v_comp.total) / 1.21, 2);
      v_tipo := 'estimada';
      v_etiqueta := COALESCE(v_comp.numero_comprobante, v_etiqueta);
    ELSIF v_comp_id IS NOT NULL AND v_comp.tipo_comprobante IN ('NC','NCA','NCB','NCC')
       AND COALESCE(v_comp.total, 0) > 0 AND COALESCE(v_comp.total_neto, 0) <> 0 THEN
      -- NC fiscal descontada: base NEGATIVA (retención neta de NC)
      v_base := -round(abs(v_comp.total_neto) * LEAST(abs(v_monto) / v_comp.total, 1), 2);
      v_tipo := 'nota_credito';
      v_etiqueta := COALESCE(v_comp.numero_comprobante, v_etiqueta);
    ELSIF v_comp_id IS NULL AND v_monto > 0
       AND NULLIF(v_item->>'vencimiento_id', '') IS NOT NULL
       AND COALESCE(NULLIF(v_item->>'retiene_ganancias', '')::boolean, false)
       AND NOT EXISTS (SELECT 1 FROM vencimientos vn
                       WHERE vn.id = (v_item->>'vencimiento_id')::uuid AND vn.canal = 'negro') THEN
      -- v5b (Juan, 16/11/2026): vencimiento cargado a mano en el que se contestó
      -- que SÍ corresponde retener. Canal negro: nunca.
      -- v6 (Juan, 17/11/2026): la base es el NETO sin IVA = importe pagado ÷ 1,21
      -- (antes era el importe completo).
      v_base := round(v_monto / 1.21, 2);
      v_tipo := 'vencimiento_con_retencion';
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
      'etiqueta', v_etiqueta, 'monto_imputado', v_monto, 'base', v_base, 'tipo', v_tipo,
      'vencimiento_id', NULLIF(v_item->>'vencimiento_id', ''),                                  -- v6
      'base_divisor', CASE WHEN v_tipo = 'vencimiento_con_retencion' THEN 1.21 END,             -- v6
      'tipo_comprobante', CASE WHEN v_comp_id IS NOT NULL THEN v_comp.tipo_comprobante END,
      'numero', CASE WHEN v_comp_id IS NOT NULL THEN v_comp.numero_comprobante END,
      'fecha_comprobante', CASE WHEN v_comp_id IS NOT NULL THEN to_char(v_comp.fecha_comprobante, 'YYYY-MM-DD') END
    );
  END LOOP;

  RETURN jsonb_build_object('total_base', GREATEST(0, round(v_total, 2)), 'detalle', v_detalle);
END;
$function$;

-- ═══ E-57: ganancias_calcular v3 ═══
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
  v_exento      boolean := false;   -- v2
  v_exento_venc boolean := false;   -- v2
BEGIN
  SELECT nombre, cuit, regimen_ganancias, condicion_ganancias, ganancias_exento_hasta INTO v_prov   -- v2: + ganancias_exento_hasta
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

  -- v3 (E-57): lo ya retenido en el mes se cuenta por la FECHA DE LA ORDEN DE PAGO, la
  -- misma con la que se cuenta el acumulado de bases de arriba. Antes se contaba por la
  -- fecha del certificado (el día que se confirmó): una orden fechada a fin de mes y
  -- confirmada al mes siguiente sumaba su base en un mes y su retención en otro.
  SELECT COALESCE(sum(re.monto), 0) INTO v_ret_previa
  FROM retenciones_emitidas re
  LEFT JOIN ordenes_pago o ON o.id = re.orden_pago_id
  WHERE re.proveedor_id = p_proveedor_id
    AND re.estado = 'emitida'
    AND date_trunc('month', COALESCE(o.fecha, re.fecha)) = date_trunc('month', v_fecha)
    AND (p_excluir_op IS NULL OR re.orden_pago_id <> p_excluir_op);

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

  -- ── v2: proveedor EXENTO de Ganancias (ficha: condición 'exento') ──
  -- Mientras la exención esté vigente (sin fecha o fecha >= día del pago) no se
  -- retiene nada, con motivo claro. Vencida, se calcula como inscripto y se avisa
  -- (exento_vencido). Un certificado de exclusión del 100 % vale lo mismo para el
  -- cartel de la pantalla (exento = true). El resto del cálculo no cambia.
  v_exento := v_prov.condicion_ganancias = 'exento'
              AND (v_prov.ganancias_exento_hasta IS NULL OR v_prov.ganancias_exento_hasta >= v_fecha);
  v_exento_venc := v_prov.condicion_ganancias = 'exento' AND NOT v_exento;
  IF v_exento THEN
    v_ret := 0;
    v_motivo := 'proveedor exento de Ganancias' ||
                COALESCE(' (certificado vigente hasta el ' || to_char(v_prov.ganancias_exento_hasta, 'DD/MM/YYYY') || ')', '');
  END IF;
  -- ── fin v2 ──

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
    'motivo_sin_retencion', v_motivo,
    'exento', (v_exento OR v_exclusion >= 100),                 -- v2
    'exento_hasta', v_prov.ganancias_exento_hasta,             -- v2
    'exento_vencido', v_exento_venc                            -- v2
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ganancias_calcular(uuid, numeric, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ganancias_calcular(uuid, numeric, date, uuid) TO authenticated, service_role;

-- ═══ E-57: op_confirmar v9 ═══
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
      v_op.fecha,   -- v9 (E-57): el certificado lleva la fecha de la orden de pago (antes: el día de la confirmación)
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

-- ═══ E-61: op_eliminar v2 ═══
CREATE OR REPLACE FUNCTION public.op_eliminar(p_op_id uuid, p_usuario_id uuid, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_op        ordenes_pago%ROWTYPE;
  v_cert      record;
  v_seq       int;
  v_op_lib    boolean := false;
  v_cert_lib  boolean := false;
  v_revs      int := 0;
  v_res       jsonb;
BEGIN
  SELECT * INTO v_op FROM ordenes_pago WHERE id = p_op_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'op_eliminar: orden de pago % no encontrada', p_op_id;
  END IF;

  -- v2 (E-61): si el certificado de retención de esta orden cae en un período que ya se
  -- exportó a SICORE, no se puede borrar ni reutilizar su número: hay que ANULAR.
  IF EXISTS (
    SELECT 1 FROM retenciones_emitidas re
     WHERE re.orden_pago_id = p_op_id
       AND re.fecha <= (SELECT max(x.hasta) FROM retenciones_exportaciones x WHERE x.formato = 'txt')
  ) THEN
    RAISE EXCEPTION 'La orden % tiene un certificado de retención de un período que ya se exportó a SICORE. No se puede eliminar (se perdería el certificado y se reutilizaría su número): usá Anular.', v_op.numero_op;
  END IF;

  -- 1. Si está pagada: revertir todo primero (kardex, cheques, saldos, vencs)
  IF v_op.estado = 'pagada' THEN
    v_res := op_anular(p_op_id, p_usuario_id, COALESCE(p_motivo, 'eliminación total'));
    v_revs := COALESCE((v_res->>'kardex_reversas')::int, 0);
  END IF;

  -- 2. CC del proveedor: borrar los movimientos de la OP y los contraasientos
  --    de la anulación (queda exactamente como estaba)
  DELETE FROM imputaciones_proveedores ip
  USING cuenta_corriente_proveedores cc
  WHERE (ip.id_movimiento_pago = cc.id OR ip.id_movimiento_documento = cc.id)
    AND cc.referencia_id = p_op_id
    AND cc.referencia_tipo IN ('orden_pago', 'orden_pago_anulacion');
  DELETE FROM cuenta_corriente_proveedores
  WHERE referencia_id = p_op_id
    AND referencia_tipo IN ('orden_pago', 'orden_pago_anulacion');

  -- 3. Certificados de retención: liberar número (si era el último) y eliminar
  FOR v_cert IN SELECT * FROM retenciones_emitidas WHERE orden_pago_id = p_op_id
  LOOP
    v_seq := NULLIF(split_part(v_cert.numero_certificado, '-', 2), '')::int;
    IF v_seq IS NOT NULL THEN
      UPDATE numeracion_comprobantes
      SET ultimo_numero = ultimo_numero - 1, updated_at = now()
      WHERE tipo_comprobante = 'RETGAN'
        AND punto_venta = split_part(v_cert.numero_certificado, '-', 1)
        AND ultimo_numero = v_seq;
      IF FOUND THEN v_cert_lib := true; END IF;
    END IF;
    DELETE FROM retenciones_emitidas WHERE id = v_cert.id;
  END LOOP;

  -- 4. Número de OP: liberar si era el último de la serie
  v_seq := NULLIF(split_part(v_op.numero_op, '-', 2), '')::int;
  IF v_seq IS NOT NULL THEN
    UPDATE numeracion_comprobantes
    SET ultimo_numero = ultimo_numero - 1, updated_at = now()
    WHERE tipo_comprobante = 'OP'
      AND punto_venta = split_part(v_op.numero_op, '-', 1)
      AND ultimo_numero = v_seq;
    IF FOUND THEN v_op_lib := true; END IF;
  END IF;

  -- 5. Desvincular referencias y borrar la OP entera
  UPDATE cheques SET orden_pago_id = NULL WHERE orden_pago_id = p_op_id;
  UPDATE vencimientos SET orden_pago_id = NULL, updated_at = now() WHERE orden_pago_id = p_op_id;
  DELETE FROM ordenes_pago_imputaciones WHERE orden_pago_id = p_op_id;
  DELETE FROM ordenes_pago_detalle WHERE orden_pago_id = p_op_id;
  DELETE FROM ordenes_pago WHERE id = p_op_id;

  RETURN jsonb_build_object(
    'success', true,
    'kardex_reversas', v_revs,
    'numero_op_liberado', v_op_lib,
    'certificado_liberado', v_cert_lib
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.op_eliminar(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.op_eliminar(uuid, uuid, text) TO service_role;
