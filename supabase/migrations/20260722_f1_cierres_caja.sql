-- ─────────────────────────────────────────────────────────────────────────────
-- FASE F1 — Cierre de caja / arqueo diario (REQUIERE Fases B y C aplicadas)
--
-- El cierre es la foto firmada del arqueo físico de una caja:
--   · saldo teórico = snapshot de saldos_financieros al confirmar
--   · saldo contado = conteo físico (con desglose de billetes opcional)
--   · diferencia ≠ 0 → se asienta vía caja_ajustar (AJUSTE_CAJA en kardex,
--     auditado por quién y cuándo) referenciando este cierre
--   · las cobranzas del día sin segunda firma se verifican en lote con
--     pago_verificar(metodo='arqueo') — regla de doble firma intacta:
--     los pagos creados por el mismo usuario que cierra quedan reportados
--     como omitidos, nunca auto-verificados.
-- El cierre NO mueve saldos por sí mismo: todo pasa por RPCs existentes.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Fix de datos: cajas_financieras quedó vacía pero el kardex y
-- saldos_financieros referencian estos dos IDs (verificado 22-07-2026:
-- APERTURA_SALDO "Caja Grande" → 1a84b28b…, "Caja Chica" → c43c9ac6…).
-- Se restauran las filas del catálogo con sus IDs originales (idempotente).
INSERT INTO public.cajas_financieras (id, nombre, activo) VALUES
  ('1a84b28b-1b22-4bd8-972c-69974fb92542', 'Caja Grande', true),
  ('c43c9ac6-9265-41f8-a6d7-d5378f26607f', 'Caja Chica',  true)
ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, activo = true;

