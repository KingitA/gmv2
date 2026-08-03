-- ─────────────────────────────────────────────────────────────────────────────
-- FASE R4 — Proyección de retenciones al ingresar la factura (REQUIERE R1-R3)
--
-- Objetivo del usuario: "cuando entra una factura ya saber al centavo qué
-- vamos a pagar". La proyección agrupa los vencimientos PENDIENTES de cada
-- proveedor por MES de vencimiento (supuesto: se pagan en su mes), suma el
-- acumulado real ya pagado/retenido de ese mes (ganancias_calcular) y
-- prorratea la retención proyectada entre los vencimientos por su base.
-- Es determinista salvo que se posterguen pagos de mes — la cifra exacta
-- la fija la OP al confirmar (R2/R3). Se recalcula en cada consulta.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ganancias_proyeccion_vencimientos()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venc      record;
  v_base      numeric;
  v_items     jsonb := '[]'::jsonb;
  v_grupo     record;
  v_calc      jsonb;
  v_ret_total numeric;
  v_asignado  numeric;
  v_item      jsonb;
  v_ret_i     numeric;
  v_out       jsonb := '[]'::jsonb;
  v_idx       int;
  v_count     int;
BEGIN
  -- 1. Base RG 830 de cada vencimiento pendiente con proveedor
  FOR v_venc IN
    SELECT v.id, v.proveedor_id, v.monto, v.fecha_vencimiento,
           date_trunc('month', v.fecha_vencimiento)::date AS mes
    FROM vencimientos v
    WHERE v.estado = 'pendiente'
      AND v.proveedor_id IS NOT NULL
      AND v.monto > 0
  LOOP
    v_base := COALESCE((
      op_ganancias_bases(jsonb_build_array(
        jsonb_build_object('vencimiento_id', v_venc.id, 'monto_imputado', v_venc.monto)
      ))->>'total_base'
    )::numeric, 0);

    v_items := v_items || jsonb_build_object(
      'vencimiento_id', v_venc.id,
      'proveedor_id', v_venc.proveedor_id,
      'mes', v_venc.mes,
      'monto', v_venc.monto,
      'base', v_base
    );
  END LOOP;

  -- 2. Por (proveedor, mes): retención proyectada del grupo, prorrateada
  FOR v_grupo IN
    SELECT (i->>'proveedor_id')::uuid AS proveedor_id,
           (i->>'mes')::date AS mes,
           sum((i->>'base')::numeric) AS base_total
    FROM jsonb_array_elements(v_items) i
    GROUP BY 1, 2
  LOOP
    v_calc := ganancias_calcular(
      v_grupo.proveedor_id,
      v_grupo.base_total,
      (v_grupo.mes + interval '1 month' - interval '1 day')::date
    );
    v_ret_total := COALESCE((v_calc->>'retencion')::numeric, 0);
    v_asignado := 0;

    SELECT count(*) INTO v_count
    FROM jsonb_array_elements(v_items) i
    WHERE (i->>'proveedor_id')::uuid = v_grupo.proveedor_id AND (i->>'mes')::date = v_grupo.mes;

    v_idx := 0;
    FOR v_item IN
      SELECT i FROM jsonb_array_elements(v_items) i
      WHERE (i->>'proveedor_id')::uuid = v_grupo.proveedor_id AND (i->>'mes')::date = v_grupo.mes
    LOOP
      v_idx := v_idx + 1;
      IF v_ret_total <= 0 OR v_grupo.base_total <= 0 THEN
        v_ret_i := 0;
      ELSIF v_idx = v_count THEN
        v_ret_i := round(v_ret_total - v_asignado, 2);  -- el último absorbe el redondeo
      ELSE
        v_ret_i := round(v_ret_total * (v_item->>'base')::numeric / v_grupo.base_total, 2);
      END IF;
      v_asignado := v_asignado + v_ret_i;

      v_out := v_out || jsonb_build_object(
        'vencimiento_id', v_item->>'vencimiento_id',
        'proveedor_id', v_grupo.proveedor_id,
        'mes', v_grupo.mes,
        'monto', (v_item->>'monto')::numeric,
        'base', (v_item->>'base')::numeric,
        'retencion_proyectada', v_ret_i,
        'neto_proyectado', round((v_item->>'monto')::numeric - v_ret_i, 2)
      );
    END LOOP;
  END LOOP;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.ganancias_proyeccion_vencimientos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ganancias_proyeccion_vencimientos() TO authenticated, service_role;
