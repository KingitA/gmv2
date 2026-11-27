-- ════════════════════════════════════════════════════════════════════════════════════════
-- Bancos — Tanda 5: control diario (27/11/2026)
-- Plan: docs/bancos/PLAN-BANCOS.md · Lógica: lib/bancos/control/
-- ════════════════════════════════════════════════════════════════════════════════════════
-- 1. bancos_cargos_ajustes (una fila): modo propuesta para los cargos del banco (impuestos,
--    comisiones, débitos automáticos, servicios, ARCA, rendimientos). Por defecto ENCENDIDO: el
--    sistema solo lista lo que registraría y una persona aprieta "Registrar todo". `desde`: no se
--    registra nada anterior a ese día (lo viejo pudo haberse cargado a mano como gasto).
-- 2. bancos_cargos_registrados: qué renglón del banco se registró como gasto / ingreso por esta
--    tanda (UNIQUE por movimiento: nunca dos veces).
-- 3. bancos_registrar_cargo(): vuelve a controlar todo adentro (renglón PENDIENTE, sin vínculo de
--    las tandas 3/4, no reservado como comisión de un cheque) y registra por el MISMO camino de
--    siempre: extracto_registrar_egreso (caja_egreso: egreso + kardex + saldo) o
--    extracto_registrar_ingreso (kardex INGRESO_BANCARIO). El renglón queda REGISTRADO_EGRESO /
--    REGISTRADO_INGRESO.
--
-- No toca cuentas corrientes. Idempotente: se puede correr más de una vez.
-- ════════════════════════════════════════════════════════════════════════════════════════

