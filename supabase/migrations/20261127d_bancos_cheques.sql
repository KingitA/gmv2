-- ════════════════════════════════════════════════════════════════════════════════════════
-- Bancos — Tanda 4: cheques trazables contra el banco (27/11/2026)
-- Plan: docs/bancos/PLAN-BANCOS.md
-- ════════════════════════════════════════════════════════════════════════════════════════
-- 1. cheques: columnas que el código ya usa y pueden faltar (fecha_deposito, fecha_rechazo,
--    motivo_rechazo, fecha_debito) + fecha_acreditacion_esperada (depósito + N días hábiles).
--    cuentas_bancarias.cheque_dias_acreditacion: días hábiles de cada banco (vacío = 2, "48 h").
-- 2. dias_habiles_sumar: salta sábados, domingos y feriados/puentes de calendario_dias.
--    Trigger: al pasar a DEPOSITADO se calcula la fecha esperada de acreditación.
-- 3. cheques_banco_ajustes (una fila): modo propuesta (por defecto PRENDIDO: solo propone),
--    días de alerta (4 hábiles = 96 h).
-- 4. cheques_banco_vinculos: qué movimiento del banco se usó para qué cheque (nada se usa dos veces).
--    cheques_banco_avisos: rechazos para confirmar y propuestas (modo propuesta).
-- 5. cheque_banco_aplicar: acredita (caja_acreditar_cheque) o debita un propio
--    (cheque_propio_debitar) con el renglón del banco, revalidando todo y marcando el renglón
--    CONCILIADO, en una sola transacción.
--    cheque_banco_confirmar_rechazo: el dueño confirma → cheque_rechazar (ND al cliente).
--    NUNCA corre sola: solo desde el botón "Confirmar rechazo" (service_role).
-- 6. Vista cheques_banco_demorados (para el vigía de Jarvis): depositados sin acreditar a las 96 h.
--
-- No mueve plata al aplicarse. Idempotente: se puede correr más de una vez.
-- ════════════════════════════════════════════════════════════════════════════════════════

-- ─── 1. Columnas ────────────────────────────────────────────────────────────────────────
ALTER TABLE public.cheques
  ADD COLUMN IF NOT EXISTS fecha_deposito              date,
  ADD COLUMN IF NOT EXISTS fecha_rechazo               date,
  ADD COLUMN IF NOT EXISTS motivo_rechazo              text,
  ADD COLUMN IF NOT EXISTS fecha_debito                date,
  ADD COLUMN IF NOT EXISTS fecha_acreditacion_esperada date;
COMMENT ON COLUMN public.cheques.fecha_acreditacion_esperada IS
  'Depositado: cuándo se espera que el banco lo acredite (depósito + días hábiles del banco). Bancos tanda 4.';

ALTER TABLE public.cuentas_bancarias
  ADD COLUMN IF NOT EXISTS cheque_dias_acreditacion smallint;
COMMENT ON COLUMN public.cuentas_bancarias.cheque_dias_acreditacion IS
  'Días hábiles que tarda el banco en acreditar un cheque depositado. Vacío = 2 (48 h).';

-- ─── 2. Días hábiles bancarios ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dias_habiles_sumar(p_desde date, p_dias int)
RETURNS date
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d date := p_desde;
  v_n int := 0;
  v_hay_cal boolean := to_regclass('public.calendario_dias') IS NOT NULL;
  v_feriado boolean;
BEGIN
  IF p_desde IS NULL THEN RETURN NULL; END IF;
  WHILE v_n < GREATEST(COALESCE(p_dias, 0), 0) LOOP
    v_d := v_d + 1;
    CONTINUE WHEN extract(isodow FROM v_d) IN (6, 7);
    v_feriado := false;
    IF v_hay_cal THEN
      EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.calendario_dias WHERE fecha = $1 AND tipo IN (''feriado'', ''puente''))'
        INTO v_feriado USING v_d;
    END IF;
    CONTINUE WHEN v_feriado;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_d;
END;
$$;

