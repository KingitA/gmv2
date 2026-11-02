-- ═══════════════════════════════════════════════════════════════════════
-- GASTOS QUE SE REPITEN: LA CUOTA DEL 29, 30 O 31 NO SE CORRE DE FECHA (02/11/2026)
--
-- Qué pasaba: una serie que se repite (todos los meses, cada 3 meses…) con
-- día 29, 30 o 31 se corría de fecha al pasar por un mes más corto:
--   * Al darla de alta (Finanzas → Nuevo pago o gasto → "Todos los meses"),
--     el 30/01 + 1 mes caía el 02/03 y febrero quedaba sin cuota (lo vio Juan
--     con el crédito Credicoop). Eso se arregló en el código (no en la base).
--   * Al extender la serie sola (esta función, todos los días desde el panel
--     de Finanzas), el 31/01 + 1 mes caía el 28/02 y de ahí en más la serie
--     seguía el 28 todos los meses.
--
-- Qué hace: reemplaza vencimientos_mantener (misma función, mismos datos) para
-- que cada cuota nueva caiga el mismo día de la serie, o el último día del mes
-- cuando el mes es más corto: 30/01 → 28/02 → 30/03 → 30/04…
-- No cambia cuotas ya cargadas (hoy ninguna serie activa es del 29, 30 o 31).
--
-- IDEMPOTENTE.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.vencimientos_mantener(
  p_horizonte_meses int DEFAULT 6
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_serie      record;
  v_ultima     date;
  v_siguiente  date;
  v_monto      numeric;
  v_promedio   numeric;
  v_hoy        date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_limite     date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date + (p_horizonte_meses || ' months')::interval;
  v_paso       int;
  v_generados  int := 0;
  v_renov      int := 0;
  v_guard      int;
  v_dia        int;   -- día del mes de la serie (30, 31…): no se pierde al pasar por febrero
  v_mes        date;  -- primer día del mes de la próxima cuota
BEGIN
  -- ── 1. Extender series activas hasta el horizonte ──
  FOR v_serie IN
    SELECT DISTINCT ON (COALESCE(proveedor_id, '00000000-0000-0000-0000-000000000000'::uuid), concepto, recurrencia)
           *
    FROM vencimientos
    WHERE recurrencia IS NOT NULL
      AND recurrencia IN ('mensual', 'bimestral', 'trimestral', 'semestral', 'anual')
      AND estado <> 'cancelado'
    ORDER BY COALESCE(proveedor_id, '00000000-0000-0000-0000-000000000000'::uuid), concepto, recurrencia,
             fecha_vencimiento DESC
  LOOP
    v_paso := CASE v_serie.recurrencia
      WHEN 'mensual' THEN 1 WHEN 'bimestral' THEN 2 WHEN 'trimestral' THEN 3
      WHEN 'semestral' THEN 6 ELSE 12 END;
    v_ultima := v_serie.fecha_vencimiento;

    -- Día de la serie: el de la última cuota. Si esa cayó a fin de mes (un 28/02
    -- de una serie del 30), el mayor día de las últimas cuotas pendientes.
    v_dia := extract(day FROM v_ultima)::int;
    IF v_ultima = (date_trunc('month', v_ultima) + interval '1 month - 1 day')::date THEN
      SELECT greatest(v_dia, COALESCE(max(extract(day FROM fecha_vencimiento))::int, v_dia)) INTO v_dia
        FROM (
          SELECT fecha_vencimiento FROM vencimientos
           WHERE concepto = v_serie.concepto
             AND COALESCE(proveedor_id, '00000000-0000-0000-0000-000000000000'::uuid)
                 = COALESCE(v_serie.proveedor_id, '00000000-0000-0000-0000-000000000000'::uuid)
             AND recurrencia = v_serie.recurrencia
             AND estado = 'pendiente'
           ORDER BY fecha_vencimiento DESC LIMIT 3
        ) ult;
    END IF;

    -- Monto de las cuotas nuevas: si la serie es estimada, promedio de los
    -- últimos 3 pagos reales (no estimados) del mismo concepto; si no hay,
    -- arrastra el de la última cuota.
    v_monto := v_serie.monto;
    IF v_serie.es_estimado THEN
      SELECT round(avg(monto), 2) INTO v_promedio FROM (
        SELECT monto FROM vencimientos
        WHERE concepto = v_serie.concepto
          AND COALESCE(proveedor_id, '00000000-0000-0000-0000-000000000000'::uuid)
              = COALESCE(v_serie.proveedor_id, '00000000-0000-0000-0000-000000000000'::uuid)
          AND estado = 'pagado' AND es_estimado = false AND monto > 0
        ORDER BY fecha_vencimiento DESC LIMIT 3
      ) ult;
      v_monto := COALESCE(v_promedio, v_serie.monto);
    END IF;

    v_guard := 0;
    LOOP
      -- Mismo día de la serie, o el último del mes si ese mes es más corto
      -- (30/01 → 28/02 → 30/03; antes 30/01 + 1 mes daba bien pero la serie
      -- quedaba en 28 para siempre).
      v_mes := (date_trunc('month', v_ultima) + (v_paso || ' months')::interval)::date;
      v_siguiente := v_mes + (least(v_dia, extract(day FROM (v_mes + interval '1 month - 1 day'))::int) - 1);
      EXIT WHEN v_siguiente > v_limite;
      EXIT WHEN v_serie.recurrencia_hasta IS NOT NULL AND v_siguiente > v_serie.recurrencia_hasta;
      v_guard := v_guard + 1;
      EXIT WHEN v_guard > 24;  -- backstop

      IF NOT EXISTS (
        SELECT 1 FROM vencimientos
        WHERE concepto = v_serie.concepto
          AND COALESCE(proveedor_id, '00000000-0000-0000-0000-000000000000'::uuid)
              = COALESCE(v_serie.proveedor_id, '00000000-0000-0000-0000-000000000000'::uuid)
          AND fecha_vencimiento = v_siguiente
          AND estado <> 'cancelado'
      ) THEN
        INSERT INTO vencimientos (
          proveedor_id, tipo, concepto, monto, moneda, fecha_vencimiento,
          recurrencia, recurrencia_hasta, observaciones, dias_alerta,
          forma_pago, modalidad, descuentos_aplicados, es_estimado, estado
        ) VALUES (
          v_serie.proveedor_id, v_serie.tipo, v_serie.concepto, v_monto,
          v_serie.moneda, v_siguiente, v_serie.recurrencia, v_serie.recurrencia_hasta,
          v_serie.observaciones, v_serie.dias_alerta, v_serie.forma_pago,
          v_serie.modalidad, COALESCE(v_serie.descuentos_aplicados, false),
          v_serie.es_estimado, 'pendiente'
        );
        v_generados := v_generados + 1;
      END IF;
      v_ultima := v_siguiente;
    END LOOP;

    -- ── 2. Renovación de ciclo (recurrencia_hasta próxima) ──
    IF v_serie.recurrencia_hasta IS NOT NULL
       AND v_serie.recurrencia_hasta <= v_limite
       AND NOT EXISTS (
         SELECT 1 FROM vencimientos
         WHERE concepto = 'Renovación: ' || v_serie.concepto
           AND fecha_vencimiento = v_serie.recurrencia_hasta
           AND estado <> 'cancelado'
       )
    THEN
      INSERT INTO vencimientos (
        proveedor_id, tipo, concepto, monto, moneda, fecha_vencimiento,
        observaciones, dias_alerta, forma_pago, modalidad, es_estimado, estado
      )
      SELECT v_serie.proveedor_id, v_serie.tipo,
             'Renovación: ' || v_serie.concepto,
             -- estimado del ciclo completo = suma de las cuotas del ciclo actual
             COALESCE((SELECT sum(monto) FROM vencimientos
                       WHERE concepto = v_serie.concepto
                         AND recurrencia = v_serie.recurrencia
                         AND recurrencia_hasta = v_serie.recurrencia_hasta
                         AND estado <> 'cancelado'), v_serie.monto),
             v_serie.moneda, v_serie.recurrencia_hasta,
             'Fin de ciclo — cargar las cuotas del período nuevo al renovar',
             7, v_serie.forma_pago, v_serie.modalidad, true, 'pendiente';
      v_renov := v_renov + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'generados', v_generados, 'renovaciones', v_renov);
END;
$$;

REVOKE ALL ON FUNCTION public.vencimientos_mantener(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vencimientos_mantener(int) TO authenticated, service_role;
