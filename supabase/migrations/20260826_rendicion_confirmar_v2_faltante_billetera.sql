-- ============================================================================
-- rendicion_confirmar v2 — la billetera del cobrador es una CUENTA CORRIENTE
-- ============================================================================
-- Regla (26/08/2026): si el vendedor cobró $100 y entrega $90, sigue debiendo
-- $10. Antes, al confirmar con diferencia, la billetera se debitaba por el
-- total cobrado (quedaba en $0) y el faltante se registraba como
-- "AJUSTE_CAJA → GASTO": la empresa lo absorbía con rastro pero sin reclamo.
--
-- Ahora:
--   · la billetera se debita por cada pago (igual que antes) y, si hay
--     diferencia, se asienta un movimiento inverso por el faltante/sobrante:
--     el saldo de la billetera queda = lo que el cobrador todavía debe
--     (o lo que se le debe a él, si entregó de más).
--   · la línea del kardex contable se conserva para auditoría pero deja de
--     ir a GASTO: destino BILLETERA, concepto "Faltante/Sobrante rendición".
--   · a la caja entra lo CONTADO por oficina (efectivo_declarado), como antes.
--
-- Se mantiene la firma y todo el resto del comportamiento (verificados,
-- transferencias a conciliar, viaje completado, etc.).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rendicion_confirmar(
  p_rendicion_id uuid,
  p_caja_destino_tipo text,
  p_caja_destino_id uuid,
  p_usuario_id uuid,
  p_pagos_verificados uuid[] DEFAULT NULL::uuid[],
  p_efectivo_declarado numeric DEFAULT NULL::numeric,
  p_forzar_diferencia boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rend        rendiciones%ROWTYPE;
  v_item        record;
  v_pago        record;
  v_confirmados int := 0;
  v_omitidos    int := 0;
  v_a_conciliar int := 0;
  v_registrado  numeric := 0;
  v_declarado   numeric;
  v_diferencia  numeric;
  v_solo_transferencia boolean;
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

  IF p_pagos_verificados IS NOT NULL THEN
    UPDATE rendicion_items SET verificado = (pago_id = ANY (p_pagos_verificados))
    WHERE rendicion_id = p_rendicion_id;
  END IF;

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

    -- ¿El pago es SOLO transferencia/depósito? → verificación por conciliación
    SELECT NOT EXISTS (
      SELECT 1 FROM pagos_detalle
      WHERE pago_id = v_item.pago_id AND tipo_pago NOT IN ('transferencia', 'deposito')
    ) AND EXISTS (SELECT 1 FROM pagos_detalle WHERE pago_id = v_item.pago_id)
    INTO v_solo_transferencia;

    IF v_solo_transferencia THEN
      UPDATE pagos_clientes
      SET verificado_por = NULL, verificado_at = NULL, verificacion_metodo = NULL
      WHERE id = v_item.pago_id;
      UPDATE kardex_contable
      SET verificado = false, verificado_por = NULL, verificado_at = NULL
      WHERE pago_id = v_item.pago_id AND tipo_movimiento = 'COBRO_CLIENTE';
      v_a_conciliar := v_a_conciliar + 1;
    ELSE
      UPDATE pagos_clientes
      SET verificacion_metodo = 'rendicion'
      WHERE id = v_item.pago_id AND verificado_por IS NOT NULL;
    END IF;

    -- Débito de billetera por el pago (el trigger actualiza el saldo)
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
  v_diferencia := v_declarado - v_registrado;   -- < 0 = faltante, > 0 = sobrante

  IF abs(v_diferencia) > 0.01 AND NOT p_forzar_diferencia THEN
    RAISE EXCEPTION 'rendicion_confirmar: diferencia de efectivo $% (declarado % vs registrado %) — confirmar con p_forzar_diferencia=true',
      v_diferencia, v_declarado, v_registrado;
  END IF;

  -- A la caja entra lo que oficina CONTÓ
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

  -- Diferencia: queda en la BILLETERA del cobrador (cuenta corriente), no en gasto.
  --   faltante (diferencia < 0): movimiento +|dif| → el cobrador sigue debiendo eso.
  --   sobrante (diferencia > 0): movimiento −dif   → se le debe a él.
  IF abs(v_diferencia) > 0.01 THEN
    IF NOT EXISTS (
      SELECT 1 FROM billetera_movimientos
      WHERE referencia_tipo = 'rendicion_diferencia' AND referencia_id = p_rendicion_id
    ) THEN
      INSERT INTO billetera_movimientos (
        viajante_id, tipo, medio, monto, concepto, referencia_id, referencia_tipo, fecha, creado_por
      ) VALUES (
        v_rend.cobrador_id,
        CASE WHEN v_diferencia < 0 THEN 'debito' ELSE 'credito' END,
        'efectivo',
        -v_diferencia,
        CASE WHEN v_diferencia < 0
          THEN 'Faltante rendición ' || left(p_rendicion_id::text, 8) || ': entregó $' || v_declarado || ' de $' || v_registrado || ' cobrados — sigue debiendo $' || abs(v_diferencia)
          ELSE 'Sobrante rendición ' || left(p_rendicion_id::text, 8) || ': entregó $' || v_declarado || ' de $' || v_registrado || ' cobrados — se le deben $' || v_diferencia
        END,
        p_rendicion_id, 'rendicion_diferencia', now(), p_usuario_id
      );
    END IF;

    -- Rastro contable (no mueve fondos: BILLETERA no es CAJA/BANCO)
    INSERT INTO kardex_contable (
      tipo_movimiento, concepto, monto, origen_tipo, origen_id,
      destino_tipo, destino_id, referencia_tipo, referencia_id, viaje_id, cobrador_id, verificado, verificado_por, verificado_at
    ) VALUES (
      'AJUSTE_CAJA',
      CASE WHEN v_diferencia < 0 THEN 'Faltante' ELSE 'Sobrante' END
        || ' rendición ' || left(p_rendicion_id::text, 8)
        || ' (contado $' || v_declarado || ' vs cobrado $' || v_registrado || ') — queda en billetera del cobrador',
      v_diferencia, 'BILLETERA', v_rend.cobrador_id,
      'BILLETERA', v_rend.cobrador_id, 'rendicion', p_rendicion_id, v_rend.viaje_id, v_rend.cobrador_id, true, p_usuario_id, now()
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
    'a_conciliar', v_a_conciliar,
    'efectivo_a_caja', v_declarado,
    'diferencia', v_diferencia,
    'queda_en_billetera', -v_diferencia
  );
END;
$function$;

-- Verificación rápida después de aplicar:
--   SELECT proname FROM pg_proc WHERE proname = 'rendicion_confirmar';
-- Y tras confirmar una rendición con faltante de $200:
--   SELECT saldo FROM saldos_financieros WHERE cuenta_tipo='BILLETERA' AND cuenta_id='<vendedor>';  -- = 200
