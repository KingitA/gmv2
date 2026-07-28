-- ─────────────────────────────────────────────────────────────────────────────
-- FASE J1 — Gastos y servicios recurrentes (REQUIERE G1/G2)
--
-- 1. es_estimado: cuotas de monto variable (VEP 931) nacen estimadas y se
--    corrigen al conocer el monto real. Suman igual en la proyección.
-- 2. vencimientos_mantener(): mantenimiento "rolling" de series recurrentes
--    (la serie siempre tiene N meses de horizonte; no muere tras 12 cuotas)
--    + creación automática del recordatorio de RENOVACIÓN al fin de ciclo
--    (seguros trimestrales, anuales). Idempotente: se puede llamar siempre.
-- 3. extracto_saldar_vencimiento(): un débito del extracto salda una cuota en
--    una sola operación: egreso categorizado (kardex + saldo) + vencimiento
--    pagado (con el monto real del débito) + movimiento conciliado, linkeados.
--    extracto_matchear ahora también sugiere vencimientos pendientes para los
--    débitos sin contraparte en el kardex.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.vencimientos
  ADD COLUMN IF NOT EXISTS es_estimado boolean NOT NULL DEFAULT false;

ALTER TABLE public.banco_extractos_movimientos
  ADD COLUMN IF NOT EXISTS vencimiento_id uuid REFERENCES vencimientos(id);

-- ═════════════════════════════════════════════════════════════════════════
-- vencimientos_mantener — rolling de series + renovaciones de ciclo
-- ═════════════════════════════════════════════════════════════════════════
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
      v_siguiente := (v_ultima + (v_paso || ' months')::interval)::date;
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

