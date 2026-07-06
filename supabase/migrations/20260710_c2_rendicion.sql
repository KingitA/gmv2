-- ─────────────────────────────────────────────────────────────────────────────
-- FASE C2 — Billeteras integradas + rendición con conciliación por pago
-- (REQUIERE C1 aplicada)
--
-- Modelo:
--   · La billetera de un cobrador (chofer/viajante) es la plata física en la
--     calle. Su saldo en saldos_financieros (BILLETERA, cobrador_id, BLANCO)
--     lo mantiene EXCLUSIVAMENTE un trigger sobre billetera_movimientos:
--     cualquier inserción (cobro, gasto, retiro, débito de rendición,
--     reversa de anulación) actualiza el saldo — venga del RPC o del TS.
--   · kardex_registrar (v3 acá) DEJA de tocar saldos BILLETERA para no
--     duplicar con el trigger (sigue tocando CAJA/BANCO/INVERSION).
--   · Rendición: cabecera `rendiciones` + `rendicion_items` (un pago por
--     fila, checklist). rendicion_confirmar():
--       - confirma cada pago (cobranza_confirmar) con firma 2 = confirmador
--         y método 'rendicion',
--       - debita la billetera por cada pago (trigger actualiza saldo),
--       - el efectivo DECLARADO entra a la caja elegida con kardex
--         RENDICION_VIAJE; los cheques ya quedaron EN_CARTERA; las
--         transferencias van a conciliación (C3),
--       - diferencia declarado vs registrado ≠ 0 exige p_forzar_diferencia
--         y queda documentada con kardex AJUSTE_CAJA,
--       - si el viaje quedó sin pagos pendientes → viaje 'completado'.
--   · Backfill: saldos de billetera desde billetera_movimientos existentes.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════
-- 1. Trigger: billetera_movimientos → saldos_financieros (BILLETERA)
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.billetera_saldo_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO saldos_financieros (cuenta_tipo, cuenta_id, color, saldo)
  VALUES ('BILLETERA', NEW.viajante_id, 'BLANCO', COALESCE(NEW.monto, 0))
  ON CONFLICT (cuenta_tipo, cuenta_id, color)
  DO UPDATE SET saldo = saldos_financieros.saldo + COALESCE(NEW.monto, 0), updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_billetera_saldo_sync ON public.billetera_movimientos;
CREATE TRIGGER trg_billetera_saldo_sync
AFTER INSERT ON public.billetera_movimientos
FOR EACH ROW EXECUTE FUNCTION public.billetera_saldo_sync();

-- Backfill: saldo = Σ movimientos históricos por cobrador
INSERT INTO saldos_financieros (cuenta_tipo, cuenta_id, color, saldo)
SELECT 'BILLETERA', viajante_id, 'BLANCO', COALESCE(sum(monto), 0)
FROM billetera_movimientos
GROUP BY viajante_id
ON CONFLICT (cuenta_tipo, cuenta_id, color)
DO UPDATE SET saldo = EXCLUDED.saldo, updated_at = now();

-- ═════════════════════════════════════════════════════════════════════════
-- 2. kardex_registrar v3 — BILLETERA fuera de los upserts de saldo
--    (el trigger de billetera_movimientos es el único dueño de ese saldo)
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
  v_es_fondo_origen  boolean := p_origen_tipo IN ('CAJA', 'BANCO', 'INVERSION') AND p_origen_id IS NOT NULL;
  v_es_fondo_destino boolean := p_destino_tipo IN ('CAJA', 'BANCO', 'INVERSION') AND p_destino_id IS NOT NULL;
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
-- 3. Rendiciones
-- ═════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.rendiciones (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  viaje_id            uuid,                       -- NULL para viajantes sin viaje
  cobrador_id         uuid NOT NULL,              -- identidad de la billetera
  cobrador_tipo       varchar(20) NOT NULL CHECK (cobrador_tipo IN ('chofer', 'viajante')),
  fecha               timestamptz NOT NULL DEFAULT now(),
  efectivo_declarado  numeric(14,2) NOT NULL DEFAULT 0,
  efectivo_registrado numeric(14,2) NOT NULL DEFAULT 0,
  diferencia          numeric(14,2) NOT NULL DEFAULT 0,
  caja_destino_tipo   varchar(10),
  caja_destino_id     uuid,
  estado              varchar(20) NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'confirmada', 'cancelada')),
  observaciones       text,
  creado_por          uuid,
  confirmado_por      uuid,
  confirmado_at       timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rendicion_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rendicion_id  uuid NOT NULL REFERENCES rendiciones(id) ON DELETE CASCADE,
  pago_id       uuid NOT NULL REFERENCES pagos_clientes(id),
  verificado    boolean NOT NULL DEFAULT true,
  observacion   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rendicion_id, pago_id)
);

ALTER TABLE public.rendiciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rendicion_items ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  CREATE POLICY "rendiciones_auth_all" ON public.rendiciones
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  CREATE POLICY "rendicion_items_auth_all" ON public.rendicion_items
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_rendiciones_estado ON public.rendiciones (estado, cobrador_id);
CREATE INDEX IF NOT EXISTS idx_rendicion_items_pago ON public.rendicion_items (pago_id);

