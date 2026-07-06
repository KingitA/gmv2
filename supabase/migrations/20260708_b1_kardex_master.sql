-- ─────────────────────────────────────────────────────────────────────────────
-- FASE B1 — Kardex maestro + registrador central de movimientos de dinero
-- (REQUIERE B0 aplicada: valor 'BILLETERA' en fund_account_type)
--
-- Arquitectura objetivo:
--   kardex_contable   = ledger maestro append-only de TODO movimiento (qué,
--                       quién, cómo, cuándo) — fuente de verdad.
--   saldos_financieros = saldos materializados por (cuenta_tipo, cuenta_id,
--                       color), actualizados SOLO por kardex_registrar().
--
-- Esta migración:
--   1. Amplía kardex_contable (gastos, viaje, reversas, verificación,
--      snapshots de saldo genéricos). saldo_caja_after/saldo_banco_after
--      quedan DEPRECADAS (no se escriben más).
--   2. Seed de cajas_financieras (Caja Chica / Caja Grande) — estaba vacía.
--   3. kardex_registrar(): función central — todo movimiento pasa por acá;
--      si origen/destino es CAJA/BANCO/BILLETERA actualiza saldos y
--      snapshotea. Los gastos (comisiones bancarias) generan línea hija
--      GASTO_BANCARIO y el destino recibe el neto.
--   4. Reescribe cobranza_confirmar: el kardex del cobro pasa por
--      kardex_registrar → el efectivo confirmado YA suma a su caja y las
--      transferencias a su banco. Además, si un método cheque no tiene
--      cheque vinculado, lo crea EN_CARTERA (antes solo lo hacía el chofer).
--
-- Tipos de movimiento del ledger (dominio VARCHAR, sin enum):
--   COBRO_CLIENTE | ANULACION_COBRO | DEBITO_CHEQUE_RECHAZADO |
--   RENDICION_VIAJE | TRANSFERENCIA_INTERNA | DEPOSITO_CHEQUE |
--   ACREDITACION_CHEQUE | GASTO_BANCARIO | EGRESO_GENERAL |
--   RETIRO_BILLETERA | PAGO_PROVEEDOR | AJUSTE_CAJA | APERTURA_SALDO
-- origen_tipo/destino_tipo:
--   CLIENTE | CAJA | BANCO | BILLETERA | EN_CARTERA | PROVEEDOR |
--   RETENCIONES | GASTO | EXTERNO
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════
-- 1. Ampliación de kardex_contable
-- ═════════════════════════════════════════════════════════════════════════
ALTER TABLE public.kardex_contable
  ADD COLUMN IF NOT EXISTS gastos              numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS viaje_id            uuid,
  ADD COLUMN IF NOT EXISTS kardex_reversa_de   uuid REFERENCES kardex_contable(id),
  ADD COLUMN IF NOT EXISTS verificado          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verificado_por      uuid,
  ADD COLUMN IF NOT EXISTS verificado_at       timestamptz,
  ADD COLUMN IF NOT EXISTS saldo_origen_after  numeric(14,2),
  ADD COLUMN IF NOT EXISTS saldo_destino_after numeric(14,2);

COMMENT ON COLUMN public.kardex_contable.saldo_caja_after IS
  'DEPRECADA (Fase B1): usar saldo_origen_after/saldo_destino_after.';
COMMENT ON COLUMN public.kardex_contable.saldo_banco_after IS
  'DEPRECADA (Fase B1): usar saldo_origen_after/saldo_destino_after.';

CREATE INDEX IF NOT EXISTS idx_kardex_contable_cuenta_origen
  ON public.kardex_contable (origen_tipo, origen_id);
CREATE INDEX IF NOT EXISTS idx_kardex_contable_cuenta_destino
  ON public.kardex_contable (destino_tipo, destino_id);
CREATE INDEX IF NOT EXISTS idx_kardex_contable_fecha
  ON public.kardex_contable (fecha DESC);

