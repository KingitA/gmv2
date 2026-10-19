-- ═══════════════════════════════════════════════════════════════════════
-- CUENTAS CORRIENTES · Cuenta personal de empleados (19/10/2026)
--
-- Reglas del dueño:
--  · La cuenta personal de un empleado (vendedor, chofer, depósito) ES su
--    cuenta de cliente (las que ya existen: "FREIJE DANIEL (VIAJANTE)",
--    "ORDIALES RODRIGO (EMPLEADO)"…). Mismo libro mayor, misma fuente única.
--  · Ahí entran: mercadería que retira (pedido normal), pagos que hace,
--    comisiones (cuando el comprobante del cliente queda saldado), retiros,
--    diferencias de rendición (con fecha y rendición) y ajustes de la oficina.
--  · Las cuentas de empleados NO cuentan como deuda de clientes (antigüedad,
--    Jarvis, Playroom): se ven en un listado aparte.
--
-- 1. clientes.es_empleado / empleado_usuario_id y vendedores.cuenta_cliente_id.
-- 2. cuenta_empleado_de(id): la cuenta de un empleado a partir de su usuario
--    o de su código de vendedor.
-- 3. Las diferencias de rendición que hoy se anotan en la billetera se copian
--    solas a la cuenta del empleado (trigger), con fecha y rendición.
-- 4. Retiros de efectivo: billetera_movimientos.rendicion_id; rendicion_crear
--    v4 los descuenta de lo que el cobrador tiene que entregar.
-- 5. rendicion_devolver v2: revierte TODO el saldo declarado (antes solo el
--    primer movimiento) y libera los retiros.
-- 6. Antigüedad sin empleados.
-- 7. Comisiones: arreglo del ON CONFLICT roto y el trigger que pisaba la
--    comisión cobrada.
--
-- IDEMPOTENTE. No borra datos.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. Marcas y vínculos ──────────────────────────────────────────────
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS es_empleado boolean NOT NULL DEFAULT false;
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS empleado_usuario_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS uq_clientes_empleado_usuario
  ON public.clientes (empleado_usuario_id) WHERE empleado_usuario_id IS NOT NULL;
COMMENT ON COLUMN public.clientes.es_empleado IS 'Cuenta personal de un empleado: no cuenta como deuda de clientes';
COMMENT ON COLUMN public.clientes.empleado_usuario_id IS 'Usuario del sistema dueño de esta cuenta personal (chofer, depósito, vendedor)';

ALTER TABLE public.vendedores ADD COLUMN IF NOT EXISTS cuenta_cliente_id uuid;
COMMENT ON COLUMN public.vendedores.cuenta_cliente_id IS 'Cuenta personal (cliente empleado) donde entran las comisiones de este código de vendedor';

-- Las cuentas de empleados que ya existen (importadas del sistema viejo)
UPDATE public.clientes SET es_empleado = true
WHERE es_empleado = false
  AND (nombre ILIKE '%(EMPLEADO)%' OR nombre ILIKE '%(VIAJANTE)%'
       OR nombre_razon_social ILIKE '%(EMPLEADO)%' OR nombre_razon_social ILIKE '%(VIAJANTE)%');

-- ─── 2. Cuenta de un empleado ──────────────────────────────────────────
-- p_id puede ser un usuario (chofer, depósito) o un código de vendedor.
CREATE OR REPLACE FUNCTION public.cuenta_empleado_de(p_id uuid)
RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT c.id FROM clientes c WHERE c.empleado_usuario_id = p_id LIMIT 1),
    (SELECT v.cuenta_cliente_id FROM vendedores v WHERE v.id = p_id AND v.cuenta_cliente_id IS NOT NULL),
    (SELECT c.id FROM vendedores v JOIN clientes c ON c.empleado_usuario_id = v.usuario_id WHERE v.id = p_id LIMIT 1)
  )
$$;
GRANT EXECUTE ON FUNCTION public.cuenta_empleado_de(uuid) TO authenticated, service_role;

-- ─── 3. Diferencias de rendición → cuenta del empleado ─────────────────
-- Convención de la billetera: monto > 0 = el cobrador debe; < 0 = a su favor.
ALTER TABLE public.billetera_movimientos ADD COLUMN IF NOT EXISTS rendicion_id uuid;
ALTER TABLE public.billetera_movimientos ADD COLUMN IF NOT EXISTS cuenta_posteada boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.billetera_a_cuenta_empleado()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_cuenta uuid;
  v_tipo   text;