-- ═════════════════════════════════════════════════════════════════════════
-- 4. rendicion_crear — abre la rendición con su checklist de pagos
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.rendicion_crear(
  p_cobrador_id        uuid,
  p_cobrador_tipo      text,
  p_pago_ids           uuid[],
  p_efectivo_declarado numeric,
  p_viaje_id           uuid DEFAULT NULL,
  p_observaciones      text DEFAULT NULL,
  p_usuario_id         uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rendicion_id uuid;
  v_pago_ids     uuid[];
  v_registrado   numeric;
BEGIN
  -- pagos elegibles: pendiente_rendicion, sin rendición abierta previa
  SELECT array_agg(p.id) INTO v_pago_ids
  FROM pagos_clientes p
  WHERE p.id = ANY (p_pago_ids)
    AND p.estado = 'pendiente_rendicion'
    AND NOT EXISTS (
      SELECT 1 FROM rendicion_items ri
      JOIN rendiciones r ON r.id = ri.rendicion_id
      WHERE ri.pago_id = p.id AND r.estado = 'abierta'
    );

  IF v_pago_ids IS NULL OR array_length(v_pago_ids, 1) = 0 THEN
    RAISE EXCEPTION 'rendicion_crear: ningún pago elegible (deben estar pendiente_rendicion y sin rendición abierta)';
  END IF;

  -- efectivo registrado según los detalles de esos pagos
  SELECT COALESCE(sum(pd.monto), 0) INTO v_registrado
  FROM pagos_detalle pd
  WHERE pd.pago_id = ANY (v_pago_ids) AND pd.tipo_pago = 'efectivo';

  INSERT INTO rendiciones (
    viaje_id, cobrador_id, cobrador_tipo,
    efectivo_declarado, efectivo_registrado, diferencia,
    observaciones, creado_por
  ) VALUES (
    p_viaje_id, p_cobrador_id, p_cobrador_tipo,
    COALESCE(p_efectivo_declarado, 0), v_registrado,
    COALESCE(p_efectivo_declarado, 0) - v_registrado,
    p_observaciones, p_usuario_id
  ) RETURNING id INTO v_rendicion_id;

  INSERT INTO rendicion_items (rendicion_id, pago_id)
  SELECT v_rendicion_id, unnest(v_pago_ids);

  RETURN jsonb_build_object(
    'success', true,
    'rendicion_id', v_rendicion_id,
    'cantidad_pagos', array_length(v_pago_ids, 1),
    'efectivo_registrado', v_registrado,
    'efectivo_declarado', COALESCE(p_efectivo_declarado, 0),
    'diferencia', COALESCE(p_efectivo_declarado, 0) - v_registrado
  );
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 5. rendicion_confirmar — la segunda firma en lote, con plata a caja
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.rendicion_confirmar(
  p_rendicion_id       uuid,
  p_caja_destino_tipo  text,      -- CAJA (chica o grande)
  p_caja_destino_id    uuid,
  p_usuario_id         uuid,
  p_pagos_verificados  uuid[] DEFAULT NULL,  -- NULL = todos los items
  p_efectivo_declarado numeric DEFAULT NULL, -- recontar al confirmar (opcional)
  p_forzar_diferencia  boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rend        rendiciones%ROWTYPE;
  v_item        record;
  v_pago        record;
  v_confirmados int := 0;
  v_omitidos    int := 0;
  v_registrado  numeric := 0;
  v_declarado   numeric;
  v_diferencia  numeric;
BEGIN
  SELECT * INTO v_rend FROM rendiciones WHERE id = p_rendicion_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'rendicion_confirmar: rendición % no encontrada', p_rendicion_id;
  END IF;
  IF v_rend.estado <> 'abierta' THEN
    RAISE EXCEPTION 'rendicion_confirmar: la rendición está % (se requiere abierta)', v_rend.estado;
  END IF;
  IF p_caja_destino_tipo NOT IN ('CAJA', 'BANCO') OR p_caja_destino_id IS NULL THEN
    RAISE EXCEPTION 'rendicion_confirmar: caja destino inválida';
  END IF;

  -- Marcar checklist
  IF p_pagos_verificados IS NOT NULL THEN
    UPDATE rendicion_items SET verificado = (pago_id = ANY (p_pagos_verificados))
    WHERE rendicion_id = p_rendicion_id;
  END IF;

  -- Confirmar pago por pago (cada uno atómico dentro de esta transacción)
  FOR v_item IN
    SELECT ri.pago_id, ri.verificado FROM rendicion_items ri
    WHERE ri.rendicion_id = p_rendicion_id
  LOOP
    IF NOT v_item.verificado THEN
      v_omitidos := v_omitidos + 1;
      CONTINUE;
    END IF;

    SELECT id, estado, monto INTO v_pago FROM pagos_clientes WHERE id = v_item.pago_id FOR UPDATE;
    IF v_pago.estado NOT IN ('pendiente_rendicion', 'pendiente') THEN
      v_omitidos := v_omitidos + 1;
      CONTINUE;
    END IF;

    PERFORM cobranza_confirmar(v_item.pago_id, p_usuario_id);

    UPDATE pagos_clientes
    SET verificacion_metodo = 'rendicion'
    WHERE id = v_item.pago_id AND verificado_por IS NOT NULL;

    -- Débito de billetera (el trigger actualiza el saldo)
    IF NOT EXISTS (
      SELECT 1 FROM billetera_movimientos
      WHERE tipo = 'debito' AND referencia_tipo = 'rendicion' AND referencia_id = v_item.pago_id
    ) THEN
      INSERT INTO billetera_movimientos (
        viajante_id, tipo, monto, concepto, referencia_id, referencia_tipo, fecha, creado_por
      ) VALUES (
        v_rend.cobrador_id, 'debito', -abs(v_pago.monto),
        'Rendición ' || left(p_rendicion_id::text, 8),
        v_item.pago_id, 'rendicion', now(), p_usuario_id
      );
    END IF;

    SELECT v_registrado + COALESCE(sum(pd.monto), 0) INTO v_registrado
    FROM pagos_detalle pd WHERE pd.pago_id = v_item.pago_id AND pd.tipo_pago = 'efectivo';

    v_confirmados := v_confirmados + 1;
  END LOOP;

  IF v_confirmados = 0 THEN
    RAISE EXCEPTION 'rendicion_confirmar: ningún pago verificado para confirmar';
  END IF;

  v_declarado  := COALESCE(p_efectivo_declarado, v_rend.efectivo_declarado);
  v_diferencia := v_declarado - v_registrado;

  IF abs(v_diferencia) > 0.01 AND NOT p_forzar_diferencia THEN
    RAISE EXCEPTION 'rendicion_confirmar: diferencia de efectivo $% (declarado % vs registrado %) — confirmar con p_forzar_diferencia=true',
      v_diferencia, v_declarado, v_registrado;
  END IF;

  -- Efectivo físico entra a la caja elegida
  IF v_declarado > 0 THEN
    PERFORM kardex_registrar(
      p_tipo_movimiento => 'RENDICION_VIAJE',
      p_concepto        => 'Rendición ' || v_rend.cobrador_tipo || ' ' || left(p_rendicion_id::text, 8)
                           || CASE WHEN v_rend.viaje_id IS NOT NULL THEN ' (viaje ' || left(v_rend.viaje_id::text, 8) || ')' ELSE '' END,
      p_monto           => v_declarado,
      p_color           => 'BLANCO',
      p_origen_tipo     => 'BILLETERA',
      p_origen_id       => v_rend.cobrador_id,
      p_destino_tipo    => p_caja_destino_tipo,
      p_destino_id      => p_caja_destino_id,
      p_metodo          => 'EFECTIVO',
      p_referencia_tipo => 'rendicion',
      p_referencia_id   => p_rendicion_id,
      p_viaje_id        => v_rend.viaje_id,
      p_cobrador_id     => v_rend.cobrador_id,
      p_usuario_id      => p_usuario_id,
      p_verificado      => true
    );
  END IF;

  -- Diferencia documentada en el ledger
  IF abs(v_diferencia) > 0.01 THEN
    INSERT INTO kardex_contable (
      tipo_movimiento, concepto, monto, origen_tipo, origen_id,
      destino_tipo, referencia_tipo, referencia_id, viaje_id, cobrador_id, verificado, verificado_por, verificado_at
    ) VALUES (
      'AJUSTE_CAJA',
      'Diferencia rendición ' || left(p_rendicion_id::text, 8)
        || ' (declarado $' || v_declarado || ' vs registrado $' || v_registrado || ')',
      v_diferencia, 'BILLETERA', v_rend.cobrador_id,
      'GASTO', 'rendicion', p_rendicion_id, v_rend.viaje_id, v_rend.cobrador_id, true, p_usuario_id, now()
    );
  END IF;

  UPDATE rendiciones
  SET estado = 'confirmada',
      efectivo_declarado = v_declarado,
      efectivo_registrado = v_registrado,
      diferencia = v_diferencia,
      caja_destino_tipo = p_caja_destino_tipo,
      caja_destino_id = p_caja_destino_id,
      confirmado_por = p_usuario_id,
      confirmado_at = now()
  WHERE id = p_rendicion_id;

  -- Cerrar el viaje si no le quedan pagos sin rendir
  IF v_rend.viaje_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pagos_clientes
    WHERE viaje_id = v_rend.viaje_id AND estado = 'pendiente_rendicion'
  ) THEN
    UPDATE viajes SET estado = 'completado' WHERE id = v_rend.viaje_id AND estado = 'en_rendicion';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'confirmados', v_confirmados,
    'omitidos', v_omitidos,
    'efectivo_a_caja', v_declarado,
    'diferencia', v_diferencia
  );
END;
$$;

-- ── Permisos ──
REVOKE ALL ON FUNCTION public.rendicion_crear FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rendicion_confirmar FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rendicion_crear TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rendicion_confirmar TO authenticated, service_role;
