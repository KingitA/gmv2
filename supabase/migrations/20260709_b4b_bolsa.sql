-- ─────────────────────────────────────────────────────────────────────────────
-- FASE B4b — Caja Bolsa (REQUIERE B4a aplicada: valor 'INVERSION' en enum)
--
-- La "caja Bolsa" agrupa 4 cuentas de inversión: Obligaciones Negociables,
-- Acciones, CEDEARs y FCI. Cada una es una cuenta de fondos más:
--   saldos_financieros (INVERSION, cuenta_id, color) mantiene el saldo,
--   caja_transferir mueve plata banco ↔ bolsa (suscripción/rescate, con
--   gastos/comisiones), y todo queda en kardex_contable.
--
-- Esta migración:
--   1. Tabla cuentas_inversion + seed de los 4 instrumentos.
--   2. kardex_registrar y caja_transferir ahora aceptan INVERSION
--      (CREATE OR REPLACE de ambas con el dominio ampliado).
--   3. Apertura del FCI desde el último snapshot 'fondos_comunes' de
--      finanzas_saldos (guard idempotente, mismo criterio que B3).
--      ON / Acciones / CEDEARs abren en 0 — cargar su tenencia real con
--      una transferencia de apertura o pasarle los montos a Claude.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════
-- 1. Cuentas de inversión
-- ═════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.cuentas_inversion (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre           text NOT NULL UNIQUE,
  tipo_instrumento text NOT NULL CHECK (tipo_instrumento IN ('ON', 'ACCIONES', 'CEDEARS', 'FCI')),
  activo           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.cuentas_inversion (nombre, tipo_instrumento)
SELECT v.nombre, v.tipo FROM (VALUES
  ('Bolsa - Obligaciones Negociables', 'ON'),
  ('Bolsa - Acciones',                 'ACCIONES'),
  ('Bolsa - CEDEARs',                  'CEDEARS'),
  ('Bolsa - FCI',                      'FCI')
) AS v(nombre, tipo)
WHERE NOT EXISTS (SELECT 1 FROM public.cuentas_inversion c WHERE c.nombre = v.nombre);

GRANT SELECT ON public.cuentas_inversion TO authenticated, service_role;

-- ═════════════════════════════════════════════════════════════════════════
-- 2a. kardex_registrar — dominio de fondos ampliado con INVERSION
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.kardex_registrar(
  p_tipo_movimiento text,
  p_concepto        text,
  p_monto           numeric,
  p_color           text DEFAULT NULL,
  p_origen_tipo     text DEFAULT NULL,
  p_origen_id       uuid DEFAULT NULL,
  p_destino_tipo    text DEFAULT NULL,
  p_destino_id      uuid DEFAULT NULL,
  p_metodo          text DEFAULT NULL,
  p_gastos          numeric DEFAULT 0,
  p_referencia_tipo text DEFAULT NULL,
  p_referencia_id   uuid DEFAULT NULL,
  p_pago_id         uuid DEFAULT NULL,
  p_recibo_id       uuid DEFAULT NULL,
  p_cheque_id       uuid DEFAULT NULL,
  p_cliente_id      uuid DEFAULT NULL,
  p_viaje_id        uuid DEFAULT NULL,
  p_cobrador_id     uuid DEFAULT NULL,
  p_usuario_id      uuid DEFAULT NULL,
  p_verificado      boolean DEFAULT false,
  p_reversa_de      uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id            uuid;
  v_color         money_color := COALESCE(p_color, 'BLANCO')::money_color;
  v_gastos        numeric := GREATEST(COALESCE(p_gastos, 0), 0);
  v_neto_destino  numeric;
  v_saldo_origen  numeric := NULL;
  v_saldo_destino numeric := NULL;
  v_es_fondo_origen  boolean := p_origen_tipo IN ('CAJA', 'BANCO', 'BILLETERA', 'INVERSION') AND p_origen_id IS NOT NULL;
  v_es_fondo_destino boolean := p_destino_tipo IN ('CAJA', 'BANCO', 'BILLETERA', 'INVERSION') AND p_destino_id IS NOT NULL;
BEGIN
  IF COALESCE(p_monto, 0) = 0 THEN
    RAISE EXCEPTION 'kardex_registrar: p_monto no puede ser 0';
  END IF;
  IF v_gastos >= abs(p_monto) AND v_gastos > 0 THEN
    RAISE EXCEPTION 'kardex_registrar: los gastos (%) no pueden superar el monto (%)', v_gastos, p_monto;
  END IF;

  v_neto_destino := abs(p_monto) - v_gastos;

  IF v_es_fondo_origen THEN
    INSERT INTO saldos_financieros (cuenta_tipo, cuenta_id, color, saldo)
    VALUES (p_origen_tipo::fund_account_type, p_origen_id, v_color, -abs(p_monto))
    ON CONFLICT (cuenta_tipo, cuenta_id, color)
    DO UPDATE SET saldo = saldos_financieros.saldo - abs(p_monto), updated_at = now()
    RETURNING saldo INTO v_saldo_origen;
  END IF;

  IF v_es_fondo_destino THEN
    INSERT INTO saldos_financieros (cuenta_tipo, cuenta_id, color, saldo)
    VALUES (p_destino_tipo::fund_account_type, p_destino_id, v_color, v_neto_destino)
    ON CONFLICT (cuenta_tipo, cuenta_id, color)
    DO UPDATE SET saldo = saldos_financieros.saldo + v_neto_destino, updated_at = now()
    RETURNING saldo INTO v_saldo_destino;
  END IF;

  INSERT INTO kardex_contable (
    tipo_movimiento, concepto, monto, color, gastos,
    origen_tipo, origen_id, destino_tipo, destino_id, metodo,
    referencia_tipo, referencia_id, pago_id, recibo_id, cheque_id,
    cliente_id, viaje_id, cobrador_id,
    verificado, verificado_por, verificado_at,
    kardex_reversa_de, saldo_origen_after, saldo_destino_after
  ) VALUES (
    p_tipo_movimiento, p_concepto, p_monto, p_color, v_gastos,
    p_origen_tipo, p_origen_id, p_destino_tipo, p_destino_id, p_metodo,
    p_referencia_tipo, p_referencia_id, p_pago_id, p_recibo_id, p_cheque_id,
    p_cliente_id, p_viaje_id, COALESCE(p_cobrador_id, p_usuario_id),
    COALESCE(p_verificado, false),
    CASE WHEN p_verificado THEN p_usuario_id END,
    CASE WHEN p_verificado THEN now() END,
    p_reversa_de, v_saldo_origen, v_saldo_destino
  ) RETURNING id INTO v_id;

  IF v_gastos > 0 THEN
    INSERT INTO kardex_contable (
      tipo_movimiento, concepto, monto, color, gastos,
      origen_tipo, origen_id, destino_tipo, destino_id, metodo,
      referencia_tipo, referencia_id, cobrador_id, kardex_reversa_de
    ) VALUES (
      'GASTO_BANCARIO',
      'Gastos: ' || p_concepto,
      v_gastos, p_color, 0,
      p_destino_tipo, p_destino_id, 'GASTO', NULL, p_metodo,
      'kardex', v_id, COALESCE(p_cobrador_id, p_usuario_id), v_id
    );
  END IF;

  RETURN v_id;
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 2b. caja_transferir — acepta INVERSION (suscripción/rescate bolsa)
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.caja_transferir(
  p_origen_tipo  text,
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
  IF p_origen_tipo NOT IN ('CAJA', 'BANCO', 'BILLETERA', 'INVERSION')
     OR p_destino_tipo NOT IN ('CAJA', 'BANCO', 'BILLETERA', 'INVERSION') THEN
    RAISE EXCEPTION 'caja_transferir: origen/destino deben ser CAJA, BANCO, BILLETERA o INVERSION';
  END IF;
  IF p_origen_tipo = p_destino_tipo AND p_origen_id = p_destino_id THEN
    RAISE EXCEPTION 'caja_transferir: origen y destino no pueden ser la misma cuenta';
  END IF;
  IF COALESCE(p_monto, 0) <= 0 THEN
    RAISE EXCEPTION 'caja_transferir: el monto debe ser > 0';
  END IF;

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
    p_verificado      => true
  );

  RETURN jsonb_build_object('success', true, 'kardex_id', v_kardex,
    'neto_acreditado', p_monto - GREATEST(COALESCE(p_gastos, 0), 0));
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 3. Apertura Bolsa-FCI desde snapshot 'fondos_comunes' (guard idempotente)
--    ON / Acciones / CEDEARs abren en 0 (cargar tenencia real después).
-- ═════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_fci_id uuid;
  v_monto  numeric;
BEGIN
  SELECT id INTO v_fci_id FROM cuentas_inversion WHERE tipo_instrumento = 'FCI' LIMIT 1;

  SELECT monto INTO v_monto
  FROM finanzas_saldos
  WHERE caja_key = 'fondos_comunes'
  ORDER BY fecha DESC, created_at DESC
  LIMIT 1;

  IF v_fci_id IS NULL OR v_monto IS NULL OR v_monto = 0 THEN
    RAISE NOTICE 'Apertura Bolsa-FCI: sin cuenta o sin snapshot — omitida';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM kardex_contable
    WHERE tipo_movimiento = 'APERTURA_SALDO'
      AND referencia_tipo = 'apertura_saldo'
      AND destino_tipo = 'INVERSION' AND destino_id = v_fci_id
  ) THEN
    RAISE NOTICE 'Apertura Bolsa-FCI: ya realizada — omitida';
    RETURN;
  END IF;

  PERFORM kardex_registrar(
    p_tipo_movimiento => 'APERTURA_SALDO',
    p_concepto        => 'Apertura de saldo Bolsa - FCI (snapshot fondos_comunes)',
    p_monto           => v_monto,
    p_color           => 'BLANCO',
    p_origen_tipo     => 'EXTERNO',
    p_destino_tipo    => 'INVERSION',
    p_destino_id      => v_fci_id,
    p_referencia_tipo => 'apertura_saldo',
    p_verificado      => true
  );
  RAISE NOTICE 'Apertura Bolsa-FCI: $% acreditados', v_monto;
END $$;