-- ═════════════════════════════════════════════════════════════════════════
-- 2. Seed de cajas físicas (idempotente por nombre)
-- ═════════════════════════════════════════════════════════════════════════
INSERT INTO public.cajas_financieras (nombre)
SELECT v.nombre FROM (VALUES ('Caja Chica'), ('Caja Grande')) AS v(nombre)
WHERE NOT EXISTS (SELECT 1 FROM public.cajas_financieras c WHERE c.nombre = v.nombre);

-- ═════════════════════════════════════════════════════════════════════════
-- 3. kardex_registrar — registrador central
--    Regla: color NULL se contabiliza como BLANCO en saldos (el kardex
--    conserva el color original informado). Si la cuenta (origen/destino)
--    es de fondos pero su id es NULL, se registra el kardex SIN mover saldo
--    (queda visible en la vista de control como movimiento sin cuenta).
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.kardex_registrar(
  p_tipo_movimiento text,
  p_concepto        text,
  p_monto           numeric,
  p_color           text DEFAULT NULL,          -- BLANCO | NEGRO | NULL
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
  v_es_fondo_origen  boolean := p_origen_tipo IN ('CAJA', 'BANCO', 'BILLETERA') AND p_origen_id IS NOT NULL;
  v_es_fondo_destino boolean := p_destino_tipo IN ('CAJA', 'BANCO', 'BILLETERA') AND p_destino_id IS NOT NULL;
BEGIN
  IF COALESCE(p_monto, 0) = 0 THEN
    RAISE EXCEPTION 'kardex_registrar: p_monto no puede ser 0';
  END IF;
  IF v_gastos >= abs(p_monto) AND v_gastos > 0 THEN
    RAISE EXCEPTION 'kardex_registrar: los gastos (%) no pueden superar el monto (%)', v_gastos, p_monto;
  END IF;

  v_neto_destino := abs(p_monto) - v_gastos;

  -- ── Saldo origen: resta el monto completo ──
  IF v_es_fondo_origen THEN
    INSERT INTO saldos_financieros (cuenta_tipo, cuenta_id, color, saldo)
    VALUES (p_origen_tipo::fund_account_type, p_origen_id, v_color, -abs(p_monto))
    ON CONFLICT (cuenta_tipo, cuenta_id, color)
    DO UPDATE SET saldo = saldos_financieros.saldo - abs(p_monto), updated_at = now()
    RETURNING saldo INTO v_saldo_origen;
  END IF;

  -- ── Saldo destino: suma el neto (monto − gastos) ──
  IF v_es_fondo_destino THEN
    INSERT INTO saldos_financieros (cuenta_tipo, cuenta_id, color, saldo)
    VALUES (p_destino_tipo::fund_account_type, p_destino_id, v_color, v_neto_destino)
    ON CONFLICT (cuenta_tipo, cuenta_id, color)
    DO UPDATE SET saldo = saldos_financieros.saldo + v_neto_destino, updated_at = now()
    RETURNING saldo INTO v_saldo_destino;
  END IF;

  -- ── Línea principal del ledger ──
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

  -- ── Gastos bancarios: línea hija (informativa; el neto ya se aplicó) ──
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

REVOKE ALL ON FUNCTION public.kardex_registrar FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kardex_registrar TO authenticated, service_role;

-- ═════════════════════════════════════════════════════════════════════════
-- 4. cobranza_confirmar v2 — kardex vía kardex_registrar + alta de cheques
--    (reemplaza la versión de A1; misma firma y retorno)
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.cobranza_confirmar(
  p_pago_id    uuid,
  p_usuario_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pago            pagos_clientes%ROWTYPE;
  v_ya_confirmado   boolean;
  v_imp             record;
  v_comp            record;
  v_nuevo_saldo     numeric;
  v_estado_pago     text;
  v_paid_ids        uuid[] := '{}';
  v_recibo_id       uuid;
  v_numero_recibo   text;
  v_siguiente       bigint;
  v_det             record;
  v_total_ret       numeric;
  v_hoy_ar          date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_caja_default    uuid;
  v_cheque_id       uuid;
  v_destino_tipo    text;
  v_destino_id      uuid;
BEGIN
  SELECT * INTO v_pago FROM pagos_clientes WHERE id = p_pago_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cobranza_confirmar: pago % no encontrado', p_pago_id;
  END IF;
  IF v_pago.estado IN ('anulado', 'rechazado') THEN
    RAISE EXCEPTION 'cobranza_confirmar: no se puede confirmar un pago en estado %', v_pago.estado;
  END IF;

  v_ya_confirmado := (v_pago.estado = 'confirmado');

  -- ── 1. Imputaciones pendientes → saldo de comprobantes ──
  FOR v_imp IN
    SELECT id, comprobante_id, monto_imputado
    FROM imputaciones
    WHERE pago_id = p_pago_id
      AND estado NOT IN ('confirmado', 'anulado')
      AND comprobante_id IS NOT NULL
    ORDER BY created_at
  LOOP
    SELECT id, saldo_pendiente, total_factura INTO v_comp
    FROM comprobantes_venta WHERE id = v_imp.comprobante_id FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;

    v_nuevo_saldo := GREATEST(0, COALESCE(v_comp.saldo_pendiente, 0) - COALESCE(v_imp.monto_imputado, 0));
    v_estado_pago := CASE WHEN v_nuevo_saldo <= 0 THEN 'pagado' ELSE 'parcial' END;

    UPDATE comprobantes_venta
    SET saldo_pendiente = v_nuevo_saldo, estado_pago = v_estado_pago
    WHERE id = v_imp.comprobante_id;

    UPDATE imputaciones SET estado = 'confirmado' WHERE id = v_imp.id;

    IF v_estado_pago = 'pagado' THEN
      v_paid_ids := array_append(v_paid_ids, v_imp.comprobante_id);
    END IF;
  END LOOP;

  -- ── 2. Libro mayor: haber del pago (guard) ──
  IF NOT EXISTS (
    SELECT 1 FROM cuenta_corriente_clientes
    WHERE referencia_tipo = 'pago_cliente' AND referencia_id = p_pago_id
  ) THEN
    PERFORM cc_postear(
      v_pago.cliente_id, 'pago',
      0, abs(v_pago.monto),
      'pago_cliente', p_pago_id,
      NULL, COALESCE(v_pago.observaciones, 'Pago'), p_usuario_id
    );
  END IF;

  -- ── 3. Recibo numerado (guard + FOR UPDATE) ──
  SELECT id, numero_recibo INTO v_recibo_id, v_numero_recibo
  FROM recibos WHERE pago_id = p_pago_id LIMIT 1;

  IF v_recibo_id IS NULL THEN
    SELECT ultimo_numero + 1 INTO v_siguiente
    FROM numeracion_comprobantes
    WHERE tipo_comprobante = 'RECIBO' AND punto_venta = '0001'
    FOR UPDATE;

    IF v_siguiente IS NULL THEN
      v_siguiente := 1;
      INSERT INTO numeracion_comprobantes (tipo_comprobante, punto_venta, ultimo_numero)
      VALUES ('RECIBO', '0001', 1);
    ELSE
      UPDATE numeracion_comprobantes SET ultimo_numero = v_siguiente
      WHERE tipo_comprobante = 'RECIBO' AND punto_venta = '0001';
    END IF;

    v_numero_recibo := 'REC-0001-' || lpad(v_siguiente::text, 8, '0');

    INSERT INTO recibos (numero_recibo, pago_id, cliente_id, fecha, monto_total, generado_por)
    VALUES (v_numero_recibo, p_pago_id, v_pago.cliente_id,
            COALESCE(v_pago.fecha_pago, v_hoy_ar), v_pago.monto, p_usuario_id)
    RETURNING id INTO v_recibo_id;
  END IF;

  -- ── 4. Kardex + saldos + cheques, una línea por método (guard) ──
  IF NOT EXISTS (
    SELECT 1 FROM kardex_contable
    WHERE referencia_tipo = 'pago_cliente' AND referencia_id = p_pago_id
  ) THEN
    SELECT id INTO v_caja_default FROM cajas_financieras WHERE nombre = 'Caja Chica' LIMIT 1;

    FOR v_det IN
      SELECT id, tipo_pago, monto, caja_id, cuenta_bancaria_id, color_cheque,
             numero_cheque, banco, fecha_cheque, cuit_emisor, cheque_id
      FROM pagos_detalle WHERE pago_id = p_pago_id
    LOOP
      v_cheque_id := v_det.cheque_id;

      -- Cheque sin registro en cartera → crearlo (antes solo lo hacía el chofer)
      IF v_det.tipo_pago = 'cheque' AND v_cheque_id IS NULL THEN
        INSERT INTO cheques (
          tipo, estado, banco, numero, fecha_emision, fecha_vencimiento,
          monto, color, cliente_origen_id
        ) VALUES (
          'TERCERO', 'EN_CARTERA',
          COALESCE(v_det.banco, 'S/D'), COALESCE(v_det.numero_cheque, 'S/N'),
          v_hoy_ar, COALESCE(v_det.fecha_cheque, v_hoy_ar + 30),
          v_det.monto, COALESCE(v_det.color_cheque, 'BLANCO')::money_color,
          v_pago.cliente_id
        ) RETURNING id INTO v_cheque_id;
        UPDATE pagos_detalle SET cheque_id = v_cheque_id WHERE id = v_det.id;
      END IF;

      v_destino_tipo := CASE WHEN v_det.tipo_pago IN ('cheque', 'deposito') THEN 'EN_CARTERA'
                             WHEN v_det.tipo_pago = 'efectivo' THEN 'CAJA'
                             ELSE 'BANCO' END;
      v_destino_id   := CASE WHEN v_det.tipo_pago = 'efectivo' THEN COALESCE(v_det.caja_id, v_caja_default)
                             WHEN v_det.tipo_pago IN ('transferencia', 'deposito') THEN v_det.cuenta_bancaria_id
                             ELSE NULL END;

      PERFORM kardex_registrar(
        p_tipo_movimiento => 'COBRO_CLIENTE',
        p_concepto        => 'Cobro ' || COALESCE(v_numero_recibo, '') || ' — ' || upper(COALESCE(v_det.tipo_pago, '')),
        p_monto           => v_det.monto,
        p_color           => v_det.color_cheque,
        p_origen_tipo     => 'CLIENTE',
        p_origen_id       => v_pago.cliente_id,
        p_destino_tipo    => v_destino_tipo,
        p_destino_id      => v_destino_id,
        p_metodo          => CASE WHEN v_det.tipo_pago = 'cheque' THEN 'CHEQUE_TERCERO'
                                  WHEN v_det.tipo_pago = 'transferencia' THEN 'TRANSFERENCIA'
                                  WHEN v_det.tipo_pago = 'deposito' THEN 'DEPOSITO'
                                  ELSE 'EFECTIVO' END,
        p_referencia_tipo => 'pago_cliente',
        p_referencia_id   => p_pago_id,
        p_pago_id         => p_pago_id,
        p_recibo_id       => v_recibo_id,
        p_cheque_id       => v_cheque_id,
        p_cliente_id      => v_pago.cliente_id,
        p_viaje_id        => v_pago.viaje_id,
        p_cobrador_id     => p_usuario_id,
        p_usuario_id      => p_usuario_id
      );
    END LOOP;

    -- Retenciones: activo fiscal a recuperar (sin saldo de fondos)
    SELECT COALESCE(sum(monto), 0) INTO v_total_ret
    FROM retenciones WHERE pago_id = p_pago_id;
    IF v_total_ret > 0 THEN
      PERFORM kardex_registrar(
        p_tipo_movimiento => 'COBRO_CLIENTE',
        p_concepto        => 'Retenciones ' || COALESCE(v_numero_recibo, ''),
        p_monto           => v_total_ret,
        p_origen_tipo     => 'CLIENTE',
        p_origen_id       => v_pago.cliente_id,
        p_destino_tipo    => 'RETENCIONES',
        p_metodo          => 'RETENCION',
        p_referencia_tipo => 'pago_cliente',
        p_referencia_id   => p_pago_id,
        p_pago_id         => p_pago_id,
        p_recibo_id       => v_recibo_id,
        p_cliente_id      => v_pago.cliente_id,
        p_cobrador_id     => p_usuario_id,
        p_usuario_id      => p_usuario_id
      );
    END IF;
  END IF;

  -- ── 5. Pago → confirmado ──
  IF NOT v_ya_confirmado THEN
    UPDATE pagos_clientes
    SET estado = 'confirmado',
        confirmado_por = p_usuario_id::text,
        fecha_confirmacion = now()
    WHERE id = p_pago_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'ya_confirmado', v_ya_confirmado,
    'recibo_id', v_recibo_id,
    'numero_recibo', v_numero_recibo,
    'paid_comprobante_ids', to_jsonb(v_paid_ids)
  );
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 5. cobranza_anular v2 — reversa también los SALDOS de cajas/bancos
--    (reemplaza la versión de A1: ahora que confirmar mueve saldos vía
--    kardex_registrar, anular debe devolver la plata de cada cuenta.
--    Se reversa línea por línea el kardex original del pago.)
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.cobranza_anular(
  p_pago_id    uuid,
  p_usuario_id uuid,
  p_motivo     text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pago              pagos_clientes%ROWTYPE;
  v_estaba_confirmado boolean;
  v_imp               record;
  v_comp              record;
  v_total_fact        numeric;
  v_nuevo_saldo       numeric;
  v_nuevo_estado      text;
  v_comprobante_ids   uuid[];
  v_cobro_billetera   record;
  v_kx                record;
BEGIN
  SELECT * INTO v_pago FROM pagos_clientes WHERE id = p_pago_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cobranza_anular: pago % no encontrado', p_pago_id;
  END IF;
  IF v_pago.estado = 'anulado' THEN
    RETURN jsonb_build_object('success', true, 'ya_anulado', true);
  END IF;

  v_estaba_confirmado := (v_pago.estado = 'confirmado');

  SELECT array_agg(DISTINCT comprobante_id) INTO v_comprobante_ids
  FROM imputaciones WHERE pago_id = p_pago_id AND comprobante_id IS NOT NULL;

  -- ── 1. Restaurar saldos de comprobantes (solo imputaciones confirmadas) ──
  FOR v_imp IN
    SELECT id, comprobante_id, monto_imputado, estado
    FROM imputaciones
    WHERE pago_id = p_pago_id AND comprobante_id IS NOT NULL
  LOOP
    SELECT id, tipo_comprobante, observaciones, saldo_pendiente, total_factura
    INTO v_comp FROM comprobantes_venta WHERE id = v_imp.comprobante_id FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;

    IF v_comp.tipo_comprobante IN ('REV', 'NCA', 'NCB', 'NCC')
       AND lower(COALESCE(v_comp.observaciones, '')) LIKE '%bonificaci%' THEN
      UPDATE comprobantes_venta
      SET estado_pago = 'anulado', saldo_pendiente = 0
      WHERE id = v_comp.id;
    ELSIF v_imp.estado = 'confirmado' THEN
      v_total_fact  := abs(COALESCE(v_comp.total_factura, 0));
      v_nuevo_saldo := LEAST(v_total_fact, COALESCE(v_comp.saldo_pendiente, 0) + abs(COALESCE(v_imp.monto_imputado, 0)));
      v_nuevo_estado := CASE
        WHEN v_nuevo_saldo <= 0 THEN 'pagado'
        WHEN v_nuevo_saldo >= v_total_fact THEN 'pendiente'
        ELSE 'parcial' END;
      UPDATE comprobantes_venta
      SET saldo_pendiente = v_nuevo_saldo, estado_pago = v_nuevo_estado
      WHERE id = v_comp.id;
    END IF;
  END LOOP;

  -- ── 2. Imputaciones → anuladas ──
  UPDATE imputaciones SET estado = 'anulado' WHERE pago_id = p_pago_id;

  -- ── 3. Recibo → anulado ──
  UPDATE recibos
  SET estado = 'anulado', anulado_at = now(), anulado_por = p_usuario_id
  WHERE pago_id = p_pago_id;

  -- ── 4. Cheques del pago EN_CARTERA → ANULADO ──
  UPDATE cheques SET estado = 'ANULADO'
  WHERE estado = 'EN_CARTERA'
    AND id IN (
      SELECT cheque_id FROM pagos_detalle WHERE pago_id = p_pago_id AND cheque_id IS NOT NULL
      UNION
      SELECT pdi.cheque_id
      FROM pago_deposito_items pdi
      JOIN pagos_detalle pd ON pd.id = pdi.pago_detalle_id
      WHERE pd.pago_id = p_pago_id AND pdi.cheque_id IS NOT NULL
    );

  -- ── 5. Libro mayor: contrapartida (guard) ──
  IF v_estaba_confirmado AND NOT EXISTS (
    SELECT 1 FROM cuenta_corriente_clientes
    WHERE referencia_tipo = 'pago_anulacion' AND referencia_id = p_pago_id
  ) THEN
    PERFORM cc_postear(
      v_pago.cliente_id, 'ajuste',
      abs(v_pago.monto), 0,
      'pago_anulacion', p_pago_id,
      NULL,
      'Anulación de pago' || CASE WHEN p_motivo IS NOT NULL AND p_motivo <> '' THEN ' — ' || p_motivo ELSE '' END,
      p_usuario_id
    );
  END IF;

  -- ── 6. Kardex + saldos: reversa línea por línea del kardex original (guard) ──
  IF NOT EXISTS (
    SELECT 1 FROM kardex_contable
    WHERE tipo_movimiento = 'ANULACION_COBRO'
      AND referencia_tipo = 'pago_anulacion' AND referencia_id = p_pago_id
  ) THEN
    FOR v_kx IN
      SELECT id, monto, color, origen_tipo, origen_id, destino_tipo, destino_id, metodo, cheque_id
      FROM kardex_contable
      WHERE tipo_movimiento = 'COBRO_CLIENTE'
        AND referencia_tipo = 'pago_cliente'
        AND referencia_id = p_pago_id
        AND kardex_reversa_de IS NULL
    LOOP
      -- la plata vuelve a salir de donde había entrado
      PERFORM kardex_registrar(
        p_tipo_movimiento => 'ANULACION_COBRO',
        p_concepto        => 'Anulación pago ' || left(p_pago_id::text, 8)
                             || CASE WHEN p_motivo IS NOT NULL AND p_motivo <> '' THEN ' — ' || p_motivo ELSE '' END,
        p_monto           => v_kx.monto,
        p_color           => v_kx.color,
        p_origen_tipo     => v_kx.destino_tipo,
        p_origen_id       => v_kx.destino_id,
        p_destino_tipo    => 'CLIENTE',
        p_destino_id      => v_pago.cliente_id,
        p_metodo          => v_kx.metodo,
        p_referencia_tipo => 'pago_anulacion',
        p_referencia_id   => p_pago_id,
        p_pago_id         => p_pago_id,
        p_cheque_id       => v_kx.cheque_id,
        p_cliente_id      => v_pago.cliente_id,
        p_cobrador_id     => p_usuario_id,
        p_usuario_id      => p_usuario_id,
        p_reversa_de      => v_kx.id
      );
    END LOOP;

    -- pago sin kardex previo (nunca confirmado): línea informativa única
    IF NOT FOUND THEN
      INSERT INTO kardex_contable (
        tipo_movimiento, concepto, monto, origen_tipo, origen_id,
        referencia_tipo, referencia_id, pago_id, cliente_id, cobrador_id
      )
      SELECT 'ANULACION_COBRO',
             'Anulación pago ' || left(p_pago_id::text, 8)
               || CASE WHEN p_motivo IS NOT NULL AND p_motivo <> '' THEN ' — ' || p_motivo ELSE '' END,
             -abs(v_pago.monto), 'CLIENTE', v_pago.cliente_id,
             'pago_anulacion', p_pago_id, p_pago_id, v_pago.cliente_id, p_usuario_id
      WHERE NOT EXISTS (
        SELECT 1 FROM kardex_contable
        WHERE tipo_movimiento = 'COBRO_CLIENTE'
          AND referencia_tipo = 'pago_cliente' AND referencia_id = p_pago_id
      );
    END IF;
  END IF;

  -- ── 7. Comisiones 'cobrada' de los comprobantes de este pago ──
  IF v_comprobante_ids IS NOT NULL THEN
    DELETE FROM comisiones
    WHERE tipo = 'cobrada'
      AND pagado = false
      AND comprobante_venta_id = ANY (v_comprobante_ids);

    INSERT INTO comisiones (
      viajante_id, pedido_id, comprobante_venta_id, tipo, articulo_id, segmento,
      cantidad, precio_neto_unitario, porcentaje, monto,
      comprobante_cobrado, pagado, motivo
    )
    SELECT viajante_id, pedido_id, comprobante_venta_id, 'cobrada', articulo_id, segmento,
           cantidad, precio_neto_unitario, porcentaje, -monto,
           false, false, 'Reversa por anulación de pago ' || left(p_pago_id::text, 8)
    FROM comisiones c
    WHERE c.tipo = 'cobrada'
      AND c.pagado = true
      AND c.comprobante_venta_id = ANY (v_comprobante_ids)
      AND c.monto <> 0
      AND NOT EXISTS (
        SELECT 1 FROM comisiones r
        WHERE r.tipo = 'cobrada'
          AND r.comprobante_venta_id = c.comprobante_venta_id
          AND r.motivo = 'Reversa por anulación de pago ' || left(p_pago_id::text, 8)
      );

    UPDATE comisiones
    SET comprobante_cobrado = false, fecha_comprobante_cobrado = NULL
    WHERE tipo = 'vendida'
      AND comprobante_venta_id = ANY (v_comprobante_ids)
      AND comprobante_venta_id IN (
        SELECT id FROM comprobantes_venta WHERE estado_pago <> 'pagado'
      );
  END IF;

  -- ── 8. Billetera: débito compensatorio del cobro (guard) ──
  FOR v_cobro_billetera IN
    SELECT viajante_id, sum(monto) AS total
    FROM billetera_movimientos
    WHERE tipo = 'cobro_cliente'
      AND referencia_tipo = 'pago_cliente'
      AND referencia_id = p_pago_id
    GROUP BY viajante_id
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM billetera_movimientos
      WHERE tipo = 'debito'
        AND referencia_tipo = 'pago_anulacion'
        AND referencia_id = p_pago_id
        AND viajante_id = v_cobro_billetera.viajante_id
    ) THEN
      INSERT INTO billetera_movimientos (
        viajante_id, tipo, monto, concepto, referencia_id, referencia_tipo, fecha, creado_por
      ) VALUES (
        v_cobro_billetera.viajante_id, 'debito', -abs(v_cobro_billetera.total),
        'Reversa por anulación de pago ' || left(p_pago_id::text, 8),
        p_pago_id, 'pago_anulacion', now(), p_usuario_id
      );
    END IF;
  END LOOP;

  -- ── 9. Pago → anulado ──
  UPDATE pagos_clientes
  SET estado = 'anulado',
      anulado_por = p_usuario_id,
      anulado_at = now(),
      motivo_anulacion = NULLIF(p_motivo, '')
  WHERE id = p_pago_id;

  RETURN jsonb_build_object(
    'success', true,
    'ya_anulado', false,
    'estaba_confirmado', v_estaba_confirmado
  );
END;
$$;
