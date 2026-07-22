-- ─────────────────────────────────────────────────────────────────────────────
-- FASE G1 — Extractos bancarios + conciliación por matching (REQUIERE B y C)
--
-- Modelo: cada extracto importado (CSV/Excel del homebanking hoy; API de
-- MercadoPago/banco mañana — misma tabla, cambia `fuente`) trae movimientos
-- que se matchean contra el kardex_contable:
--   · crédito con contraparte en kardex  → SUGERIDO → conciliar
--     (si la línea kardex tiene pago → pago_verificar 'conciliacion'/'extracto')
--   · débito sin contraparte (comisión, SIRCREB, débito automático)
--     → REGISTRADO_EGRESO vía caja_egreso (kardex + saldo en un paso)
--   · IGNORADO para ruido (contra-asientos del banco, etc.)
-- Idempotencia: UNIQUE (cuenta, referencia_externa) — el importador SIEMPRE
-- manda referencia_externa (la real del banco o un hash determinístico).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.banco_extractos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_bancaria_id  uuid NOT NULL REFERENCES cuentas_bancarias(id),
  fuente              varchar(20) NOT NULL DEFAULT 'excel'
                      CHECK (fuente IN ('csv', 'excel', 'api_mp', 'api_banco')),
  periodo_desde       date,
  periodo_hasta       date,
  saldo_inicial       numeric(14,2),
  saldo_final         numeric(14,2),
  importado_por       uuid,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.banco_extractos_movimientos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  extracto_id         uuid NOT NULL REFERENCES banco_extractos(id) ON DELETE CASCADE,
  cuenta_bancaria_id  uuid NOT NULL REFERENCES cuentas_bancarias(id),
  fecha               date NOT NULL,
  descripcion         text,
  referencia_externa  text NOT NULL,
  monto               numeric(14,2) NOT NULL,      -- signo = sentido (crédito +, débito −)
  categoria_sugerida  varchar(20),                 -- para débitos sin contraparte
  estado_matching     varchar(20) NOT NULL DEFAULT 'PENDIENTE'
                      CHECK (estado_matching IN ('PENDIENTE', 'SUGERIDO', 'CONCILIADO', 'REGISTRADO_EGRESO', 'IGNORADO')),
  kardex_id           uuid REFERENCES kardex_contable(id),
  pago_id             uuid REFERENCES pagos_clientes(id),
  matcheado_por       uuid,
  matcheado_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cuenta_bancaria_id, referencia_externa)
);

CREATE INDEX IF NOT EXISTS idx_bem_estado ON public.banco_extractos_movimientos (estado_matching, cuenta_bancaria_id);
CREATE INDEX IF NOT EXISTS idx_bem_extracto ON public.banco_extractos_movimientos (extracto_id);

ALTER TABLE public.banco_extractos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.banco_extractos_movimientos ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  CREATE POLICY "banco_extractos_auth_all" ON public.banco_extractos
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  CREATE POLICY "bem_auth_all" ON public.banco_extractos_movimientos
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ═════════════════════════════════════════════════════════════════════════
-- extracto_matchear — corre el matching automático sobre los PENDIENTE.
--   Crédito: kardex con destino = la cuenta, monto exacto (bruto o neto de
--   gastos), fecha ±3 días, no tomado por otro movimiento del extracto.
--   Débito: ídem con origen = la cuenta. Sin match → sugiere categoría de
--   egreso por la descripción (IMPUESTOS / OPERATIVO / OTROS).
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
  v_sugeridos  int := 0;
  v_categoriz  int := 0;
BEGIN
  FOR v_mov IN
    SELECT * FROM banco_extractos_movimientos
    WHERE extracto_id = p_extracto_id AND estado_matching = 'PENDIENTE'
    ORDER BY fecha
  LOOP
    v_kardex_id := NULL; v_pago_id := NULL;

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
    END IF;

    IF v_kardex_id IS NOT NULL THEN
      UPDATE banco_extractos_movimientos
      SET estado_matching = 'SUGERIDO', kardex_id = v_kardex_id, pago_id = v_pago_id
      WHERE id = v_mov.id;
      v_sugeridos := v_sugeridos + 1;
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

  RETURN jsonb_build_object('success', true, 'sugeridos', v_sugeridos, 'categorizados', v_categoriz);
END;
$$;

