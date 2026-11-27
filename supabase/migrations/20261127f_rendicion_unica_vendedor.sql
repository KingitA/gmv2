-- ═══════════════════════════════════════════════════════════════════════
-- RENDICIÓN ÚNICA DEL VENDEDOR (27/11/2026) — rendicion_crear v6
--
-- Qué pasaba (rendición real de Freije, 27/11): un usuario con DOS códigos de vendedor
-- (FREIJE DANIEL y FREIJE DANIEL LISTA NECO) armaba UNA rendición por código. El retiro
-- (cargado en un solo código) se descontaba solo de ESA rendición: una quedaba con
-- "esperado en mano -508.890" y la otra con lo de más; para la oficina, un lío.
--
-- Qué cambia: rendicion_crear acepta p_retiros_de uuid[] (todos los códigos del usuario).
-- POST /api/viajante/rendir manda TODOS los pagos en una sola llamada con el código
-- principal y p_retiros_de = todos sus códigos ⇒ UNA rendición que descuenta TODOS los
-- retiros sin rendir. Sin p_retiros_de (chofer, viajes) se comporta igual que v5.
--
-- La función vieja (7 parámetros) se reemplaza: los llamados existentes usan parámetros
-- con nombre y siguen andando. IDEMPOTENTE. Aplicar con OK de Juan.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

DROP FUNCTION IF EXISTS public.rendicion_crear(uuid, text, uuid[], numeric, uuid, text, uuid);

CREATE OR REPLACE FUNCTION public.rendicion_crear(p_cobrador_id uuid, p_cobrador_tipo text, p_pago_ids uuid[], p_efectivo_declarado numeric, p_viaje_id uuid DEFAULT NULL::uuid, p_observaciones text DEFAULT NULL::text, p_usuario_id uuid DEFAULT NULL::uuid, p_retiros_de uuid[] DEFAULT NULL::uuid[])
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
  -- Códigos cuyos retiros se descuentan: todos los del usuario (rendición única) o solo este
  v_retiros_de   uuid[] := COALESCE(p_retiros_de, ARRAY[p_cobrador_id]);
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
  WHERE viajante_id = ANY (v_retiros_de) AND referencia_tipo = 'retiro_efectivo' AND rendicion_id IS NULL;

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
  WHERE viajante_id = ANY (v_retiros_de) AND referencia_tipo = 'retiro_efectivo' AND rendicion_id IS NULL;

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

GRANT EXECUTE ON FUNCTION public.rendicion_crear(uuid, text, uuid[], numeric, uuid, text, uuid, uuid[]) TO authenticated, service_role;

COMMIT;
