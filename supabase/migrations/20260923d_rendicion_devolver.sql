-- Devolver una rendición al cobrador (chofer / viajante) para que la rinda de
-- nuevo: se declaró mal (p.ej. efectivo 0). NO toca los cobros (siguen
-- pendiente_rendicion, vuelven a estar "en mano"); revierte el saldo que se le
-- anotó en la billetera al declarar; el viaje vuelve a en_curso.
-- ADITIVA e IDEMPOTENTE.
CREATE OR REPLACE FUNCTION public.rendicion_devolver(
  p_rendicion_id uuid,
  p_usuario_id   uuid,
  p_motivo       text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_rend rendiciones%ROWTYPE;
  v_mov  record;
BEGIN
  SELECT * INTO v_rend FROM rendiciones WHERE id = p_rendicion_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'rendicion_devolver: rendición no encontrada'; END IF;
  IF v_rend.estado <> 'abierta' THEN
    RAISE EXCEPTION 'rendicion_devolver: la rendición está % (solo se devuelve una abierta)', v_rend.estado;
  END IF;

  -- Reversa del saldo anotado al declarar (retuvo / entregó de más)
  FOR v_mov IN
    SELECT * FROM billetera_movimientos
    WHERE referencia_tipo = 'rendicion_saldo_declarado' AND referencia_id = p_rendicion_id
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM billetera_movimientos
      WHERE referencia_tipo = 'rendicion_devuelta' AND referencia_id = p_rendicion_id
    ) THEN
      INSERT INTO billetera_movimientos (
        viajante_id, tipo, medio, monto, concepto, referencia_id, referencia_tipo, fecha, creado_por
      ) VALUES (
        v_mov.viajante_id,
        CASE WHEN v_mov.tipo = 'debito' THEN 'credito' ELSE 'debito' END,
        v_mov.medio, -v_mov.monto,
        'Rendición ' || left(p_rendicion_id::text, 8) || ' devuelta por oficina: se anula el saldo declarado'
          || COALESCE(' (' || NULLIF(trim(p_motivo), '') || ')', ''),
        p_rendicion_id, 'rendicion_devuelta', now(), p_usuario_id
      );
    END IF;
  END LOOP;

  UPDATE rendiciones
  SET estado = 'cancelada',
      observaciones = concat_ws(' · ', observaciones,
        'Devuelta al cobrador para rendir de nuevo' || COALESCE(': ' || NULLIF(trim(p_motivo), ''), ''))
  WHERE id = p_rendicion_id;

  IF v_rend.viaje_id IS NOT NULL THEN
    UPDATE viajes SET estado = 'en_curso', finalizado_at = NULL,
      actualizado_por = p_usuario_id, actualizado_at = now()
    WHERE id = v_rend.viaje_id AND estado = 'en_rendicion';
  END IF;

  RETURN jsonb_build_object('success', true, 'viaje_id', v_rend.viaje_id);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.rendicion_devolver(uuid, uuid, text) TO authenticated, service_role;