BEGIN
  IF NEW.referencia_tipo NOT IN ('rendicion_saldo_declarado', 'rendicion_diferencia', 'rendicion_devuelta', 'viaje_gasto_rechazado') THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.monto, 0) = 0 THEN RETURN NEW; END IF;
  v_cuenta := cuenta_empleado_de(NEW.viajante_id);
  IF v_cuenta IS NULL THEN RETURN NEW; END IF;  -- sin cuenta vinculada: queda en la bandeja
  v_tipo := CASE WHEN NEW.referencia_tipo = 'viaje_gasto_rechazado' THEN 'gasto_rechazado' ELSE 'diferencia_rendicion' END;
  IF NOT EXISTS (
    SELECT 1 FROM cuenta_corriente_clientes
    WHERE referencia_tipo = 'billetera' AND referencia_id = NEW.id
  ) THEN
    PERFORM cc_postear(
      v_cuenta, v_tipo,
      GREATEST(NEW.monto, 0), GREATEST(-NEW.monto, 0),
      'billetera', NEW.id, NULL,
      COALESCE(NEW.concepto, NEW.referencia_tipo) || ' · ' || to_char((COALESCE(NEW.fecha, now()) AT TIME ZONE 'America/Argentina/Buenos_Aires'), 'DD/MM/YYYY'),
      NEW.creado_por
    );
    UPDATE billetera_movimientos SET cuenta_posteada = true WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_billetera_a_cuenta_empleado ON public.billetera_movimientos;
CREATE TRIGGER trg_billetera_a_cuenta_empleado
  AFTER INSERT ON public.billetera_movimientos
  FOR EACH ROW EXECUTE FUNCTION public.billetera_a_cuenta_empleado();

-- ─── 4. rendicion_crear v4: descuenta los retiros de efectivo ──────────
-- esperado en mano = efectivo cobrado + fondos − gastos − ya liquidado
--                    − retiros de efectivo todavía no rendidos (ya están
--                      debitados en la cuenta del empleado).
CREATE OR REPLACE FUNCTION public.rendicion_crear(
  p_cobrador_id uuid, p_cobrador_tipo text, p_pago_ids uuid[],
  p_efectivo_declarado numeric, p_viaje_id uuid DEFAULT NULL::uuid,
  p_observaciones text DEFAULT NULL::text, p_usuario_id uuid DEFAULT NULL::uuid
)
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
        || ': esperado en mano $' || v_esperado
        || ' (cobró $' || v_registrado
        || CASE WHEN v_fondos > 0 THEN ' + a cuenta viaje $' || v_fondos ELSE '' END
        || CASE WHEN v_gastos > 0 THEN ' − gastos $' || v_gastos ELSE '' END
        || CASE WHEN v_liquidado <> 0 THEN ' − ya liquidado $' || v_liquidado ELSE '' END
        || CASE WHEN v_retiros <> 0 THEN ' − retiros $' || v_retiros ELSE '' END
        || ') y declaró enviar $' || v_declarado
        || CASE WHEN v_saldo_cc > 0
             THEN ' — retiene $' || v_saldo_cc || ' (queda debiendo en su cuenta)'
             ELSE ' — $' || abs(v_saldo_cc) || ' a su favor' END,
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
GRANT EXECUTE ON FUNCTION public.rendicion_crear(uuid, text, uuid[], numeric, uuid, text, uuid) TO authenticated, service_role;

