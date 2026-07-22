-- ─────────────────────────────────────────────────────────────────────────────
-- FASE G2 — Ingresos bancarios desde extracto (REQUIERE G1)
--
-- Créditos del extracto sin contraparte en el sistema que NO son cobranzas:
-- rendimientos de MercadoPago/FCI, intereses, reintegros. Se registran como
-- ingreso real: kardex 'INGRESO_BANCARIO' con destino la cuenta (sube saldo)
-- y el movimiento del extracto queda REGISTRADO_INGRESO.
-- ─────────────────────────────────────────────────────────────────────────────

-- Fuente 'pdf' (extractos PDF leídos por OCR)
ALTER TABLE public.banco_extractos
  DROP CONSTRAINT IF EXISTS banco_extractos_fuente_check;
ALTER TABLE public.banco_extractos
  ADD CONSTRAINT banco_extractos_fuente_check
  CHECK (fuente IN ('csv', 'excel', 'pdf', 'api_mp', 'api_banco'));

-- Estado nuevo en el CHECK de matching
ALTER TABLE public.banco_extractos_movimientos
  DROP CONSTRAINT IF EXISTS banco_extractos_movimientos_estado_matching_check;
ALTER TABLE public.banco_extractos_movimientos
  ADD CONSTRAINT banco_extractos_movimientos_estado_matching_check
  CHECK (estado_matching IN ('PENDIENTE', 'SUGERIDO', 'CONCILIADO', 'REGISTRADO_EGRESO', 'REGISTRADO_INGRESO', 'IGNORADO'));

CREATE OR REPLACE FUNCTION public.extracto_registrar_ingreso(
  p_mov_id     uuid,
  p_usuario_id uuid,
  p_concepto   text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mov    banco_extractos_movimientos%ROWTYPE;
  v_kardex uuid;
BEGIN
  SELECT * INTO v_mov FROM banco_extractos_movimientos WHERE id = p_mov_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'extracto_registrar_ingreso: movimiento % no encontrado', p_mov_id;
  END IF;
  IF v_mov.estado_matching NOT IN ('PENDIENTE', 'SUGERIDO') THEN
    RAISE EXCEPTION 'extracto_registrar_ingreso: el movimiento ya está %', v_mov.estado_matching;
  END IF;
  IF v_mov.monto <= 0 THEN
    RAISE EXCEPTION 'extracto_registrar_ingreso: solo aplica a créditos (monto positivo)';
  END IF;

  v_kardex := kardex_registrar(
    p_tipo_movimiento => 'INGRESO_BANCARIO',
    p_concepto        => COALESCE(NULLIF(trim(p_concepto), ''), 'Extracto: ' || COALESCE(v_mov.descripcion, 'crédito bancario')),
    p_monto           => v_mov.monto,
    p_destino_tipo    => 'BANCO',
    p_destino_id      => v_mov.cuenta_bancaria_id,
    p_metodo          => 'TRANSFERENCIA',
    p_referencia_tipo => 'banco_extracto_mov',
    p_referencia_id   => v_mov.id,
    p_usuario_id      => p_usuario_id,
    p_verificado      => true
  );

  UPDATE banco_extractos_movimientos
  SET estado_matching = 'REGISTRADO_INGRESO',
      kardex_id = v_kardex,
      matcheado_por = p_usuario_id, matcheado_at = now()
  WHERE id = p_mov_id;

  RETURN jsonb_build_object('success', true, 'kardex_id', v_kardex);
END;
$$;

REVOKE ALL ON FUNCTION public.extracto_registrar_ingreso(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.extracto_registrar_ingreso(uuid, uuid, text) TO authenticated, service_role;