-- ─── 1. Ajustes ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bancos_cargos_ajustes (
  id                   boolean PRIMARY KEY DEFAULT true CHECK (id),
  modo_propuesta       boolean NOT NULL DEFAULT true,
  -- Primer día que se registra (lo anterior queda para mirar a mano). Vacío = últimos 60 días.
  desde                date,
  -- En nombre de quién registra el sistema: el admin que apagó el modo propuesta
  confirma_usuario_id  uuid,
  cambiado_por         uuid,
  cambiado_at          timestamptz
);
INSERT INTO public.bancos_cargos_ajustes (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
COMMENT ON TABLE public.bancos_cargos_ajustes IS
  'Cargos del banco al libro de fondos (bancos tanda 5). modo_propuesta = solo lista; en false registra solo, en nombre de confirma_usuario_id. Se cambia desde Finanzas → Control de bancos (solo admin).';

ALTER TABLE public.bancos_cargos_ajustes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.bancos_cargos_ajustes FROM anon;
GRANT SELECT ON TABLE public.bancos_cargos_ajustes TO authenticated;
GRANT ALL ON TABLE public.bancos_cargos_ajustes TO service_role;
DO $$
BEGIN
  CREATE POLICY "bancos_cargos_ajustes_leer" ON public.bancos_cargos_ajustes FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── 2. Registro ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bancos_cargos_registrados (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movimiento_id  uuid NOT NULL UNIQUE REFERENCES public.banco_extractos_movimientos(id) ON DELETE CASCADE,
  tipo           varchar(7) NOT NULL CHECK (tipo IN ('egreso', 'ingreso')),
  categoria      text,
  concepto_id    text,
  kardex_id      uuid,
  automatico     boolean NOT NULL DEFAULT false,
  creado_por     uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.bancos_cargos_registrados IS
  'Renglones del banco (impuestos, comisiones, débitos automáticos, rendimientos) registrados en el libro de fondos por la tanda 5. Único por movimiento.';

ALTER TABLE public.bancos_cargos_registrados ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.bancos_cargos_registrados FROM anon;
GRANT SELECT ON TABLE public.bancos_cargos_registrados TO authenticated;
GRANT ALL ON TABLE public.bancos_cargos_registrados TO service_role;
DO $$
BEGIN
  CREATE POLICY "bancos_cargos_registrados_leer" ON public.bancos_cargos_registrados FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── 3. Registrar un cargo ──────────────────────────────────────────────────────────────
-- Devuelve {success:false, motivo} si el renglón ya no se puede registrar (lo tomó otra tanda,
-- ya está registrado, etc.). Si caja_egreso falla (p. ej. saldo insuficiente en el sistema),
-- la excepción sube y no queda nada a medias.
CREATE OR REPLACE FUNCTION public.bancos_registrar_cargo(
  p_mov_id      uuid,
  p_categoria   text,          -- OPERATIVO | IMPUESTOS | CREDITO | OTROS (solo débitos)
  p_concepto    text,
  p_concepto_id text DEFAULT NULL,
  p_usuario_id  uuid DEFAULT NULL,
  p_automatico  boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mov   banco_extractos_movimientos%ROWTYPE;
  v_res   jsonb;
  v_tipo  text;
  v_otro  boolean;
BEGIN
  SELECT * INTO v_mov FROM banco_extractos_movimientos WHERE id = p_mov_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'motivo', 'Movimiento no encontrado');
  END IF;
  IF v_mov.estado_matching <> 'PENDIENTE' OR v_mov.kardex_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'motivo', 'El movimiento ya está ' || v_mov.estado_matching);
  END IF;
  IF EXISTS (SELECT 1 FROM bancos_cargos_registrados WHERE movimiento_id = p_mov_id) THEN
    RETURN jsonb_build_object('success', false, 'motivo', 'Ya estaba registrado');
  END IF;

  -- Tomado por las tandas 3 / 4 (las tablas pueden no existir si esas migraciones no se aplicaron)
  IF to_regclass('public.banco_transferencias_vinculos') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.banco_transferencias_vinculos WHERE movimiento_id = $1)' INTO v_otro USING p_mov_id;
    IF v_otro THEN RETURN jsonb_build_object('success', false, 'motivo', 'Vinculado a una transferencia'); END IF;
  END IF;
  IF to_regclass('public.cheques_banco_vinculos') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.cheques_banco_vinculos WHERE movimiento_id = $1)' INTO v_otro USING p_mov_id;
    IF v_otro THEN RETURN jsonb_build_object('success', false, 'motivo', 'Vinculado a un cheque'); END IF;
  END IF;
  IF to_regclass('public.cheques_banco_avisos') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.cheques_banco_avisos WHERE estado = ''pendiente'' AND (movimiento_id = $1 OR comision_movimiento_id = $1))' INTO v_otro USING p_mov_id;
    IF v_otro THEN RETURN jsonb_build_object('success', false, 'motivo', 'Reservado por una propuesta de cheques'); END IF;
  END IF;

  IF v_mov.monto < 0 THEN
    IF coalesce(p_categoria, '') NOT IN ('OPERATIVO', 'IMPUESTOS', 'CREDITO', 'OTROS') THEN
      RETURN jsonb_build_object('success', false, 'motivo', 'Categoría inválida');
    END IF;
    v_tipo := 'egreso';
    v_res := extracto_registrar_egreso(p_mov_id, p_categoria, p_usuario_id, p_concepto);
  ELSIF v_mov.monto > 0 THEN
    v_tipo := 'ingreso';
    v_res := extracto_registrar_ingreso(p_mov_id, p_usuario_id, p_concepto);
  ELSE
    RETURN jsonb_build_object('success', false, 'motivo', 'Importe en cero');
  END IF;

  INSERT INTO bancos_cargos_registrados (movimiento_id, tipo, categoria, concepto_id, kardex_id, automatico, creado_por)
  VALUES (p_mov_id, v_tipo, CASE WHEN v_tipo = 'egreso' THEN p_categoria END, p_concepto_id,
          (v_res->>'kardex_id')::uuid, coalesce(p_automatico, false), p_usuario_id);

  RETURN jsonb_build_object('success', true, 'tipo', v_tipo, 'kardex_id', v_res->>'kardex_id');
END;
$$;
REVOKE ALL ON FUNCTION public.bancos_registrar_cargo(uuid, text, text, text, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bancos_registrar_cargo(uuid, text, text, text, uuid, boolean) TO service_role;

-- Probar (sin registrar nada):
--   SELECT * FROM public.bancos_cargos_ajustes;                 -- modo_propuesta = true
--   SELECT m.concepto_id, count(*), sum(m.monto) FROM banco_extractos_movimientos m
--    JOIN bancos_conceptos c ON c.id = m.concepto_id
--   WHERE m.estado_matching = 'PENDIENTE' AND c.tipo IN ('impuesto', 'gasto', 'pago') GROUP BY 1;