-- ─── 5. rendicion_devolver v2 ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rendicion_devolver(
  p_rendicion_id uuid,
  p_usuario_id   uuid,
  p_motivo       text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_rend  rendiciones%ROWTYPE;
  v_total numeric;
  v_quien uuid;
BEGIN
  SELECT * INTO v_rend FROM rendiciones WHERE id = p_rendicion_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'rendicion_devolver: rendición no encontrada'; END IF;
  IF v_rend.estado <> 'abierta' THEN
    RAISE EXCEPTION 'rendicion_devolver: la rendición está % (solo se devuelve una abierta)', v_rend.estado;
  END IF;

  -- Reversa de TODO el saldo anotado al declarar (antes solo el primer movimiento)
  SELECT COALESCE(sum(monto), 0), max(viajante_id::text)::uuid INTO v_total, v_quien
  FROM billetera_movimientos
  WHERE referencia_tipo = 'rendicion_saldo_declarado' AND referencia_id = p_rendicion_id;

  IF abs(v_total) > 0.005 AND NOT EXISTS (
    SELECT 1 FROM billetera_movimientos
    WHERE referencia_tipo = 'rendicion_devuelta' AND referencia_id = p_rendicion_id
  ) THEN
    INSERT INTO billetera_movimientos (
      viajante_id, tipo, medio, monto, concepto, referencia_id, referencia_tipo, fecha, creado_por
    ) VALUES (
      COALESCE(v_quien, v_rend.cobrador_id),
      CASE WHEN v_total > 0 THEN 'credito' ELSE 'debito' END,
      'efectivo', -v_total,
      'Rendición ' || left(p_rendicion_id::text, 8) || ' devuelta por oficina: se anula el saldo declarado'
        || COALESCE(' (' || NULLIF(trim(p_motivo), '') || ')', ''),
      p_rendicion_id, 'rendicion_devuelta', now(), p_usuario_id
    );
  END IF;

  -- Los retiros vuelven a quedar "sin rendir" (entran en la próxima rendición)
  UPDATE billetera_movimientos SET rendicion_id = NULL
  WHERE rendicion_id = p_rendicion_id AND referencia_tipo = 'retiro_efectivo';

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

-- ─── 6. Antigüedad sin cuentas de empleados ────────────────────────────
-- Misma fórmula de 20261016_cc_fuente_unica.sql; solo se excluyen empleados.
CREATE OR REPLACE FUNCTION public.cc_deuda_antiguedad_base(p_cliente_id uuid DEFAULT NULL)
RETURNS TABLE(cliente_id uuid, saldo numeric, d0_29 numeric, d30_59 numeric, d60_89 numeric, d90_mas numeric,
              dias_mas_vieja integer, dias_promedio numeric, fecha_mas_vieja date, debitos_pendientes integer)
LANGUAGE sql STABLE AS $$
  WITH saldos AS (
    SELECT cc.cliente_id, SUM(COALESCE(cc.debe, 0)) - SUM(COALESCE(cc.haber, 0)) AS s
    FROM cuenta_corriente_clientes cc
    JOIN clientes cl ON cl.id = cc.cliente_id AND NOT cl.es_empleado
    WHERE p_cliente_id IS NULL OR cc.cliente_id = p_cliente_id
    GROUP BY cc.cliente_id
    HAVING SUM(COALESCE(cc.debe, 0)) - SUM(COALESCE(cc.haber, 0)) > 0.5
  ), debitos AS (
    SELECT cc.cliente_id, cc.id, cc.fecha AS orden_fecha, cc.debe,
      COALESCE(cv.fecha, (cc.fecha AT TIME ZONE 'America/Argentina/Buenos_Aires')::date) AS f
    FROM cuenta_corriente_clientes cc
    JOIN saldos s ON s.cliente_id = cc.cliente_id
    LEFT JOIN comprobantes_venta cv
      ON cc.referencia_tipo = 'comprobante_venta' AND cv.id = cc.referencia_id
    WHERE COALESCE(cc.debe, 0) > 0
      AND COALESCE(cc.referencia_tipo, '') <> 'pago_anulacion'
      AND COALESCE(cc.observaciones, '') NOT LIKE '%[reversa:%'
      AND cc.tipo_movimiento NOT IN ('nota_credito', 'pago')
  ), acumulado AS (
    SELECT d.*, SUM(d.debe) OVER (PARTITION BY d.cliente_id ORDER BY d.f DESC, d.orden_fecha DESC, d.id DESC) AS acum
    FROM debitos d
  ), pendiente AS (
    SELECT a.cliente_id, a.f, GREATEST(0, LEAST(a.debe, s.s - (a.acum - a.debe))) AS monto
    FROM acumulado a JOIN saldos s ON s.cliente_id = a.cliente_id
  ), resto AS (
    SELECT s.cliente_id,
      COALESCE((SELECT MIN(d.f) FROM debitos d WHERE d.cliente_id = s.cliente_id), public.hoy_ar()) AS f,
      s.s - COALESCE((SELECT SUM(p.monto) FROM pendiente p WHERE p.cliente_id = s.cliente_id), 0) AS monto
    FROM saldos s
  ), todo AS (
    SELECT p.cliente_id, p.f, p.monto FROM pendiente p WHERE p.monto > 0.005
    UNION ALL
    SELECT r.cliente_id, r.f, r.monto FROM resto r WHERE r.monto > 0.005
  ), con_dias AS (
    SELECT t.cliente_id, t.f, t.monto, GREATEST(0, public.hoy_ar() - t.f) AS dias FROM todo t
  )
  SELECT s.cliente_id,
    ROUND(s.s, 2) AS saldo,
    ROUND(COALESCE(SUM(c.monto) FILTER (WHERE c.dias < 30), 0), 2)              AS d0_29,
    ROUND(COALESCE(SUM(c.monto) FILTER (WHERE c.dias BETWEEN 30 AND 59), 0), 2) AS d30_59,
    ROUND(COALESCE(SUM(c.monto) FILTER (WHERE c.dias BETWEEN 60 AND 89), 0), 2) AS d60_89,
    ROUND(COALESCE(SUM(c.monto) FILTER (WHERE c.dias >= 90), 0), 2)             AS d90_mas,
    MAX(c.dias)::integer AS dias_mas_vieja,
    ROUND(SUM(c.monto * c.dias) / NULLIF(SUM(c.monto), 0), 1) AS dias_promedio,
    MIN(c.f) AS fecha_mas_vieja,
    COUNT(c.*)::integer AS debitos_pendientes
  FROM saldos s
  LEFT JOIN con_dias c ON c.cliente_id = s.cliente_id
  GROUP BY s.cliente_id, s.s
$$;

-- ─── 7. Comisiones: arreglos de los triggers ───────────────────────────
-- (a) el ON CONFLICT apuntaba a un índice que ya no existe (kardex_id solo):
--     fallaba al ponerle comisión a un renglón después de cargado.
CREATE OR REPLACE FUNCTION public.sync_comision_desde_kardex_manual(p_kardex_id uuid)
RETURNS void
LANGUAGE sql
AS $function$
  INSERT INTO public.comisiones (
    viajante_id, pedido_id, monto, porcentaje,
    comprobante_venta_id, comprobante_cobrado, fecha_comprobante_cobrado,
    tipo, articulo_id, segmento, cantidad, precio_neto_unitario,
    kardex_id, created_at
  )
  SELECT
    k.vendedor_id, k.pedido_id, k.comision_viajante_monto, COALESCE(k.comision_viajante_pct, 0),
    k.comprobante_venta_id, COALESCE(k.comprobante_cobrado, false), k.fecha_comprobante_cobrado,
    'vendida', k.articulo_id, k.articulo_categoria, k.cantidad,
    CASE WHEN COALESCE(k.cantidad, 0) <> 0 THEN COALESCE(k.subtotal_neto, 0) / k.cantidad END,
    k.id, COALESCE(k.fecha, now())
  FROM public.kardex k
  WHERE k.id = p_kardex_id
  ON CONFLICT (kardex_id, tipo) WHERE kardex_id IS NOT NULL DO NOTHING;
$function$;

-- (b) al editar el kardex se actualizaba también la comisión 'cobrada' (y se
--     borraba al eliminar el pedido). Ahora solo toca la 'vendida' (estimación);
--     la comisión ganada vive en la cuenta del empleado.
CREATE OR REPLACE FUNCTION public.sync_comision_update_kardex()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.pedido_eliminado = true AND COALESCE(OLD.pedido_eliminado, false) = false THEN
    DELETE FROM public.comisiones WHERE kardex_id = NEW.id AND tipo = 'vendida' AND pagado = false;
    RETURN NEW;
  END IF;

  IF NEW.tipo_movimiento = 'venta'
     AND NEW.pedido_eliminado = false
     AND COALESCE(NEW.comision_viajante_monto, 0) <> 0
     AND COALESCE(OLD.comision_viajante_monto, 0) = 0 THEN
    PERFORM public.sync_comision_desde_kardex_manual(NEW.id);
  END IF;

  UPDATE public.comisiones co SET
    comprobante_cobrado = COALESCE(NEW.comprobante_cobrado, false),
    fecha_comprobante_cobrado = NEW.fecha_comprobante_cobrado,
    monto = COALESCE(NEW.comision_viajante_monto, co.monto),
    porcentaje = COALESCE(NEW.comision_viajante_pct, co.porcentaje)
  WHERE co.kardex_id = NEW.id
    AND co.tipo = 'vendida'
    AND co.pagado = false
    AND (co.comprobante_cobrado IS DISTINCT FROM COALESCE(NEW.comprobante_cobrado, false)
         OR co.fecha_comprobante_cobrado IS DISTINCT FROM NEW.fecha_comprobante_cobrado
         OR co.monto IS DISTINCT FROM NEW.comision_viajante_monto);

  RETURN NEW;
END;
$function$;
