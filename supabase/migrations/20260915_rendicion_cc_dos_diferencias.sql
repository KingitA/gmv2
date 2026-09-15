-- ============================================================================
-- Rendición: la billetera es CUENTA CORRIENTE — dos diferencias distintas
-- ============================================================================
-- Regla (15/09/2026):
--  1) COBRADO vs DECLARADO (al DECLARAR la rendición): si cobró $5.000 en
--     efectivo y declara enviar $4.500, los $500 le quedan YA como saldo de su
--     cuenta corriente (los tiene él); si declara $5.500, tiene $500 a favor.
--     NO es una "diferencia de rendición": es un movimiento normal de su CC,
--     asentado al declarar (referencia_tipo 'rendicion_saldo_declarado').
--  2) DECLARADO vs CONTADO por oficina (al CONFIRMAR): dijo que mandaba
--     $5.000 y llegaron $4.500 → ESO es "diferencia rendición": movimiento
--     'rendicion_diferencia' + ajuste contable por el faltante/sobrante.
--
-- Antes, rendicion_confirmar comparaba contado vs COBRADO (mezclaba ambos
-- ejes) y el saldo declarado solo se mostraba como advertencia al vuelo.
-- ============================================================================

-- ── 1. rendicion_crear: asienta el saldo declarado en la CC al declarar ─────
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
  v_declarado    numeric;
  v_saldo_cc     numeric;  -- registrado − declarado: >0 se lo queda (debe), <0 a favor
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

  v_declarado := COALESCE(p_efectivo_declarado, 0);
  v_saldo_cc  := round((v_registrado - v_declarado) * 100) / 100;

  INSERT INTO rendiciones (
    viaje_id, cobrador_id, cobrador_tipo,
    efectivo_declarado, efectivo_registrado, diferencia,
    observaciones, creado_por
  ) VALUES (
    p_viaje_id, p_cobrador_id, p_cobrador_tipo,
    v_declarado, v_registrado,
    v_declarado - v_registrado,
    p_observaciones, p_usuario_id
  ) RETURNING id INTO v_rendicion_id;

  INSERT INTO rendicion_items (rendicion_id, pago_id)
  SELECT v_rendicion_id, unnest(v_pago_ids);

  -- CC del cobrador: lo que retiene queda como deuda YA, al declarar
  -- (si entrega de más, queda a su favor). No espera la confirmación.
  IF abs(v_saldo_cc) > 0.01 THEN
    INSERT INTO billetera_movimientos (
      viajante_id, tipo, medio, monto, concepto, referencia_id, referencia_tipo, fecha, creado_por
    ) VALUES (
      p_cobrador_id,
      CASE WHEN v_saldo_cc > 0 THEN 'debito' ELSE 'credito' END,
      'efectivo',
      v_saldo_cc,
      CASE WHEN v_saldo_cc > 0
        THEN 'Rendición ' || left(v_rendicion_id::text, 8) || ': cobró $' || v_registrado || ' en efectivo y declaró enviar $' || v_declarado || ' — retiene $' || v_saldo_cc || ' (queda debiendo en su cuenta)'
        ELSE 'Rendición ' || left(v_rendicion_id::text, 8) || ': declaró enviar $' || v_declarado || ' con $' || v_registrado || ' cobrados — $' || abs(v_saldo_cc) || ' a su favor'
      END,
      v_rendicion_id, 'rendicion_saldo_declarado', now(), p_usuario_id
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'rendicion_id', v_rendicion_id,
    'cantidad_pagos', array_length(v_pago_ids, 1),
    'efectivo_registrado', v_registrado,
    'efectivo_declarado', v_declarado,
    'diferencia', v_declarado - v_registrado,
    'saldo_cuenta_corriente', v_saldo_cc
  );
END;
$$;

-- ── 2. rendicion_confirmar v3: la diferencia es DECLARADO vs CONTADO ────────
CREATE OR REPLACE FUNCTION public.rendicion_confirmar(
  p_rendicion_id uuid,
  p_caja_destino_tipo text,
  p_caja_destino_id uuid,
  p_usuario_id uuid,
  p_pagos_verificados uuid[] DEFAULT NULL::uuid[],
  p_efectivo_declarado numeric DEFAULT NULL::numeric,  -- lo CONTADO por oficina
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
  v_declarado   numeric;   -- lo que el vendedor DECLARÓ al rendir
  v_contado     numeric;   -- lo que oficina CONTÓ al recibir
  v_diferencia  numeric;   -- contado − declarado (el eje de oficina)
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

  -- Ejes separados: el saldo declarado (cobrado vs declarado) YA quedó en la
  -- CC del cobrador al declarar (rendicion_crear). Acá solo se compara lo que
  -- DIJO que mandaba contra lo que oficina CONTÓ.
  v_declarado  := COALESCE(v_rend.efectivo_declarado, 0);
  v_contado    := COALESCE(p_efectivo_declarado, v_declarado);
  v_diferencia := round((v_contado - v_declarado) * 100) / 100;   -- < 0 = faltó plata en el sobre

  IF abs(v_diferencia) > 0.01 AND NOT p_forzar_diferencia THEN
    RAISE EXCEPTION 'rendicion_confirmar: diferencia de rendición $% (declaró enviar % y oficina contó %) — confirmar con p_forzar_diferencia=true',
      v_diferencia, v_declarado, v_contado;
  END IF;

  -- A la caja entra lo que oficina CONTÓ
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

  -- DIFERENCIA DE RENDICIÓN (declaró X, llegó Y): a la CC del cobrador
  -- + rastro contable. El eje declarado-vs-cobrado NO entra acá.
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
          THEN 'Diferencia rendición ' || left(p_rendicion_id::text, 8) || ': declaró enviar $' || v_declarado || ' y oficina contó $' || v_contado || ' — faltan $' || abs(v_diferencia)
          ELSE 'Diferencia rendición ' || left(p_rendicion_id::text, 8) || ': declaró enviar $' || v_declarado || ' y oficina contó $' || v_contado || ' — sobran $' || v_diferencia || ' a su favor'
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
        || ' (declaró $' || v_declarado || ' vs contado $' || v_contado || ') — queda en billetera del cobrador',
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
    'queda_en_billetera', -v_diferencia
  );
END;
$function$;

-- Verificación tras aplicar:
--   Declarar con retención: cobró $5.000, declara $4.500 →
--     SELECT saldo FROM saldos_financieros WHERE cuenta_tipo='BILLETERA' AND cuenta_id='<vend>';
--     (los pagos siguen +5.000 y aparece +500 'rendicion_saldo_declarado')
--   Confirmar contando $4.500 → diferencia = 0 (no hay "diferencia rendición")
--   Confirmar contando $4.000 → diferencia = -500 → movimiento 'rendicion_diferencia' +500