REVOKE ALL ON FUNCTION public.extracto_matchear(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.extracto_matchear(uuid) TO authenticated, service_role;

-- ═════════════════════════════════════════════════════════════════════════
-- extracto_conciliar — confirma un match: marca CONCILIADO y, si la línea
-- kardex viene de un pago, aplica la segunda firma (pago_verificar,
-- metodo 'conciliacion', fuente 'extracto'). Si no hay pago, verifica la
-- línea kardex directamente.
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.extracto_conciliar(
  p_mov_id     uuid,
  p_usuario_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mov banco_extractos_movimientos%ROWTYPE;
BEGIN
  SELECT * INTO v_mov FROM banco_extractos_movimientos WHERE id = p_mov_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'extracto_conciliar: movimiento % no encontrado', p_mov_id;
  END IF;
  IF v_mov.estado_matching = 'CONCILIADO' THEN
    RETURN jsonb_build_object('success', true, 'ya_conciliado', true);
  END IF;
  IF v_mov.kardex_id IS NULL THEN
    RAISE EXCEPTION 'extracto_conciliar: el movimiento no tiene match en el kardex (usar registrar egreso o buscar manualmente)';
  END IF;

  IF v_mov.pago_id IS NOT NULL THEN
    PERFORM pago_verificar(v_mov.pago_id, p_usuario_id, 'conciliacion', 'extracto');
  ELSE
    UPDATE kardex_contable
    SET verificado = true, verificado_por = p_usuario_id, verificado_at = now()
    WHERE id = v_mov.kardex_id AND verificado = false;
  END IF;

  UPDATE banco_extractos_movimientos
  SET estado_matching = 'CONCILIADO', matcheado_por = p_usuario_id, matcheado_at = now()
  WHERE id = p_mov_id;

  RETURN jsonb_build_object('success', true, 'ya_conciliado', false, 'pago_id', v_mov.pago_id);
END;
$$;

REVOKE ALL ON FUNCTION public.extracto_conciliar(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.extracto_conciliar(uuid, uuid) TO authenticated, service_role;

-- ═════════════════════════════════════════════════════════════════════════
-- extracto_registrar_egreso — débito del extracto sin contraparte →
-- egreso real vía caja_egreso (egresos_generales + kardex + saldo, atómico)
-- y el movimiento queda REGISTRADO_EGRESO apuntando a esa línea kardex.
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.extracto_registrar_egreso(
  p_mov_id     uuid,
  p_categoria  text,               -- OPERATIVO | SUELDOS | INVERSION | CREDITO | IMPUESTOS | OTROS
  p_usuario_id uuid,
  p_concepto   text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mov banco_extractos_movimientos%ROWTYPE;
  v_res jsonb;
BEGIN
  SELECT * INTO v_mov FROM banco_extractos_movimientos WHERE id = p_mov_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'extracto_registrar_egreso: movimiento % no encontrado', p_mov_id;
  END IF;
  IF v_mov.estado_matching NOT IN ('PENDIENTE', 'SUGERIDO') THEN
    RAISE EXCEPTION 'extracto_registrar_egreso: el movimiento ya está %', v_mov.estado_matching;
  END IF;
  IF v_mov.monto >= 0 THEN
    RAISE EXCEPTION 'extracto_registrar_egreso: solo aplica a débitos (monto negativo)';
  END IF;

  v_res := caja_egreso(
    'BANCO', v_mov.cuenta_bancaria_id, p_categoria, abs(v_mov.monto), 'BLANCO',
    COALESCE(NULLIF(trim(p_concepto), ''), 'Extracto: ' || COALESCE(v_mov.descripcion, 'débito bancario')),
    p_usuario_id
  );

  UPDATE banco_extractos_movimientos
  SET estado_matching = 'REGISTRADO_EGRESO',
      kardex_id = (v_res->>'kardex_id')::uuid,
      matcheado_por = p_usuario_id, matcheado_at = now()
  WHERE id = p_mov_id;

  RETURN jsonb_build_object('success', true, 'egreso_id', v_res->>'egreso_id', 'kardex_id', v_res->>'kardex_id');
END;
$$;

REVOKE ALL ON FUNCTION public.extracto_registrar_egreso(uuid, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.extracto_registrar_egreso(uuid, text, uuid, text) TO authenticated, service_role;

-- ═════════════════════════════════════════════════════════════════════════
-- extracto_ignorar — descartar ruido del extracto (contra-asientos, etc.)
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.extracto_ignorar(
  p_mov_id     uuid,
  p_usuario_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE banco_extractos_movimientos
  SET estado_matching = 'IGNORADO', matcheado_por = p_usuario_id, matcheado_at = now()
  WHERE id = p_mov_id AND estado_matching IN ('PENDIENTE', 'SUGERIDO');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'extracto_ignorar: movimiento no encontrado o ya procesado';
  END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.extracto_ignorar(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.extracto_ignorar(uuid, uuid) TO authenticated, service_role;