-- ─── 3. Ajustes ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cheques_banco_ajustes (
  id              boolean PRIMARY KEY DEFAULT true CHECK (id),
  modo_propuesta  boolean NOT NULL DEFAULT true,
  dias_alerta     smallint NOT NULL DEFAULT 4,
  actualizado_por uuid,
  actualizado_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.cheques_banco_ajustes IS
  'Cheques contra el banco. modo_propuesta = solo propone acreditaciones/débitos (no los hace). dias_alerta = días hábiles sin acreditar para avisar (4 = 96 h).';
INSERT INTO public.cheques_banco_ajustes (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.cheques_banco_ajustes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cheques_banco_ajustes FROM anon;
GRANT SELECT ON TABLE public.cheques_banco_ajustes TO authenticated;
GRANT ALL ON TABLE public.cheques_banco_ajustes TO service_role;
DO $$
BEGIN
  CREATE POLICY "cheques_banco_ajustes_leer" ON public.cheques_banco_ajustes FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Fecha esperada de acreditación al pasar a DEPOSITADO
CREATE OR REPLACE FUNCTION public.cheque_fecha_esperada_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dias  int;
  v_calc  boolean := false;
BEGIN
  IF NEW.estado::text = 'DEPOSITADO' THEN
    IF TG_OP = 'INSERT' OR NEW.fecha_acreditacion_esperada IS NULL THEN
      v_calc := true;
    ELSIF OLD.estado::text IS DISTINCT FROM 'DEPOSITADO'
       OR OLD.fecha_deposito IS DISTINCT FROM NEW.fecha_deposito
       OR OLD.cuenta_banco_id IS DISTINCT FROM NEW.cuenta_banco_id THEN
      v_calc := true;
    END IF;
  END IF;
  IF v_calc THEN
    SELECT cb.cheque_dias_acreditacion INTO v_dias FROM cuentas_bancarias cb WHERE cb.id = NEW.cuenta_banco_id;
    NEW.fecha_acreditacion_esperada := dias_habiles_sumar(COALESCE(NEW.fecha_deposito, hoy_ar()), COALESCE(v_dias, 2));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_cheque_fecha_esperada ON public.cheques;
CREATE TRIGGER trg_cheque_fecha_esperada
  BEFORE INSERT OR UPDATE OF estado, fecha_deposito, cuenta_banco_id ON public.cheques
  FOR EACH ROW EXECUTE FUNCTION public.cheque_fecha_esperada_trg();

-- Los que ya estaban depositados
UPDATE public.cheques c
   SET fecha_acreditacion_esperada = public.dias_habiles_sumar(
         COALESCE(c.fecha_deposito, public.hoy_ar()),
         COALESCE((SELECT cb.cheque_dias_acreditacion FROM public.cuentas_bancarias cb WHERE cb.id = c.cuenta_banco_id), 2))
 WHERE c.estado::text = 'DEPOSITADO' AND c.fecha_acreditacion_esperada IS NULL;

-- ─── 4. Vínculos y avisos ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cheques_banco_vinculos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movimiento_id  uuid NOT NULL REFERENCES public.banco_extractos_movimientos(id) ON DELETE CASCADE,
  cheque_id      uuid NOT NULL REFERENCES public.cheques(id) ON DELETE CASCADE,
  rol            varchar(20) NOT NULL CHECK (rol IN ('acreditacion', 'comision', 'debito_propio', 'rechazo')),
  kardex_id      uuid,
  automatico     boolean NOT NULL DEFAULT false,
  creado_por     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (movimiento_id, cheque_id, rol)
);
CREATE INDEX IF NOT EXISTS idx_cbv_cheque ON public.cheques_banco_vinculos (cheque_id);
COMMENT ON TABLE public.cheques_banco_vinculos IS 'Qué renglón del banco acreditó / debitó / rechazó qué cheque (bancos tanda 4).';

CREATE TABLE IF NOT EXISTS public.cheques_banco_avisos (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo                   varchar(12) NOT NULL CHECK (tipo IN ('rechazo', 'acreditar', 'debitar')),
  movimiento_id          uuid NOT NULL REFERENCES public.banco_extractos_movimientos(id) ON DELETE CASCADE,
  cuenta_bancaria_id     uuid REFERENCES public.cuentas_bancarias(id),
  fecha                  date,
  monto                  numeric(14,2),
  descripcion            text,
  -- rechazo: cheques posibles (el dueño elige); acreditar/debitar: los que se aplicarían
  cheque_ids             uuid[] NOT NULL DEFAULT '{}',
  comision_movimiento_id uuid REFERENCES public.banco_extractos_movimientos(id) ON DELETE SET NULL,
  estado                 varchar(12) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aplicado', 'descartado')),
  resultado              jsonb,
  creado_at              timestamptz NOT NULL DEFAULT now(),
  resuelto_por           uuid,
  resuelto_at            timestamptz,
  UNIQUE (movimiento_id, tipo)
);
CREATE INDEX IF NOT EXISTS idx_cba_pendientes ON public.cheques_banco_avisos (estado, tipo) WHERE estado = 'pendiente';
COMMENT ON TABLE public.cheques_banco_avisos IS
  'Cheques contra el banco: rechazos que el dueño confirma (ND al cliente) y propuestas del modo propuesta.';

ALTER TABLE public.cheques_banco_vinculos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cheques_banco_avisos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cheques_banco_vinculos FROM anon;
REVOKE ALL ON TABLE public.cheques_banco_avisos FROM anon;
GRANT SELECT ON TABLE public.cheques_banco_vinculos TO authenticated;
GRANT SELECT, INSERT ON TABLE public.cheques_banco_avisos TO authenticated;
GRANT ALL ON TABLE public.cheques_banco_vinculos TO service_role;
GRANT ALL ON TABLE public.cheques_banco_avisos TO service_role;
DO $$
BEGIN
  CREATE POLICY "cbv_leer" ON public.cheques_banco_vinculos FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  CREATE POLICY "cba_leer" ON public.cheques_banco_avisos FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- El import (sesión del usuario) anota avisos nuevos; resolverlos es solo por las funciones de abajo
DO $$
BEGIN
  CREATE POLICY "cba_anotar" ON public.cheques_banco_avisos FOR INSERT TO authenticated WITH CHECK (estado = 'pendiente');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── 5. Aplicar con el renglón del banco ────────────────────────────────────────────────
-- p_accion: 'acreditar' (uno o varios cheques de terceros DEPOSITADOS que suman el crédito) o
-- 'debitar' (un cheque propio ENTREGADO_A_PROVEEDOR). Todo se vuelve a controlar acá adentro:
-- renglón PENDIENTE y sin usar, misma cuenta, importes exactos al centavo.
CREATE OR REPLACE FUNCTION public.cheque_banco_aplicar(
  p_movimiento_id          uuid,
  p_accion                 text,
  p_cheque_ids             uuid[],
  p_comision_movimiento_id uuid DEFAULT NULL,
  p_usuario_id             uuid DEFAULT NULL,
  p_automatico             boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mov    banco_extractos_movimientos%ROWTYPE;
  v_com    banco_extractos_movimientos%ROWTYPE;
  v_ch     cheques%ROWTYPE;
  v_suma   numeric := 0;
  v_n      int := COALESCE(array_length(p_cheque_ids, 1), 0);
  v_gastos numeric := 0;
  v_res    jsonb;
  v_kardex uuid;
  v_primer uuid;
  v_id     uuid;
BEGIN
  SELECT * INTO v_mov FROM banco_extractos_movimientos WHERE id = p_movimiento_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'motivo', 'El renglón del banco no existe.'); END IF;
  IF v_mov.estado_matching <> 'PENDIENTE' OR EXISTS (SELECT 1 FROM cheques_banco_vinculos WHERE movimiento_id = p_movimiento_id AND rol <> 'rechazo') THEN
    RETURN jsonb_build_object('success', false, 'motivo', 'El renglón del banco ya está usado.');
  END IF;
  IF v_n = 0 THEN RETURN jsonb_build_object('success', false, 'motivo', 'Sin cheques.'); END IF;

  IF p_accion = 'acreditar' THEN
    IF v_mov.monto <= 0 THEN RETURN jsonb_build_object('success', false, 'motivo', 'El renglón no es un crédito.'); END IF;
    FOR v_id IN SELECT unnest(p_cheque_ids) ORDER BY 1 LOOP
      SELECT * INTO v_ch FROM cheques WHERE id = v_id FOR UPDATE;
      IF NOT FOUND OR v_ch.estado::text <> 'DEPOSITADO' OR v_ch.cuenta_banco_id IS DISTINCT FROM v_mov.cuenta_bancaria_id THEN
        RETURN jsonb_build_object('success', false, 'motivo', 'Un cheque ya no está depositado en esa cuenta.');
      END IF;
      v_suma := v_suma + abs(v_ch.monto);
    END LOOP;
    IF abs(v_suma - v_mov.monto) >= 0.005 THEN
      RETURN jsonb_build_object('success', false, 'motivo', 'Los importes no coinciden.');
    END IF;

    -- Comisión del banco por ese cheque (solo con un cheque y si el renglón sigue sin usar)
    IF p_comision_movimiento_id IS NOT NULL AND v_n = 1 THEN
      SELECT * INTO v_com FROM banco_extractos_movimientos WHERE id = p_comision_movimiento_id FOR UPDATE;
      IF FOUND AND v_com.estado_matching = 'PENDIENTE' AND v_com.monto < 0
         AND v_com.cuenta_bancaria_id = v_mov.cuenta_bancaria_id AND v_com.fecha = v_mov.fecha
         AND NOT EXISTS (SELECT 1 FROM cheques_banco_vinculos WHERE movimiento_id = v_com.id) THEN
        v_gastos := abs(v_com.monto);
      ELSE
        p_comision_movimiento_id := NULL;
      END IF;
    ELSE
      p_comision_movimiento_id := NULL;
    END IF;

    FOR v_id IN SELECT unnest(p_cheque_ids) ORDER BY 1 LOOP
      v_res := caja_acreditar_cheque(v_id, CASE WHEN p_comision_movimiento_id IS NOT NULL THEN v_gastos ELSE 0 END, p_usuario_id);
      v_kardex := NULLIF(v_res->>'kardex_id', '')::uuid;
      v_primer := COALESCE(v_primer, v_kardex);
      INSERT INTO cheques_banco_vinculos (movimiento_id, cheque_id, rol, kardex_id, automatico, creado_por)
      VALUES (p_movimiento_id, v_id, 'acreditacion', v_kardex, p_automatico, p_usuario_id)
      ON CONFLICT DO NOTHING;
      IF p_comision_movimiento_id IS NOT NULL THEN
        INSERT INTO cheques_banco_vinculos (movimiento_id, cheque_id, rol, kardex_id, automatico, creado_por)
        VALUES (p_comision_movimiento_id, v_id, 'comision', v_kardex, p_automatico, p_usuario_id)
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;

    IF p_comision_movimiento_id IS NOT NULL THEN
      UPDATE banco_extractos_movimientos
         SET estado_matching = 'CONCILIADO', matcheado_por = p_usuario_id, matcheado_at = now()
       WHERE id = p_comision_movimiento_id;
    END IF;

  ELSIF p_accion = 'debitar' THEN
    IF v_mov.monto >= 0 OR v_n <> 1 THEN RETURN jsonb_build_object('success', false, 'motivo', 'El renglón no es un débito de un cheque.'); END IF;
    SELECT * INTO v_ch FROM cheques WHERE id = p_cheque_ids[1] FOR UPDATE;
    IF NOT FOUND OR v_ch.tipo::text <> 'PROPIO' OR v_ch.estado::text <> 'ENTREGADO_A_PROVEEDOR'
       OR (v_ch.cuenta_banco_id IS NOT NULL AND v_ch.cuenta_banco_id <> v_mov.cuenta_bancaria_id) THEN
      RETURN jsonb_build_object('success', false, 'motivo', 'El cheque propio ya no está entregado o es de otra cuenta.');
    END IF;
    IF abs(abs(v_ch.monto) - abs(v_mov.monto)) >= 0.005 THEN
      RETURN jsonb_build_object('success', false, 'motivo', 'Los importes no coinciden.');
    END IF;
    v_res := cheque_propio_debitar(v_ch.id, v_mov.fecha, v_mov.cuenta_bancaria_id, p_usuario_id);
    v_primer := NULLIF(v_res->>'kardex_id', '')::uuid;
    INSERT INTO cheques_banco_vinculos (movimiento_id, cheque_id, rol, kardex_id, automatico, creado_por)
    VALUES (p_movimiento_id, v_ch.id, 'debito_propio', v_primer, p_automatico, p_usuario_id)
    ON CONFLICT DO NOTHING;
  ELSE
    RETURN jsonb_build_object('success', false, 'motivo', 'Acción desconocida.');
  END IF;

  UPDATE banco_extractos_movimientos
     SET estado_matching = 'CONCILIADO', kardex_id = COALESCE(v_primer, kardex_id),
         matcheado_por = p_usuario_id, matcheado_at = now()
   WHERE id = p_movimiento_id;

  UPDATE cheques_banco_avisos
     SET estado = 'aplicado', resuelto_por = p_usuario_id, resuelto_at = now(),
         resultado = jsonb_build_object('gastos', v_gastos, 'kardex_id', v_primer)
   WHERE movimiento_id = p_movimiento_id AND tipo = p_accion AND estado = 'pendiente';

  RETURN jsonb_build_object('success', true, 'cheques', v_n, 'gastos', v_gastos, 'kardex_id', v_primer);
END;
$$;
REVOKE ALL ON FUNCTION public.cheque_banco_aplicar(uuid, text, uuid[], uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cheque_banco_aplicar(uuid, text, uuid[], uuid, uuid, boolean) TO authenticated, service_role;

-- Rechazo: SOLO con el botón del dueño. Corre el cheque_rechazar de siempre (ND al cliente si
-- el cobro estaba confirmado). El débito del banco queda en Conciliación para registrarlo.
CREATE OR REPLACE FUNCTION public.cheque_banco_confirmar_rechazo(
  p_aviso_id   uuid,
  p_cheque_id  uuid,
  p_usuario_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_av  cheques_banco_avisos%ROWTYPE;
  v_res jsonb;
BEGIN
  IF p_usuario_id IS NULL THEN RAISE EXCEPTION 'Falta quién confirma el rechazo.'; END IF;
  SELECT * INTO v_av FROM cheques_banco_avisos WHERE id = p_aviso_id FOR UPDATE;
  IF NOT FOUND OR v_av.tipo <> 'rechazo' THEN RAISE EXCEPTION 'El aviso de rechazo no existe.'; END IF;
  IF v_av.estado <> 'pendiente' THEN RETURN jsonb_build_object('success', false, 'motivo', 'El aviso ya se resolvió.'); END IF;
  IF NOT (p_cheque_id = ANY (v_av.cheque_ids)) THEN RAISE EXCEPTION 'Ese cheque no es uno de los posibles de este rechazo.'; END IF;

  v_res := cheque_rechazar(p_cheque_id, p_usuario_id,
             'Rechazo informado por el banco el ' || to_char(v_av.fecha, 'DD/MM/YYYY') || COALESCE(' (' || left(v_av.descripcion, 80) || ')', ''), 0);

  INSERT INTO cheques_banco_vinculos (movimiento_id, cheque_id, rol, automatico, creado_por)
  VALUES (v_av.movimiento_id, p_cheque_id, 'rechazo', false, p_usuario_id)
  ON CONFLICT DO NOTHING;

  UPDATE cheques_banco_avisos
     SET estado = 'aplicado', resuelto_por = p_usuario_id, resuelto_at = now(),
         resultado = v_res || jsonb_build_object('cheque_id', p_cheque_id)
   WHERE id = p_aviso_id;
  RETURN v_res;
END;
$$;
REVOKE ALL ON FUNCTION public.cheque_banco_confirmar_rechazo(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cheque_banco_confirmar_rechazo(uuid, uuid, uuid) TO service_role;

-- ─── 6. Demorados (para el vigía de Jarvis) ─────────────────────────────────────────────
CREATE OR REPLACE VIEW public.cheques_banco_demorados WITH (security_invoker = true) AS
SELECT c.id, c.numero, c.banco, c.monto, c.es_echeq, c.cuenta_banco_id, cb.nombre AS cuenta_nombre,
       c.fecha_deposito, c.fecha_acreditacion_esperada,
       public.dias_habiles_sumar(c.fecha_deposito, COALESCE(a.dias_alerta, 4)) AS fecha_alerta
  FROM public.cheques c
  LEFT JOIN public.cuentas_bancarias cb ON cb.id = c.cuenta_banco_id
  LEFT JOIN public.cheques_banco_ajustes a ON a.id
 WHERE c.estado::text = 'DEPOSITADO'
   AND c.fecha_deposito IS NOT NULL
   AND public.hoy_ar() >= public.dias_habiles_sumar(c.fecha_deposito, COALESCE(a.dias_alerta, 4));
REVOKE ALL ON public.cheques_banco_demorados FROM anon;
GRANT SELECT ON public.cheques_banco_demorados TO authenticated, service_role;
