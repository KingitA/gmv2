-- ============================================================================
-- Billeteras sin plata "fantasma" después de rendir (#29, #36) y textos con
-- formato de plata (#30) — prueba integral de salida, 26/10/2026
-- ============================================================================
-- #29 (chofer): rindió $44.000 de $45.000. La diferencia ($1.000) iba a la cuenta
--   personal (rendicion_diferencia → trigger) Y TAMBIÉN sumaba en la billetera
--   (saldos_financieros BILLETERA = Σ billetera_movimientos): $1.000 contados dos
--   veces. Regla 29 de la auditoría: la diferencia va SOLO a la cuenta personal.
-- #36 (vendedor): retiró $10.000 (la billetera ya bajó con el retiro) y la
--   rendición descontó los cobros enteros: la billetera quedó en −$10.000.
-- #30: los textos decían "faltan $1000.0000000000000000".
--
-- Qué cambia:
--  1. fmt_moneda(numeric) → '$1.000,32' (formato del sistema, docs/FORMATOS.md).
--  2. billetera_saldo_sync: los movimientos que son de la CUENTA PERSONAL
--     (rendicion_saldo_declarado, rendicion_diferencia, rendicion_devuelta,
--     viaje_gasto_rechazado) ya no mueven la plata en mano.
--  3. rendicion_confirmar v3: devuelve a la billetera los retiros de esa
--     rendición (movimiento 'rendicion_retiros'); textos con formato.
--  4. rendicion_crear v5: textos con formato (misma lógica que v4).
--  5. Reparación: compensa los retiros de rendiciones ya confirmadas y recalcula
--     el saldo BILLETERA de cada cobrador sin los movimientos de cuenta personal.
--     No toca el libro ni las cuentas personales.
-- Basado en las funciones vivas del 26/10 (pg_get_functiondef).
-- ============================================================================

-- ── 1. Formato de plata ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fmt_moneda(p numeric)
RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE WHEN p < 0 THEN '-' ELSE '' END || '$' ||
    translate(to_char(round(abs(COALESCE(p, 0)), 2), 'FM999,999,999,999,990.00'), ',.', '.,')
$fn$;
-- Separadores literales (no G/D: dependen del locale del servidor); translate pasa
-- "1,000.00" a "1.000,00". Verificación: SELECT fmt_moneda(1000), fmt_moneda(-45000.5);

-- ── 2. La billetera no suma lo que es de la cuenta personal ────────────────
CREATE OR REPLACE FUNCTION public.billetera_saldo_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Diferencias de rendición y gastos rechazados son deuda/crédito PERSONAL del
  -- cobrador (billetera_a_cuenta_empleado los copia a su cuenta): no son plata
  -- de la empresa en su mano (#29).
  IF NEW.referencia_tipo IN ('rendicion_saldo_declarado', 'rendicion_diferencia', 'rendicion_devuelta', 'viaje_gasto_rechazado') THEN
    RETURN NEW;
  END IF;
  INSERT INTO saldos_financieros (cuenta_tipo, cuenta_id, color, saldo)
  VALUES ('BILLETERA', NEW.viajante_id, 'BLANCO', COALESCE(NEW.monto, 0))
  ON CONFLICT (cuenta_tipo, cuenta_id, color)
  DO UPDATE SET saldo = saldos_financieros.saldo + COALESCE(NEW.monto, 0), updated_at = now();
  RETURN NEW;
END;
$function$;

-- ── 3. rendicion_confirmar v3 ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rendicion_confirmar(p_rendicion_id uuid, p_caja_destino_tipo text, p_caja_destino_id uuid, p_usuario_id uuid, p_pagos_verificados uuid[] DEFAULT NULL::uuid[], p_efectivo_declarado numeric DEFAULT NULL::numeric, p_forzar_diferencia boolean DEFAULT false)
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
  v_contado     numeric;
  v_diferencia  numeric;
  v_liquidado   numeric := 0;
  v_neto_fondo  numeric := 0;
  v_solo_transferencia boolean;
  v_retiros     numeric := 0;
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

  -- v3 (#36, prueba de salida 26/10): lo que el cobrador retiró para sí ya salió de
  -- la billetera con el retiro; la rendición descuenta los cobros enteros, así que
  -- se devuelve lo retirado (sin esto la billetera quedaba en −retiro). Idempotente.
  SELECT COALESCE(sum(-monto), 0) INTO v_retiros
  FROM billetera_movimientos
  WHERE rendicion_id = p_rendicion_id AND referencia_tipo = 'retiro_efectivo';
  IF v_retiros > 0.005 AND NOT EXISTS (
    SELECT 1 FROM billetera_movimientos
    WHERE referencia_tipo = 'rendicion_retiros' AND referencia_id = p_rendicion_id
  ) THEN
    INSERT INTO billetera_movimientos (
      viajante_id, tipo, medio, monto, concepto, referencia_id, referencia_tipo, fecha, creado_por
    ) VALUES (
      v_rend.cobrador_id, 'credito', 'efectivo', v_retiros,
      'Rendición ' || left(p_rendicion_id::text, 8) || ': retiros ya descontados de la mano (' || fmt_moneda(v_retiros) || ', están en su cuenta personal)',
      p_rendicion_id, 'rendicion_retiros', now(), p_usuario_id
    );
  END IF;

  v_declarado  := COALESCE(v_rend.efectivo_declarado, 0);
  v_contado    := COALESCE(p_efectivo_declarado, v_declarado);
  v_diferencia := round((v_contado - v_declarado) * 100) / 100;

  IF abs(v_diferencia) > 0.01 AND NOT p_forzar_diferencia THEN
    RAISE EXCEPTION 'rendicion_confirmar: diferencia de rendición $% (declaró enviar % y oficina contó %) — confirmar con p_forzar_diferencia=true',
      v_diferencia, v_declarado, v_contado;
  END IF;

  IF v_contado > 0 THEN
    PERFORM kardex_registrar(
      p_tipo_movimiento => 'RENDICION_VIAJE',
      p_concepto        => 'Rendición ' || v_rend.cobrador_tipo || ' ' || left(p_rendicion_id::text, 8)
                           || CASE WHEN v_rend.viaje_id IS NOT NULL THEN ' (viaje ' || left(v_rend.viaje_id::text, 8) || ')' ELSE '' END,
      p_monto           => v_contado,
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

  -- LIQUIDACIÓN DEL FONDO — valores CONGELADOS, única POR VIAJE
  IF v_rend.viaje_id IS NOT NULL THEN
    v_liquidado  := viaje_fondo_liquidado(v_rend.viaje_id);
    v_neto_fondo := round((COALESCE(v_rend.fondos_viaje, 0) - COALESCE(v_rend.gastos_viaje, 0) - v_liquidado) * 100) / 100;
    IF abs(v_neto_fondo) > 0.005 THEN
      INSERT INTO billetera_movimientos (
        viajante_id, tipo, medio, monto, concepto, referencia_id, referencia_tipo, fecha, creado_por
      ) VALUES (
        v_rend.cobrador_id,
        CASE WHEN v_neto_fondo > 0 THEN 'debito' ELSE 'credito' END,
        'efectivo',
        -v_neto_fondo,
        'Fondo del viaje liquidado en rendición ' || left(p_rendicion_id::text, 8)
          || ': a cuenta ' || fmt_moneda(COALESCE(v_rend.fondos_viaje, 0)) || ' − gastos ' || fmt_moneda(COALESCE(v_rend.gastos_viaje, 0))
          || CASE WHEN v_liquidado <> 0 THEN ' − ya liquidado ' || fmt_moneda(v_liquidado) ELSE '' END,
        v_rend.viaje_id, 'viaje_fondo_liquidado', now(), p_usuario_id
      );
    END IF;
  END IF;

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
          THEN 'Diferencia rendición ' || left(p_rendicion_id::text, 8) || ': declaró enviar ' || fmt_moneda(v_declarado) || ' y oficina contó ' || fmt_moneda(v_contado) || ' — faltan ' || fmt_moneda(abs(v_diferencia))
          ELSE 'Diferencia rendición ' || left(p_rendicion_id::text, 8) || ': declaró enviar ' || fmt_moneda(v_declarado) || ' y oficina contó ' || fmt_moneda(v_contado) || ' — sobran ' || fmt_moneda(v_diferencia) || ' a su favor'
        END,
        p_rendicion_id, 'rendicion_diferencia', now(), p_usuario_id
      );
    END IF;

    INSERT INTO kardex_contable (
      tipo_movimiento, concepto, monto, origen_tipo, origen_id,
      destino_tipo, destino_id, referencia_tipo, referencia_id, viaje_id, cobrador_id, verificado, verificado_por, verificado_at
    ) VALUES (
      'AJUSTE_CAJA',
      CASE WHEN v_diferencia < 0 THEN 'Faltante' ELSE 'Sobrante' END
        || ' diferencia rendición ' || left(p_rendicion_id::text, 8)
        || ' (declaró ' || fmt_moneda(v_declarado) || ' vs contado ' || fmt_moneda(v_contado) || ') — va a la cuenta personal del cobrador',
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
    'efectivo_a_caja', v_contado,
    'declarado', v_declarado,
    'contado', v_contado,
    'diferencia', v_diferencia,
    'fondo_liquidado', v_neto_fondo,
    'queda_en_billetera', -v_diferencia
  );
END;
$function$;

-- ── 4. rendicion_crear v5 ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rendicion_crear(p_cobrador_id uuid, p_cobrador_tipo text, p_pago_ids uuid[], p_efectivo_declarado numeric, p_viaje_id uuid DEFAULT NULL::uuid, p_observaciones text DEFAULT NULL::text, p_usuario_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rendicion_id uuid;
  v_pago_ids     uuid[];
  v_registrado   numeric;
  v_declarado    numeric;
  v_fondos       numeric := 0;
  v_gastos       numeric := 0;
  v_liquidado    numeric := 0;
  v_retiros      numeric := 0;  -- retiros de efectivo no rendidos (ya debitados en su cuenta)
  v_esperado     numeric;
  v_saldo_cc     numeric;
BEGIN
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

  SELECT COALESCE(sum(pd.monto), 0) INTO v_registrado
  FROM pagos_detalle pd
  WHERE pd.pago_id = ANY (v_pago_ids) AND pd.tipo_pago = 'efectivo';

  IF p_viaje_id IS NOT NULL THEN
    SELECT COALESCE(sum(monto), 0) INTO v_fondos FROM viajes_fondos WHERE viaje_id = p_viaje_id;
    SELECT COALESCE(sum(monto), 0) INTO v_gastos FROM viajes_gastos WHERE viaje_id = p_viaje_id AND estado <> 'rechazado';
    v_liquidado := viaje_fondo_liquidado(p_viaje_id);
  END IF;

  SELECT COALESCE(sum(-monto), 0) INTO v_retiros
  FROM billetera_movimientos
  WHERE viajante_id = p_cobrador_id AND referencia_tipo = 'retiro_efectivo' AND rendicion_id IS NULL;

  v_declarado := COALESCE(p_efectivo_declarado, 0);
  v_esperado  := round((v_registrado + (v_fondos - v_gastos - v_liquidado) - v_retiros) * 100) / 100;
  v_saldo_cc  := round((v_esperado - v_declarado) * 100) / 100;

  INSERT INTO rendiciones (
    viaje_id, cobrador_id, cobrador_tipo,
    efectivo_declarado, efectivo_registrado, diferencia,
    fondos_viaje, gastos_viaje,
    observaciones, creado_por
  ) VALUES (
    p_viaje_id, p_cobrador_id, p_cobrador_tipo,
    v_declarado, v_registrado,
    round((v_declarado - v_esperado) * 100) / 100,
    v_fondos, v_gastos,
    p_observaciones, p_usuario_id
  ) RETURNING id INTO v_rendicion_id;

  INSERT INTO rendicion_items (rendicion_id, pago_id)
  SELECT v_rendicion_id, unnest(v_pago_ids);

  -- Los retiros quedan rendidos en esta rendición
  UPDATE billetera_movimientos SET rendicion_id = v_rendicion_id
  WHERE viajante_id = p_cobrador_id AND referencia_tipo = 'retiro_efectivo' AND rendicion_id IS NULL;

  IF abs(v_saldo_cc) > 0.01 THEN
    INSERT INTO billetera_movimientos (
      viajante_id, tipo, medio, monto, concepto, referencia_id, referencia_tipo, fecha, creado_por
    ) VALUES (
      p_cobrador_id,
      CASE WHEN v_saldo_cc > 0 THEN 'debito' ELSE 'credito' END,
      'efectivo',
      v_saldo_cc,
      'Rendición ' || left(v_rendicion_id::text, 8)
        || ': esperado en mano ' || fmt_moneda(v_esperado)
        || ' (cobró ' || fmt_moneda(v_registrado)
        || CASE WHEN v_fondos > 0 THEN ' + a cuenta viaje ' || fmt_moneda(v_fondos) ELSE '' END
        || CASE WHEN v_gastos > 0 THEN ' − gastos ' || fmt_moneda(v_gastos) ELSE '' END
        || CASE WHEN v_liquidado <> 0 THEN ' − ya liquidado ' || fmt_moneda(v_liquidado) ELSE '' END
        || CASE WHEN v_retiros <> 0 THEN ' − retiros ' || fmt_moneda(v_retiros) ELSE '' END
        || ') y declaró enviar ' || fmt_moneda(v_declarado)
        || CASE WHEN v_saldo_cc > 0
             THEN ' — retiene ' || fmt_moneda(v_saldo_cc) || ' (queda debiendo en su cuenta)'
             ELSE ' — ' || fmt_moneda(abs(v_saldo_cc)) || ' a su favor' END,
      v_rendicion_id, 'rendicion_saldo_declarado', now(), p_usuario_id
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'rendicion_id', v_rendicion_id,
    'cantidad_pagos', array_length(v_pago_ids, 1),
    'efectivo_registrado', v_registrado,
    'fondos_viaje', v_fondos,
    'gastos_viaje', v_gastos,
    'fondo_ya_liquidado', v_liquidado,
    'retiros', v_retiros,
    'esperado_en_mano', v_esperado,
    'efectivo_declarado', v_declarado,
    'saldo_cobrador', v_saldo_cc,
    'diferencia', round((v_declarado - v_esperado) * 100) / 100
  );
END;
$function$;

-- ── 5. Reparación de lo ya rendido ─────────────────────────────────────────
-- 5a. Retiros de rendiciones YA confirmadas: la compensación que hoy hace v3.
INSERT INTO billetera_movimientos (viajante_id, tipo, medio, monto, concepto, referencia_id, referencia_tipo, fecha, creado_por)
SELECT r.cobrador_id, 'credito', 'efectivo', x.retiros,
       'Rendición ' || left(r.id::text, 8) || ': retiros ya descontados de la mano (' || fmt_moneda(x.retiros) || ', están en su cuenta personal) — reparación 26/10',
       r.id, 'rendicion_retiros', now(), NULL
FROM rendiciones r
JOIN LATERAL (
  SELECT COALESCE(sum(-m.monto), 0) AS retiros
  FROM billetera_movimientos m
  WHERE m.rendicion_id = r.id AND m.referencia_tipo = 'retiro_efectivo'
) x ON x.retiros > 0.005
WHERE r.estado = 'confirmada'
  AND NOT EXISTS (
    SELECT 1 FROM billetera_movimientos c
    WHERE c.referencia_tipo = 'rendicion_retiros' AND c.referencia_id = r.id
  );

-- 5b. Saldo BILLETERA = Σ movimientos que son plata en mano (sin los de cuenta personal)
UPDATE saldos_financieros s
SET saldo = x.saldo, updated_at = now()
FROM (
  SELECT viajante_id, round(COALESCE(sum(monto), 0), 2) AS saldo
  FROM billetera_movimientos
  WHERE COALESCE(referencia_tipo, '') NOT IN ('rendicion_saldo_declarado', 'rendicion_diferencia', 'rendicion_devuelta', 'viaje_gasto_rechazado')
  GROUP BY viajante_id
) x
WHERE s.cuenta_tipo = 'BILLETERA' AND s.color = 'BLANCO' AND s.cuenta_id = x.viajante_id
  AND abs(s.saldo - x.saldo) > 0.005;

-- Verificación (las billeteras de la prueba tienen que dar 0):
--   SELECT cuenta_id, saldo FROM saldos_financieros WHERE cuenta_tipo = 'BILLETERA' AND abs(saldo) > 0.005;
--   SELECT fmt_moneda(1000), fmt_moneda(-45000.5);   -- $1.000,00 · -$45.000,50
