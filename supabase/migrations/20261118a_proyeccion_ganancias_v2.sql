-- ─────────────────────────────────────────────────────────────────────────────
-- Proyección de retenciones de Ganancias por vencimiento — v2 (18/11/2026)
--
-- La usan el panel de Finanzas y "Pagos de la semana" para mostrar el NETO que va a salir.
-- Solo LEE: no cambia ningún dato. Se puede correr las veces que haga falta.
--
-- Qué fallaba (v1, 20260804_r4): la proyección agrupa los vencimientos pendientes por
-- proveedor y MES de vencimiento, y le pide la retención a ganancias_calcular con fecha =
-- fin de ESE mes. Con un vencimiento ATRASADO de un mes para el que el régimen del proveedor
-- no tiene valores vigentes (por ejemplo, el régimen empezó a regir después), o con un
-- proveedor con un régimen sin cargar, ganancias_calcular corta ("sin régimen vigente…") y
-- se caía la proyección ENTERA: las pantallas mostraban todo sin retención.
--
-- Qué cambia:
--  1. Nunca corta: si la cuenta de UN vencimiento o de UN proveedor falla, ese da 0
--     (y lo dice en "error") y los demás siguen.
--  2. Lo atrasado se proyecta en el mes de HOY: se va a pagar ahora, y la retención se
--     calcula con lo ya pagado este mes y con la regla vigente hoy.
--  3. Los vencimientos ESTIMADOS de órdenes de compra quedan afuera (no son deuda).
--  4. Vencimiento cargado a mano (sin comprobante) al que todavía nadie le contestó
--     "¿corresponde retener?": se proyecta como si la respuesta fuera SÍ, con base = importe
--     ÷ 1,21, y sale marcado "estimada". Canal negro: nunca retiene. Proveedor exento: 0.
--
-- Devuelve lo mismo que antes y además, por vencimiento: base_tipo, estimada, error.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ganancias_proyeccion_vencimientos()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hoy       date := public.hoy_ar();
  v_venc      record;
  v_bases     jsonb;
  v_base      numeric;
  v_tipo      text;
  v_error     text;
  v_items     jsonb[] := ARRAY[]::jsonb[];
  v_grupo     record;
  v_calc      jsonb;
  v_ret_total numeric;
  v_err_grupo text;
  v_asignado  numeric;
  v_item      jsonb;
  v_ret_i     numeric;
  v_out       jsonb[] := ARRAY[]::jsonb[];
  v_idx       int;
