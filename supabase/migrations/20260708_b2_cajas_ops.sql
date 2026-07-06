-- ─────────────────────────────────────────────────────────────────────────────
-- FASE B2 — Operaciones de caja (REQUIERE B1 aplicada)
--
-- Todas las operaciones de fondos pasan por kardex_registrar (B1):
--   caja_transferir        movimiento entre cuentas con gastos bancarios
--                          (ej. MercadoPago → Nación con comisión;
--                           caja chica ↔ caja grande)
--   caja_egreso            gasto desde una cuenta (egresos_generales + kardex)
--   caja_depositar_cheque  EN_CARTERA → DEPOSITADO (sin mover saldo aún)
--   caja_acreditar_cheque  DEPOSITADO → COBRADO (acredita en el banco,
--                          neto de gastos)
--
-- Las RPC legacy fin_depositar_cheque / fin_cobrar_cheque quedan DEPRECADAS
-- (no se dropean hasta retirar el circuito /finanzas legacy).
--
-- Idempotente: CREATE OR REPLACE / IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.cheques ADD COLUMN IF NOT EXISTS es_echeq boolean NOT NULL DEFAULT false;

-- ═════════════════════════════════════════════════════════════════════════
-- 1. caja_transferir
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.caja_transferir(
  p_origen_tipo  text,     -- CAJA | BANCO | BILLETERA
  p_origen_id    uuid,
  p_destino_tipo text,
  p_destino_id   uuid,
  p_monto        numeric,
  p_gastos       numeric DEFAULT 0,
  p_color        text DEFAULT 'BLANCO',
  p_concepto     text DEFAULT NULL,
  p_usuario_id   uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_saldo    numeric;
  v_kardex   uuid;
BEGIN
  IF p_origen_tipo NOT IN ('CAJA', 'BANCO', 'BILLETERA')
     OR p_destino_tipo NOT IN ('CAJA', 'BANCO', 'BILLETERA') THEN
    RAISE EXCEPTION 'caja_transferir: origen/destino deben ser CAJA, BANCO o BILLETERA';
  END IF;
  IF p_origen_tipo = p_destino_tipo AND p_origen_id = p_destino_id THEN
    RAISE EXCEPTION 'caja_transferir: origen y destino no pueden ser la misma cuenta';
  END IF;
  IF COALESCE(p_monto, 0) <= 0 THEN
    RAISE EXCEPTION 'caja_transferir: el monto debe ser > 0';
  END IF;

  -- Validar saldo disponible en origen (con lock)
  SELECT saldo INTO v_saldo
  FROM saldos_financieros
  WHERE cuenta_tipo = p_origen_tipo::fund_account_type
    AND cuenta_id = p_origen_id
    AND color = COALESCE(p_color, 'BLANCO')::money_color
  FOR UPDATE;

  IF COALESCE(v_saldo, 0) < p_monto THEN
    RAISE EXCEPTION 'caja_transferir: saldo insuficiente en origen (disponible %, requerido %)',
      COALESCE(v_saldo, 0), p_monto;
  END IF;

  v_kardex := kardex_registrar(
    p_tipo_movimiento => 'TRANSFERENCIA_INTERNA',
    p_concepto        => COALESCE(NULLIF(trim(p_concepto), ''), 'Transferencia entre cuentas'),
    p_monto           => p_monto,
    p_color           => p_color,
    p_origen_tipo     => p_origen_tipo,
    p_origen_id       => p_origen_id,
    p_destino_tipo    => p_destino_tipo,
    p_destino_id      => p_destino_id,
    p_metodo          => 'TRANSFERENCIA',
    p_gastos          => p_gastos,
    p_referencia_tipo => 'transferencia_interna',
    p_usuario_id      => p_usuario_id,
    p_verificado      => true   -- movimiento interno: una sola firma alcanza
  );

  RETURN jsonb_build_object('success', true, 'kardex_id', v_kardex,
    'neto_acreditado', p_monto - GREATEST(COALESCE(p_gastos, 0), 0));
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 2. caja_egreso
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.caja_egreso(
  p_origen_tipo text,      -- CAJA | BANCO | BILLETERA
  p_origen_id   uuid,
  p_categoria   text,      -- OPERATIVO | SUELDOS | INVERSION | CREDITO | IMPUESTOS | OTROS
  p_monto       numeric,
  p_color       text DEFAULT 'BLANCO',
  p_concepto    text DEFAULT NULL,
  p_usuario_id  uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_saldo   numeric;
  v_egreso  uuid;
  v_kardex  uuid;
BEGIN
  IF COALESCE(p_monto, 0) <= 0 THEN
    RAISE EXCEPTION 'caja_egreso: el monto debe ser > 0';
  END IF;
  IF COALESCE(trim(p_concepto), '') = '' THEN
    RAISE EXCEPTION 'caja_egreso: el concepto es obligatorio';
  END IF;

  SELECT saldo INTO v_saldo
  FROM saldos_financieros
  WHERE cuenta_tipo = p_origen_tipo::fund_account_type
    AND cuenta_id = p_origen_id
    AND color = COALESCE(p_color, 'BLANCO')::money_color
  FOR UPDATE;

  IF COALESCE(v_saldo, 0) < p_monto THEN
    RAISE EXCEPTION 'caja_egreso: saldo insuficiente (disponible %, requerido %)',
      COALESCE(v_saldo, 0), p_monto;
  END IF;

  INSERT INTO egresos_generales (fecha, categoria, descripcion, metodo, color, monto, origen_tipo, origen_id, creado_por)
  VALUES (
    now(), p_categoria::expense_category, p_concepto,
    CASE WHEN p_origen_tipo = 'BANCO' THEN 'TRANSFERENCIA' ELSE 'EFECTIVO' END::payment_method,
    COALESCE(p_color, 'BLANCO')::money_color, p_monto,
    p_origen_tipo::fund_account_type, p_origen_id, p_usuario_id
  ) RETURNING id INTO v_egreso;

  v_kardex := kardex_registrar(
    p_tipo_movimiento => 'EGRESO_GENERAL',
    p_concepto        => '[' || p_categoria || '] ' || p_concepto,
    p_monto           => p_monto,
    p_color           => p_color,
    p_origen_tipo     => p_origen_tipo,
    p_origen_id       => p_origen_id,
    p_destino_tipo    => 'GASTO',
    p_metodo          => CASE WHEN p_origen_tipo = 'BANCO' THEN 'TRANSFERENCIA' ELSE 'EFECTIVO' END,
    p_referencia_tipo => 'egreso_general',
    p_referencia_id   => v_egreso,
    p_usuario_id      => p_usuario_id,
    p_verificado      => true
  );

  RETURN jsonb_build_object('success', true, 'egreso_id', v_egreso, 'kardex_id', v_kardex);
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 3. caja_depositar_cheque — EN_CARTERA → DEPOSITADO (aún sin saldo)
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.caja_depositar_cheque(
  p_cheque_id       uuid,
  p_cuenta_banco_id uuid,
  p_gastos          numeric DEFAULT 0,
  p_usuario_id      uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cheque cheques%ROWTYPE;
  v_kardex uuid;
BEGIN
  SELECT * INTO v_cheque FROM cheques WHERE id = p_cheque_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'caja_depositar_cheque: cheque % no encontrado', p_cheque_id; END IF;
  IF v_cheque.estado <> 'EN_CARTERA' THEN
    RAISE EXCEPTION 'caja_depositar_cheque: el cheque está en estado % (se requiere EN_CARTERA)', v_cheque.estado;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cuentas_bancarias WHERE id = p_cuenta_banco_id AND activo) THEN
    RAISE EXCEPTION 'caja_depositar_cheque: cuenta bancaria % inexistente o inactiva', p_cuenta_banco_id;
  END IF;

  UPDATE cheques
  SET estado = 'DEPOSITADO',
      cuenta_banco_id = p_cuenta_banco_id,
      fecha_deposito = (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
  WHERE id = p_cheque_id;

  -- Kardex informativo: el saldo del banco se acredita recién al COBRARSE
  v_kardex := kardex_registrar(
    p_tipo_movimiento => 'DEPOSITO_CHEQUE',
    p_concepto        => 'Depósito cheque ' || COALESCE(v_cheque.numero, left(p_cheque_id::text, 8))
                         || CASE WHEN v_cheque.es_echeq THEN ' (e-cheq)' ELSE '' END,
    p_monto           => v_cheque.monto,
    p_color           => v_cheque.color::text,
    p_origen_tipo     => 'EN_CARTERA',
    p_origen_id       => p_cheque_id,
    p_destino_tipo    => 'EXTERNO',   -- en clearing; no acredita saldo todavía
    p_metodo          => 'DEPOSITO',
    p_gastos          => p_gastos,
    p_referencia_tipo => 'cheque',
    p_referencia_id   => p_cheque_id,
    p_cheque_id       => p_cheque_id,
    p_cliente_id      => v_cheque.cliente_origen_id,
    p_usuario_id      => p_usuario_id,
    p_verificado      => true
  );

  RETURN jsonb_build_object('success', true, 'kardex_id', v_kardex);
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 4. caja_acreditar_cheque — DEPOSITADO → COBRADO (acredita saldo del banco)
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.caja_acreditar_cheque(
  p_cheque_id  uuid,
  p_gastos     numeric DEFAULT 0,
  p_usuario_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cheque cheques%ROWTYPE;
  v_kardex uuid;
BEGIN
  SELECT * INTO v_cheque FROM cheques WHERE id = p_cheque_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'caja_acreditar_cheque: cheque % no encontrado', p_cheque_id; END IF;
  IF v_cheque.estado <> 'DEPOSITADO' THEN
    RAISE EXCEPTION 'caja_acreditar_cheque: el cheque está en estado % (se requiere DEPOSITADO)', v_cheque.estado;
  END IF;
  IF v_cheque.cuenta_banco_id IS NULL THEN
    RAISE EXCEPTION 'caja_acreditar_cheque: el cheque no tiene cuenta bancaria de depósito';
  END IF;

  UPDATE cheques SET estado = 'COBRADO' WHERE id = p_cheque_id;

  v_kardex := kardex_registrar(
    p_tipo_movimiento => 'ACREDITACION_CHEQUE',
    p_concepto        => 'Acreditación cheque ' || COALESCE(v_cheque.numero, left(p_cheque_id::text, 8))
                         || CASE WHEN v_cheque.es_echeq THEN ' (e-cheq)' ELSE '' END,
    p_monto           => v_cheque.monto,
    p_color           => v_cheque.color::text,
    p_origen_tipo     => 'EN_CARTERA',
    p_origen_id       => p_cheque_id,
    p_destino_tipo    => 'BANCO',
    p_destino_id      => v_cheque.cuenta_banco_id,
    p_metodo          => 'DEPOSITO',
    p_gastos          => p_gastos,
    p_referencia_tipo => 'cheque',
    p_referencia_id   => p_cheque_id,
    p_cheque_id       => p_cheque_id,
    p_cliente_id      => v_cheque.cliente_origen_id,
    p_usuario_id      => p_usuario_id,
    p_verificado      => true
  );

  RETURN jsonb_build_object('success', true, 'kardex_id', v_kardex,
    'neto_acreditado', abs(v_cheque.monto) - GREATEST(COALESCE(p_gastos, 0), 0));
END;
$$;

-- ── Deprecar RPCs legacy ──
COMMENT ON FUNCTION public.fin_depositar_cheque IS 'DEPRECADA (Fase B2): usar caja_depositar_cheque.';
COMMENT ON FUNCTION public.fin_cobrar_cheque IS 'DEPRECADA (Fase B2): usar caja_acreditar_cheque.';

-- ── Vista de control: saldo materializado vs ledger ──
CREATE OR REPLACE VIEW public.v_saldos_control AS
WITH ledger AS (
  SELECT destino_tipo AS cuenta_tipo, destino_id AS cuenta_id,
         COALESCE(color, 'BLANCO') AS color,
         sum(abs(monto) - COALESCE(gastos, 0)) AS entra, 0::numeric AS sale
  FROM kardex_contable
  WHERE destino_tipo IN ('CAJA', 'BANCO', 'BILLETERA') AND destino_id IS NOT NULL
  GROUP BY 1, 2, 3
  UNION ALL
  SELECT origen_tipo, origen_id, COALESCE(color, 'BLANCO'),
         0, sum(abs(monto))
  FROM kardex_contable
  WHERE origen_tipo IN ('CAJA', 'BANCO', 'BILLETERA') AND origen_id IS NOT NULL
  GROUP BY 1, 2, 3
)
SELECT
  sf.cuenta_tipo, sf.cuenta_id, sf.color,
  sf.saldo AS saldo_materializado,
  COALESCE(sum(l.entra - l.sale), 0) AS saldo_ledger,
  sf.saldo - COALESCE(sum(l.entra - l.sale), 0) AS diferencia
FROM saldos_financieros sf
LEFT JOIN ledger l
  ON l.cuenta_tipo = sf.cuenta_tipo::text
 AND l.cuenta_id = sf.cuenta_id
 AND l.color = sf.color::text
GROUP BY sf.cuenta_tipo, sf.cuenta_id, sf.color, sf.saldo;

-- ── Permisos ──
REVOKE ALL ON FUNCTION public.caja_transferir FROM PUBLIC;
REVOKE ALL ON FUNCTION public.caja_egreso FROM PUBLIC;
REVOKE ALL ON FUNCTION public.caja_depositar_cheque FROM PUBLIC;
REVOKE ALL ON FUNCTION public.caja_acreditar_cheque FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.caja_transferir TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.caja_egreso TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.caja_depositar_cheque TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.caja_acreditar_cheque TO authenticated, service_role;
GRANT SELECT ON public.v_saldos_control TO authenticated, service_role;
