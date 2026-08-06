-- ─────────────────────────────────────────────────────────────────────────────
-- 1) op_ganancias_bases v4 — el detalle devuelve además tipo_comprobante,
--    numero y fecha_comprobante (para que los PDFs muestren tipo y número).
-- 2) op_eliminar — elimina una OP "como si nunca hubiera existido":
--    · pagada: primero op_anular (kardex con contraasientos, cheques a
--      cartera, saldos de comprobantes restaurados, vencimientos pendientes)
--    · borra los movimientos de CC de la OP (la cuenta queda como estaba)
--    · elimina el certificado de retención (no sale en TXT SICORE) y libera
--      su número si era el último de la serie
--    · libera el número de OP si era el último
--    · borra imputaciones, detalle y la OP
--    El kardex conserva línea + contraasiento (append-only): efecto neto $0.
-- ─────────────────────────────────────────────────────────────────────────────

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

    v_comp := NULL;
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
      'tipo_comprobante', CASE WHEN v_comp_id IS NOT NULL THEN v_comp.tipo_comprobante END,
      'numero', CASE WHEN v_comp_id IS NOT NULL THEN v_comp.numero_comprobante END,
      'fecha_comprobante', CASE WHEN v_comp_id IS NOT NULL THEN to_char(v_comp.fecha_comprobante, 'YYYY-MM-DD') END
    );
  END LOOP;

  RETURN jsonb_build_object('total_base', GREATEST(0, round(v_total, 2)), 'detalle', v_detalle);
END;
$function$;


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