BEGIN
  -- 1. Base de cada vencimiento pendiente con proveedor (sin los estimados de órdenes de compra)
  FOR v_venc IN
    SELECT v.id, v.proveedor_id, v.monto,
           -- lo atrasado se paga ahora: cuenta en el mes de hoy
           date_trunc('month', GREATEST(v.fecha_vencimiento, v_hoy))::date AS mes
    FROM vencimientos v
    WHERE v.estado = 'pendiente'
      AND v.proveedor_id IS NOT NULL
      AND v.monto > 0
      AND NOT (COALESCE(v.es_estimado, false) AND v.referencia_tipo = 'orden_compra')
  LOOP
    v_base := 0; v_tipo := NULL; v_error := NULL;
    BEGIN
      -- retiene_ganancias = true solo pesa en un vencimiento SIN comprobante (y nunca en canal
      -- negro): con comprobante, la base sale del comprobante como siempre.
      v_bases := op_ganancias_bases(jsonb_build_array(jsonb_build_object(
        'vencimiento_id', v_venc.id, 'monto_imputado', v_venc.monto, 'retiene_ganancias', true)));
      v_base := GREATEST(0, COALESCE((v_bases->>'total_base')::numeric, 0));
      v_tipo := v_bases->'detalle'->0->>'tipo';
    EXCEPTION WHEN OTHERS THEN
      v_base := 0; v_tipo := 'error'; v_error := left(SQLERRM, 200);
    END;

    v_items := v_items || jsonb_build_object(
      'vencimiento_id', v_venc.id,
      'proveedor_id', v_venc.proveedor_id,
      'mes', v_venc.mes,
      'monto', v_venc.monto,
      'base', v_base,
      'base_tipo', v_tipo,
      'error', v_error
    );
  END LOOP;

  -- 2. Por (proveedor, mes): retención proyectada del grupo, prorrateada por base
  FOR v_grupo IN
    SELECT (i->>'proveedor_id')::uuid AS proveedor_id,
           (i->>'mes')::date AS mes,
           sum((i->>'base')::numeric) AS base_total,
           count(*) AS cantidad
    FROM unnest(v_items) i
    GROUP BY 1, 2
  LOOP
    v_ret_total := 0; v_err_grupo := NULL;
    IF v_grupo.base_total > 0 THEN
      BEGIN
        -- El mes de hoy se calcula con la regla de HOY; un mes futuro, con la de su último día
        v_calc := ganancias_calcular(
          v_grupo.proveedor_id, v_grupo.base_total,
          CASE WHEN v_grupo.mes <= v_hoy THEN v_hoy
               ELSE (v_grupo.mes + interval '1 month' - interval '1 day')::date END);
        v_ret_total := GREATEST(0, COALESCE((v_calc->>'retencion')::numeric, 0));
      EXCEPTION WHEN OTHERS THEN
        v_ret_total := 0; v_err_grupo := left(SQLERRM, 200);
      END;
    END IF;

    v_asignado := 0;
    v_idx := 0;
    FOR v_item IN
      SELECT i FROM unnest(v_items) i
      WHERE (i->>'proveedor_id')::uuid = v_grupo.proveedor_id AND (i->>'mes')::date = v_grupo.mes
      ORDER BY (i->>'base')::numeric, i->>'vencimiento_id'      -- el de mayor base absorbe el redondeo
    LOOP
      v_idx := v_idx + 1;
      IF v_ret_total <= 0 OR v_grupo.base_total <= 0 THEN
        v_ret_i := 0;
      ELSIF v_idx = v_grupo.cantidad THEN
        v_ret_i := round(v_ret_total - v_asignado, 2);
      ELSE
        v_ret_i := round(v_ret_total * (v_item->>'base')::numeric / v_grupo.base_total, 2);
      END IF;
      -- nunca más que el propio vencimiento ni negativa
      v_ret_i := LEAST(GREATEST(v_ret_i, 0), (v_item->>'monto')::numeric);
      v_asignado := v_asignado + v_ret_i;

      v_out := v_out || jsonb_build_object(
        'vencimiento_id', v_item->>'vencimiento_id',
        'proveedor_id', v_grupo.proveedor_id,
        'mes', v_grupo.mes,
        'monto', (v_item->>'monto')::numeric,
        'base', (v_item->>'base')::numeric,
        'base_tipo', v_item->>'base_tipo',
        'estimada', COALESCE(v_item->>'base_tipo', '') IN ('estimada', 'vencimiento_con_retencion'),
        'retencion_proyectada', v_ret_i,
        'neto_proyectado', round((v_item->>'monto')::numeric - v_ret_i, 2),
        'error', COALESCE(v_item->>'error', v_err_grupo)
      );
    END LOOP;
  END LOOP;

  RETURN to_jsonb(v_out);
END;
$$;

REVOKE ALL ON FUNCTION public.ganancias_proyeccion_vencimientos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ganancias_proyeccion_vencimientos() TO authenticated, service_role;

-- Comprobación (solo lectura), después de aplicar:
--   select count(*) as vencimientos,
--          count(*) filter (where (e->>'retencion_proyectada')::numeric > 0) as con_retencion,
--          count(*) filter (where e->>'error' is not null) as con_error,
--          sum((e->>'retencion_proyectada')::numeric) as retencion_total
--     from jsonb_array_elements(public.ganancias_proyeccion_vencimientos()) e;
--   -- y, si con_error > 0, cuáles y por qué:
--   select e->>'vencimiento_id', e->>'error'
--     from jsonb_array_elements(public.ganancias_proyeccion_vencimientos()) e where e->>'error' is not null;
