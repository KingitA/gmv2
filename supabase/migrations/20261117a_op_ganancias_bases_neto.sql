-- ═════════════════════════════════════════════════════════════════════════════
-- Retención de Ganancias sobre un vencimiento cargado a mano: la base es el NETO
-- Decisión de Juan (17/11/2026): cuando al pagar un vencimiento sin comprobante se
-- contesta que SÍ corresponde retener, la base de Ganancias es el importe pagado
-- dividido 1,21 (neto sin IVA), redondeado a 2 decimales. Antes (20261116p) era
-- el importe completo.
--   Ejemplo: se pagan $300.000 → base $247.933,88. Con mínimo no sujeto de
--   $224.000 y alícuota 2 %: retiene $478,68 (antes $1.520,00).
--
-- op_ganancias_bases v6 = cuerpo EXACTO de la versión de 20261116p_op_crear.sql
-- con dos cambios marcados "v6":
--   · la base de esas imputaciones: round(importe / 1.21, 2);
--   · el detalle devuelve además vencimiento_id y base_divisor (1.21 en esos
--     renglones), para que la pantalla muestre la cuenta "Base = importe ÷ 1,21".
-- No cambia nada más: facturas, notas de crédito, canal negro, respuesta "No" y
-- el motor (ganancias_calcular: régimen, acumulado, mínimo, retención mínima)
-- quedan igual. La usan el preview de la Nueva OP, op_crear (base que se guarda
-- en la orden y con la que op_confirmar emite el certificado), el PDF de la OP y
-- el PDF del certificado: todos toman la base de acá.
--
-- Las órdenes ya creadas no se recalculan (conservan la base con la que se armaron).
-- Sin esta migración todo sigue funcionando como hasta hoy (base = importe completo).
-- Generado por script desde 20261116p. Seguro de re-ejecutar. No toca datos.
-- ═════════════════════════════════════════════════════════════════════════════

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

-- Control (no cambia nada): debe dar base 247933.88
-- select public.op_ganancias_bases(jsonb_build_array(jsonb_build_object(
--   'vencimiento_id', (select id from vencimientos where canal = 'blanco' limit 1),
--   'monto_imputado', 300000, 'retiene_ganancias', true)))->>'total_base';