-- ═════════════════════════════════════════════════════════════════════════
-- extracto_saldar_vencimiento — débito del banco salda la cuota, atómico:
-- egreso categorizado (kardex + saldo) + vencimiento pagado con el monto
-- real + movimiento conciliado, todo linkeado.
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.extracto_saldar_vencimiento(
  p_mov_id         uuid,
  p_vencimiento_id uuid,
  p_categoria      text,
  p_usuario_id     uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mov  banco_extractos_movimientos%ROWTYPE;
  v_venc vencimientos%ROWTYPE;
  v_res  jsonb;
BEGIN
  SELECT * INTO v_mov FROM banco_extractos_movimientos WHERE id = p_mov_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'extracto_saldar_vencimiento: movimiento % no encontrado', p_mov_id;
  END IF;
  IF v_mov.estado_matching NOT IN ('PENDIENTE', 'SUGERIDO') THEN
    RAISE EXCEPTION 'extracto_saldar_vencimiento: el movimiento ya está %', v_mov.estado_matching;
  END IF;
  IF v_mov.monto >= 0 THEN
    RAISE EXCEPTION 'extracto_saldar_vencimiento: solo aplica a débitos';
  END IF;

  SELECT * INTO v_venc FROM vencimientos WHERE id = p_vencimiento_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'extracto_saldar_vencimiento: vencimiento % no encontrado', p_vencimiento_id;
  END IF;
  IF v_venc.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'extracto_saldar_vencimiento: la cuota está % — solo se saldan pendientes', v_venc.estado;
  END IF;

  -- Egreso real (kardex + saldo)
  v_res := caja_egreso(
    'BANCO', v_mov.cuenta_bancaria_id, p_categoria, abs(v_mov.monto), 'BLANCO',
    v_venc.concepto || ' — ' || COALESCE(v_mov.descripcion, 'débito bancario'),
    p_usuario_id
  );

  -- Cuota pagada, con el monto REAL del débito (corrige estimados)
  UPDATE vencimientos
  SET estado = 'pagado', monto = abs(v_mov.monto), es_estimado = false, updated_at = now()
  WHERE id = p_vencimiento_id;

  -- Movimiento conciliado y linkeado
  UPDATE banco_extractos_movimientos
  SET estado_matching = 'REGISTRADO_EGRESO',
      kardex_id = (v_res->>'kardex_id')::uuid,
      vencimiento_id = p_vencimiento_id,
      matcheado_por = p_usuario_id, matcheado_at = now()
  WHERE id = p_mov_id;

  RETURN jsonb_build_object(
    'success', true,
    'kardex_id', v_res->>'kardex_id',
    'egreso_id', v_res->>'egreso_id',
    'vencimiento_id', p_vencimiento_id,
    'monto_real', abs(v_mov.monto)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.extracto_saldar_vencimiento(uuid, uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.extracto_saldar_vencimiento(uuid, uuid, text, uuid) TO authenticated, service_role;

-- ═════════════════════════════════════════════════════════════════════════
-- extracto_matchear v2 — además del kardex, los débitos sin contraparte
-- buscan vencimientos pendientes (monto exacto, fecha ±5 días) y quedan
-- SUGERIDO con vencimiento_id (la UI ofrece "Saldar cuota").
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.extracto_matchear(
  p_extracto_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mov        record;
  v_kardex_id  uuid;
  v_pago_id    uuid;
  v_venc_id    uuid;
  v_sugeridos  int := 0;
  v_cuotas     int := 0;
  v_categoriz  int := 0;
BEGIN
  FOR v_mov IN
    SELECT * FROM banco_extractos_movimientos
    WHERE extracto_id = p_extracto_id AND estado_matching = 'PENDIENTE'
    ORDER BY fecha
  LOOP
    v_kardex_id := NULL; v_pago_id := NULL; v_venc_id := NULL;

    IF v_mov.monto > 0 THEN
      SELECT k.id, k.pago_id INTO v_kardex_id, v_pago_id
      FROM kardex_contable k
      WHERE k.destino_tipo = 'BANCO'
        AND k.destino_id = v_mov.cuenta_bancaria_id
        AND (k.monto = v_mov.monto OR k.monto - COALESCE(k.gastos, 0) = v_mov.monto)
        AND k.fecha::date BETWEEN v_mov.fecha - 3 AND v_mov.fecha + 3
        AND k.kardex_reversa_de IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM banco_extractos_movimientos b
          WHERE b.kardex_id = k.id AND b.estado_matching IN ('SUGERIDO', 'CONCILIADO')
        )
      ORDER BY abs(k.fecha::date - v_mov.fecha), k.created_at
      LIMIT 1;
    ELSE
      SELECT k.id, k.pago_id INTO v_kardex_id, v_pago_id
      FROM kardex_contable k
      WHERE k.origen_tipo = 'BANCO'
        AND k.origen_id = v_mov.cuenta_bancaria_id
        AND k.monto = abs(v_mov.monto)
        AND k.fecha::date BETWEEN v_mov.fecha - 3 AND v_mov.fecha + 3
        AND k.kardex_reversa_de IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM banco_extractos_movimientos b
          WHERE b.kardex_id = k.id AND b.estado_matching IN ('SUGERIDO', 'CONCILIADO')
        )
      ORDER BY abs(k.fecha::date - v_mov.fecha), k.created_at
      LIMIT 1;

      -- Sin kardex: ¿coincide con una cuota pendiente del calendario?
      IF v_kardex_id IS NULL THEN
        SELECT v.id INTO v_venc_id
        FROM vencimientos v
        WHERE v.estado = 'pendiente'
          AND abs(v.monto - abs(v_mov.monto)) < 0.01
          AND v.fecha_vencimiento BETWEEN v_mov.fecha - 5 AND v_mov.fecha + 5
          AND NOT EXISTS (
            SELECT 1 FROM banco_extractos_movimientos b
            WHERE b.vencimiento_id = v.id AND b.estado_matching IN ('SUGERIDO', 'CONCILIADO', 'REGISTRADO_EGRESO')
          )
        ORDER BY abs(v.fecha_vencimiento - v_mov.fecha)
        LIMIT 1;
      END IF;
    END IF;

    IF v_kardex_id IS NOT NULL THEN
      UPDATE banco_extractos_movimientos
      SET estado_matching = 'SUGERIDO', kardex_id = v_kardex_id, pago_id = v_pago_id
      WHERE id = v_mov.id;
      v_sugeridos := v_sugeridos + 1;
    ELSIF v_venc_id IS NOT NULL THEN
      UPDATE banco_extractos_movimientos
      SET estado_matching = 'SUGERIDO', vencimiento_id = v_venc_id
      WHERE id = v_mov.id;
      v_cuotas := v_cuotas + 1;
    ELSIF v_mov.monto < 0 AND v_mov.categoria_sugerida IS NULL THEN
      UPDATE banco_extractos_movimientos
      SET categoria_sugerida = CASE
        WHEN v_mov.descripcion ~* 'sircreb|iibb|ing\.?\s*brutos|impuesto|iva|percep|afip|arca|ley\s*25' THEN 'IMPUESTOS'
        WHEN v_mov.descripcion ~* 'comis|manten|servicio|cargo|sellado' THEN 'OPERATIVO'
        ELSE 'OTROS' END
      WHERE id = v_mov.id;
      v_categoriz := v_categoriz + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'sugeridos', v_sugeridos, 'cuotas_sugeridas', v_cuotas, 'categorizados', v_categoriz);
END;
$$;

REVOKE ALL ON FUNCTION public.extracto_matchear(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.extracto_matchear(uuid) TO authenticated, service_role;
