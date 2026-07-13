-- ═════════════════════════════════════════════════════════════════════════
-- CALENDARIO DE PAGOS A PROVEEDORES + AJUSTE MANUAL DE SALDOS
-- 2026-07-13
--
-- 1. Columnas nuevas en `vencimientos` para el calendario de pagos:
--    forma_pago, fecha_validez (ej: cheques a 30 días), modalidad
--    (deposito = lo voy a depositar / entrega = queda en caja para que
--    lo retire el proveedor) y descuentos_aplicados (si es false hay que
--    chequear notas de crédito / retenciones antes de pagar).
--
-- 2. caja_ajustar(): edición manual del saldo de cualquier cuenta de
--    fondos. Implementa el tipo de movimiento AJUSTE_CAJA que quedó
--    reservado en el diseño del kardex (20260708_b1). No pisa el ledger:
--    registra la diferencia como un movimiento AJUSTE_CAJA en
--    kardex_contable y deja saldos_financieros en el valor indicado.
-- ═════════════════════════════════════════════════════════════════════════

-- ── 1. Vencimientos: campos del calendario ────────────────────────────────
ALTER TABLE public.vencimientos
  ADD COLUMN IF NOT EXISTS forma_pago varchar(20)
    CHECK (forma_pago IS NULL OR forma_pago IN ('efectivo', 'transferencia', 'cheque')),
  ADD COLUMN IF NOT EXISTS fecha_validez date,
  ADD COLUMN IF NOT EXISTS modalidad varchar(10)
    CHECK (modalidad IS NULL OR modalidad IN ('deposito', 'entrega')),
  ADD COLUMN IF NOT EXISTS descuentos_aplicados boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.vencimientos.forma_pago IS
  'efectivo | transferencia | cheque. NULL en registros anteriores al calendario.';
COMMENT ON COLUMN public.vencimientos.fecha_validez IS
  'Fecha en que el pago queda efectivo (ej: pago 13/7 con cheques a 30 días → validez 13/8). NULL = igual al vencimiento.';
COMMENT ON COLUMN public.vencimientos.modalidad IS
  'deposito = lo deposito yo | entrega = queda en caja para que lo retire el proveedor.';
COMMENT ON COLUMN public.vencimientos.descuentos_aplicados IS
  'true = el monto es final. false = falta chequear notas de crédito / retenciones.';

CREATE INDEX IF NOT EXISTS idx_vencimientos_forma_pago
  ON public.vencimientos (forma_pago) WHERE forma_pago IS NOT NULL;

-- ── 2. caja_ajustar — fijar saldo manual vía kardex (AJUSTE_CAJA) ─────────
CREATE OR REPLACE FUNCTION public.caja_ajustar(
  p_cuenta_tipo text,               -- CAJA | BANCO | BILLETERA | INVERSION
  p_cuenta_id   uuid,
  p_color       text,               -- BLANCO | NEGRO
  p_nuevo_saldo numeric,
  p_motivo      text DEFAULT NULL,
  p_usuario_id  uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id           uuid;
  v_saldo_actual numeric;
  v_delta        numeric;
BEGIN
  IF p_cuenta_tipo NOT IN ('CAJA', 'BANCO', 'BILLETERA', 'INVERSION') THEN
    RAISE EXCEPTION 'caja_ajustar: cuenta_tipo inválido (%)', p_cuenta_tipo;
  END IF;
  IF p_color NOT IN ('BLANCO', 'NEGRO') THEN
    RAISE EXCEPTION 'caja_ajustar: color inválido (%)', p_color;
  END IF;
  IF p_cuenta_id IS NULL OR p_nuevo_saldo IS NULL THEN
    RAISE EXCEPTION 'caja_ajustar: cuenta_id y nuevo_saldo son obligatorios';
  END IF;

  SELECT saldo INTO v_saldo_actual
  FROM saldos_financieros
  WHERE cuenta_tipo = p_cuenta_tipo::fund_account_type
    AND cuenta_id = p_cuenta_id
    AND color = p_color::money_color
  FOR UPDATE;

  v_saldo_actual := COALESCE(v_saldo_actual, 0);
  v_delta := p_nuevo_saldo - v_saldo_actual;

  IF v_delta = 0 THEN
    RETURN NULL;  -- sin cambio, no ensuciar el ledger
  END IF;

  INSERT INTO saldos_financieros (cuenta_tipo, cuenta_id, color, saldo)
  VALUES (p_cuenta_tipo::fund_account_type, p_cuenta_id, p_color::money_color, p_nuevo_saldo)
  ON CONFLICT (cuenta_tipo, cuenta_id, color)
  DO UPDATE SET saldo = p_nuevo_saldo, updated_at = now();

  -- Delta positivo: la cuenta es destino. Negativo: la cuenta es origen.
  INSERT INTO kardex_contable (
    tipo_movimiento, concepto, monto, color, gastos,
    origen_tipo, origen_id, destino_tipo, destino_id,
    cobrador_id, verificado, verificado_por, verificado_at,
    saldo_origen_after, saldo_destino_after
  ) VALUES (
    'AJUSTE_CAJA',
    COALESCE(NULLIF(trim(p_motivo), ''), 'Ajuste manual de saldo'),
    abs(v_delta), p_color, 0,
    CASE WHEN v_delta < 0 THEN p_cuenta_tipo END,
    CASE WHEN v_delta < 0 THEN p_cuenta_id END,
    CASE WHEN v_delta > 0 THEN p_cuenta_tipo END,
    CASE WHEN v_delta > 0 THEN p_cuenta_id END,
    p_usuario_id, true, p_usuario_id, now(),
    CASE WHEN v_delta < 0 THEN p_nuevo_saldo END,
    CASE WHEN v_delta > 0 THEN p_nuevo_saldo END
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.caja_ajustar FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.caja_ajustar TO authenticated, service_role;