CREATE TABLE IF NOT EXISTS public.cierres_caja (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha              date NOT NULL,
  cuenta_tipo        fund_account_type NOT NULL,
  cuenta_id          uuid NOT NULL,
  color              money_color NOT NULL,
  saldo_teorico      numeric(14,2),                -- snapshot al confirmar
  saldo_contado      numeric(14,2),
  desglose_billetes  jsonb,                        -- ej. {"20000": 12, "10000": 5}
  diferencia         numeric(14,2),                -- contado - teórico
  ajuste_kardex_id   uuid REFERENCES kardex_contable(id),
  pagos_verificados  int NOT NULL DEFAULT 0,
  pagos_omitidos     jsonb,                        -- [{pago_id, motivo}] p/ auditoría
  estado             varchar(12) NOT NULL DEFAULT 'ABIERTO'
                     CHECK (estado IN ('ABIERTO', 'CONFIRMADO', 'CANCELADO')),
  notas              text,
  abierto_por        uuid,
  confirmado_por     uuid,
  confirmado_at      timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Un solo cierre vigente por caja/color/día (los cancelados no bloquean)
CREATE UNIQUE INDEX IF NOT EXISTS uq_cierres_caja_vigente
  ON public.cierres_caja (fecha, cuenta_tipo, cuenta_id, color)
  WHERE estado <> 'CANCELADO';

CREATE INDEX IF NOT EXISTS idx_cierres_caja_fecha ON public.cierres_caja (fecha DESC, estado);

ALTER TABLE public.cierres_caja ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  CREATE POLICY "cierres_caja_auth_all" ON public.cierres_caja
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ═════════════════════════════════════════════════════════════════════════
-- cierre_caja_abrir — abre (o devuelve) el cierre del día para una caja.
-- Idempotente: si ya hay uno ABIERTO para esa caja/color/fecha lo devuelve;
-- si ya está CONFIRMADO, error explícito.
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.cierre_caja_abrir(
  p_fecha       date,
  p_cuenta_tipo text,               -- CAJA | BANCO (arqueo físico: normalmente CAJA)
  p_cuenta_id   uuid,
  p_color       text,               -- BLANCO | NEGRO
  p_usuario_id  uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cierre cierres_caja%ROWTYPE;
  v_saldo  numeric;
BEGIN
  IF p_cuenta_tipo NOT IN ('CAJA', 'BANCO') THEN
    RAISE EXCEPTION 'cierre_caja_abrir: cuenta_tipo inválido (%)', p_cuenta_tipo;
  END IF;
  IF p_color NOT IN ('BLANCO', 'NEGRO') THEN
    RAISE EXCEPTION 'cierre_caja_abrir: color inválido (%)', p_color;
  END IF;
  IF p_fecha IS NULL OR p_cuenta_id IS NULL THEN
    RAISE EXCEPTION 'cierre_caja_abrir: fecha y cuenta_id son obligatorios';
  END IF;

  SELECT * INTO v_cierre FROM cierres_caja
  WHERE fecha = p_fecha
    AND cuenta_tipo = p_cuenta_tipo::fund_account_type
    AND cuenta_id = p_cuenta_id
    AND color = p_color::money_color
    AND estado <> 'CANCELADO'
  FOR UPDATE;

  IF FOUND THEN
    IF v_cierre.estado = 'CONFIRMADO' THEN
      RAISE EXCEPTION 'cierre_caja_abrir: la caja ya tiene cierre confirmado para el %', p_fecha;
    END IF;
    RETURN jsonb_build_object('success', true, 'cierre_id', v_cierre.id, 'ya_abierto', true);
  END IF;

  SELECT saldo INTO v_saldo FROM saldos_financieros
  WHERE cuenta_tipo = p_cuenta_tipo::fund_account_type
    AND cuenta_id = p_cuenta_id
    AND color = p_color::money_color;

  INSERT INTO cierres_caja (fecha, cuenta_tipo, cuenta_id, color, saldo_teorico, abierto_por)
  VALUES (p_fecha, p_cuenta_tipo::fund_account_type, p_cuenta_id, p_color::money_color,
          COALESCE(v_saldo, 0), p_usuario_id)
  RETURNING * INTO v_cierre;

  RETURN jsonb_build_object('success', true, 'cierre_id', v_cierre.id, 'ya_abierto', false);
END;
$$;

REVOKE ALL ON FUNCTION public.cierre_caja_abrir(date, text, uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cierre_caja_abrir(date, text, uuid, text, uuid) TO authenticated, service_role;

-- ═════════════════════════════════════════════════════════════════════════
-- cierre_caja_confirmar — confirma el arqueo:
--   1. verifica en lote los pagos indicados (pago_verificar 'arqueo');
--      los que no pueden (misma firma / estado) quedan en pagos_omitidos
--   2. re-snapshotea el saldo teórico
--   3. si contado ≠ teórico → caja_ajustar (kardex AJUSTE_CAJA)
--   4. cierra con firma y hora
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.cierre_caja_confirmar(
  p_cierre_id     uuid,
  p_usuario_id    uuid,
  p_saldo_contado numeric,
  p_desglose      jsonb DEFAULT NULL,
  p_pago_ids      uuid[] DEFAULT '{}',
  p_notas         text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cierre      cierres_caja%ROWTYPE;
  v_saldo       numeric;
  v_diferencia  numeric;
  v_ajuste_id   uuid;
  v_pago_id     uuid;
  v_verificados int := 0;
  v_omitidos    jsonb := '[]'::jsonb;
  v_res         jsonb;
BEGIN
  IF p_saldo_contado IS NULL THEN
    RAISE EXCEPTION 'cierre_caja_confirmar: saldo_contado es obligatorio';
  END IF;

  SELECT * INTO v_cierre FROM cierres_caja WHERE id = p_cierre_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cierre_caja_confirmar: cierre % no encontrado', p_cierre_id;
  END IF;
  IF v_cierre.estado <> 'ABIERTO' THEN
    RAISE EXCEPTION 'cierre_caja_confirmar: el cierre está % — solo se confirman cierres abiertos', v_cierre.estado;
  END IF;

  -- 1. Verificación en lote (regla de doble firma intacta: los propios se omiten)
  FOREACH v_pago_id IN ARRAY COALESCE(p_pago_ids, '{}')
  LOOP
    BEGIN
      v_res := pago_verificar(v_pago_id, p_usuario_id, 'arqueo', 'manual');
      IF COALESCE((v_res->>'ya_verificado')::boolean, false) = false THEN
        v_verificados := v_verificados + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_omitidos := v_omitidos || jsonb_build_object('pago_id', v_pago_id, 'motivo', SQLERRM);
    END;
  END LOOP;

  -- 2. Saldo teórico vigente al momento de confirmar
  SELECT saldo INTO v_saldo FROM saldos_financieros
  WHERE cuenta_tipo = v_cierre.cuenta_tipo
    AND cuenta_id = v_cierre.cuenta_id
    AND color = v_cierre.color
  FOR UPDATE;
  v_saldo := COALESCE(v_saldo, 0);
  v_diferencia := p_saldo_contado - v_saldo;

  -- 3. Diferencia → ajuste auditado en kardex (caja_ajustar fija el saldo al contado)
  IF v_diferencia <> 0 THEN
    v_ajuste_id := caja_ajustar(
      v_cierre.cuenta_tipo::text,
      v_cierre.cuenta_id,
      v_cierre.color::text,
      p_saldo_contado,
      'Cierre de caja ' || to_char(v_cierre.fecha, 'DD-MM-YYYY') ||
        ' — diferencia de arqueo ' || to_char(v_diferencia, 'FM999999999990.00'),
      p_usuario_id
    );
  END IF;

  -- 4. Firma y cierre
  UPDATE cierres_caja
  SET estado            = 'CONFIRMADO',
      saldo_teorico     = v_saldo,
      saldo_contado     = p_saldo_contado,
      desglose_billetes = COALESCE(p_desglose, desglose_billetes),
      diferencia        = v_diferencia,
      ajuste_kardex_id  = v_ajuste_id,
      pagos_verificados = v_verificados,
      pagos_omitidos    = NULLIF(v_omitidos, '[]'::jsonb),
      notas             = COALESCE(NULLIF(trim(p_notas), ''), notas),
      confirmado_por    = p_usuario_id,
      confirmado_at     = now()
  WHERE id = p_cierre_id;

  RETURN jsonb_build_object(
    'success', true,
    'cierre_id', p_cierre_id,
    'saldo_teorico', v_saldo,
    'saldo_contado', p_saldo_contado,
    'diferencia', v_diferencia,
    'ajuste_kardex_id', v_ajuste_id,
    'pagos_verificados', v_verificados,
    'pagos_omitidos', v_omitidos
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cierre_caja_confirmar(uuid, uuid, numeric, jsonb, uuid[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cierre_caja_confirmar(uuid, uuid, numeric, jsonb, uuid[], text) TO authenticated, service_role;
