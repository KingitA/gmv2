-- ═══════════════════════════════════════════════════════════════════════
-- CHEQUES · "Un cheque = un papel" y cheques de cobros sin verificar
-- (20/10/2026 — pedido del dueño del 01/10, pendiente del primer batch de las
-- apps; reportado también en la auditoría de cuentas corrientes, hallazgo 15)
--
-- 1. Estado nuevo EN_VERIFICACION: el cheque de un cobro que la oficina todavía
--    no confirmó (lo tiene el vendedor/chofer, o está esperando control) NO es
--    cartera de la empresa. Las vistas y pantallas de cartera filtran
--    EN_CARTERA, así que dejan de contarlo solas. Al confirmarse el cobro pasa a
--    EN_CARTERA; si el cobro se anula o rechaza, a ANULADO.
-- 2. Un cheque compartido entre varios clientes (cobro conjunto del chofer,
--    cobro a varios clientes del vendedor, cobranza múltiple de la oficina) es
--    UNA fila en cheques. Anular el cobro de UNO de esos clientes no anula el
--    cheque mientras otro cliente lo siga usando.
-- 3. cheque_rechazar: si el cheque es compartido y los cobros no estaban
--    confirmados, se rechazan TODOS los cobros que cubría (antes solo uno).
--    Con cobros confirmados, la nota de débito va entera al cliente que
--    entregó el cheque (cliente_origen_id) — regla del dueño 16/10.
--
-- IDEMPOTENTE. No modifica cheques existentes.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TYPE public.cheque_status ADD VALUE IF NOT EXISTS 'EN_VERIFICACION';

-- Cobros vivos (no anulados ni rechazados) que usan un cheque
CREATE OR REPLACE FUNCTION public.cheque_pagos_vivos(p_cheque_id uuid)
RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT count(DISTINCT p.id)::integer
  FROM pagos_detalle pd
  JOIN pagos_clientes p ON p.id = pd.pago_id
  WHERE pd.cheque_id = p_cheque_id AND p.estado NOT IN ('anulado', 'rechazado')
$$;

-- ─── 1a. Al vincular un cheque a un cobro sin confirmar → EN_VERIFICACION ──
CREATE OR REPLACE FUNCTION public.cheque_al_vincular_pago()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.cheque_id IS NULL THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM pagos_clientes p WHERE p.id = NEW.pago_id AND p.estado IN ('pendiente', 'pendiente_rendicion'))
     AND NOT EXISTS (
       SELECT 1 FROM pagos_detalle pd JOIN pagos_clientes p ON p.id = pd.pago_id
       WHERE pd.cheque_id = NEW.cheque_id AND p.estado = 'confirmado'
     ) THEN
    UPDATE cheques SET estado = 'EN_VERIFICACION' WHERE id = NEW.cheque_id AND estado = 'EN_CARTERA';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_cheque_al_vincular_pago ON public.pagos_detalle;
CREATE TRIGGER trg_cheque_al_vincular_pago
  AFTER INSERT ON public.pagos_detalle
  FOR EACH ROW EXECUTE FUNCTION public.cheque_al_vincular_pago();

-- ─── 1b. El cobro cambia de estado → el cheque lo acompaña ─────────────
CREATE OR REPLACE FUNCTION public.cheque_sigue_al_pago()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.estado IS NOT DISTINCT FROM OLD.estado THEN RETURN NEW; END IF;
  IF NEW.estado = 'confirmado' THEN
    UPDATE cheques c SET estado = 'EN_CARTERA'
    WHERE c.estado = 'EN_VERIFICACION'
      AND c.id IN (SELECT pd.cheque_id FROM pagos_detalle pd WHERE pd.pago_id = NEW.id AND pd.cheque_id IS NOT NULL);
  ELSIF NEW.estado IN ('anulado', 'rechazado') THEN
    -- Solo si ningún otro cobro vivo usa el cheque (el actual ya no cuenta)
    UPDATE cheques c SET estado = 'ANULADO'
    WHERE c.estado = 'EN_VERIFICACION'
      AND c.id IN (SELECT pd.cheque_id FROM pagos_detalle pd WHERE pd.pago_id = NEW.id AND pd.cheque_id IS NOT NULL)
      AND cheque_pagos_vivos(c.id) = 0;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_cheque_sigue_al_pago ON public.pagos_clientes;
CREATE TRIGGER trg_cheque_sigue_al_pago
  AFTER UPDATE OF estado ON public.pagos_clientes
  FOR EACH ROW EXECUTE FUNCTION public.cheque_sigue_al_pago();

-- ─── 2. No anular un cheque que otro cliente sigue usando ──────────────
-- cobranza_anular (paso 4) anula los cheques del pago ANTES de marcar el pago
-- anulado: en ese momento el pago todavía cuenta como vivo. Más de 1 cobro vivo
-- = el cheque es de otro cliente también → se conserva.
CREATE OR REPLACE FUNCTION public.cheque_compartido_no_se_anula()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.estado = 'ANULADO' AND OLD.estado IS DISTINCT FROM 'ANULADO' AND cheque_pagos_vivos(NEW.id) > 1 THEN
    NEW.estado := OLD.estado;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_cheque_compartido_no_se_anula ON public.cheques;
CREATE TRIGGER trg_cheque_compartido_no_se_anula
  BEFORE UPDATE OF estado ON public.cheques
  FOR EACH ROW EXECUTE FUNCTION public.cheque_compartido_no_se_anula();

-- ─── 3. cheque_rechazar: todos los cobros sin confirmar del cheque ─────
CREATE OR REPLACE FUNCTION public.cheque_rechazar(p_cheque_id uuid, p_usuario_id uuid, p_motivo text DEFAULT NULL::text, p_gastos numeric DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cheque     cheques%ROWTYPE;
  v_total      numeric;
  v_siguiente  bigint;
  v_numero_nd  text;
  v_nd_id      uuid;
  v_motivo     text := COALESCE(NULLIF(trim(p_motivo), ''), 'Cheque rechazado');
  v_pagos      uuid[];
  v_pend       uuid[];
  v_conf       int;
BEGIN
  SELECT * INTO v_cheque FROM cheques WHERE id = p_cheque_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cheque_rechazar: cheque % no encontrado', p_cheque_id;
  END IF;
  IF v_cheque.estado = 'RECHAZADO' THEN
    RETURN jsonb_build_object('success', true, 'ya_rechazado', true);
  END IF;

  -- Cobros de origen del cheque (directo o vía items de depósito): pueden ser
  -- VARIOS si el cheque cubrió a varios clientes (un cheque = un papel).
  SELECT array_agg(DISTINCT x.pago_id) INTO v_pagos FROM (
    SELECT pd.pago_id FROM pagos_detalle pd WHERE pd.cheque_id = p_cheque_id
    UNION
    SELECT pd.pago_id FROM pago_deposito_items pdi JOIN pagos_detalle pd ON pd.id = pdi.pago_detalle_id
    WHERE pdi.cheque_id = p_cheque_id
  ) x;

  SELECT array_agg(p.id) FILTER (WHERE p.estado IN ('pendiente', 'pendiente_rendicion')),
         count(*) FILTER (WHERE p.estado = 'confirmado')
    INTO v_pend, v_conf
  FROM pagos_clientes p WHERE p.id = ANY (COALESCE(v_pagos, ARRAY[]::uuid[]));

  -- ── Cheque → RECHAZADO (siempre) ──
  UPDATE cheques
  SET estado = 'RECHAZADO',
      fecha_rechazo = (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date,
      motivo_rechazo = v_motivo
  WHERE id = p_cheque_id;

  -- ── CASO 1: ningún cobro confirmado → se rechazan TODOS los pendientes, sin ND ──
  IF COALESCE(v_conf, 0) = 0 AND v_pend IS NOT NULL THEN
    UPDATE pagos_clientes
    SET estado = 'rechazado',
        motivo_rechazo = 'Cheque rechazado: ' || v_motivo,
        fecha_confirmacion = now()
    WHERE id = ANY (v_pend);

    DELETE FROM imputaciones WHERE pago_id = ANY (v_pend) AND estado = 'pendiente';

    RETURN jsonb_build_object(
      'success', true, 'ya_rechazado', false,
      'pago_rechazado', true, 'pago_id', v_pend[1], 'pagos_rechazados', to_jsonb(v_pend),
      'nd_generada', false,
      'mensaje', 'Cheque rechazado. Los cobros estaban sin confirmar: se rechazaron (' || array_length(v_pend, 1) || '), sin generar débito.'
    );
  END IF;

  -- ── CASO 2: con cobro confirmado (o sin cobro rastreable) → ND entera al que entregó el cheque ──
  IF v_cheque.cliente_origen_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', true, 'ya_rechazado', false, 'nd_generada', false,
      'mensaje', 'Cheque rechazado. Sin cliente origen: no se generó débito automático.'
    );
  END IF;

  -- Cobros del mismo cheque que seguían pendientes: también se rechazan (el papel no vale)
  IF v_pend IS NOT NULL THEN
    UPDATE pagos_clientes
    SET estado = 'rechazado', motivo_rechazo = 'Cheque rechazado: ' || v_motivo, fecha_confirmacion = now()
    WHERE id = ANY (v_pend);
    DELETE FROM imputaciones WHERE pago_id = ANY (v_pend) AND estado = 'pendiente';
  END IF;

  v_total := abs(v_cheque.monto) + GREATEST(COALESCE(p_gastos, 0), 0);

  SELECT ultimo_numero + 1 INTO v_siguiente
  FROM numeracion_comprobantes
  WHERE tipo_comprobante = 'NDC' AND punto_venta = '0001'
  FOR UPDATE;

  IF v_siguiente IS NULL THEN
    v_siguiente := 1;
    INSERT INTO numeracion_comprobantes (tipo_comprobante, punto_venta, ultimo_numero)
    VALUES ('NDC', '0001', 1);
  ELSE
    UPDATE numeracion_comprobantes SET ultimo_numero = v_siguiente
    WHERE tipo_comprobante = 'NDC' AND punto_venta = '0001';
  END IF;

  v_numero_nd := '0001-' || lpad(v_siguiente::text, 8, '0');

  INSERT INTO comprobantes_venta (
    cliente_id, tipo_comprobante, numero_comprobante, fecha,
    total_neto, total_iva, total_factura, saldo_pendiente, estado_pago,
    observaciones, creado_por
  ) VALUES (
    v_cheque.cliente_origen_id, 'NDC', v_numero_nd,
    (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date,
    v_total, 0, v_total, v_total, 'pendiente',
    'Débito por cheque rechazado Nro. ' || COALESCE(v_cheque.numero, left(p_cheque_id::text, 8))
      || ' — ' || v_motivo
      || CASE WHEN COALESCE(p_gastos, 0) > 0
              THEN '. Incluye gastos bancarios: $' || p_gastos::text ELSE '' END,
    p_usuario_id
  ) RETURNING id INTO v_nd_id;

  PERFORM cc_postear(
    v_cheque.cliente_origen_id, 'nota_debito',
    v_total, 0,
    'comprobante_venta', v_nd_id,
    v_numero_nd,
    'Débito por cheque rechazado Nro. ' || COALESCE(v_cheque.numero, left(p_cheque_id::text, 8)),
    p_usuario_id
  );

  INSERT INTO kardex_contable (
    tipo_movimiento, concepto, monto, color,
    origen_tipo, origen_id, destino_tipo, destino_id, metodo,
    referencia_tipo, referencia_id, cheque_id, cliente_id, cobrador_id
  ) VALUES (
    'DEBITO_CHEQUE_RECHAZADO',
    'Cheque rechazado Nro. ' || COALESCE(v_cheque.numero, left(p_cheque_id::text, 8)) || ' — ND ' || v_numero_nd,
    v_total, v_cheque.color::text,
    'EN_CARTERA', p_cheque_id, 'CLIENTE', v_cheque.cliente_origen_id, 'CHEQUE_TERCERO',
    'cheque', p_cheque_id, p_cheque_id, v_cheque.cliente_origen_id, p_usuario_id
  );

  RETURN jsonb_build_object(
    'success', true, 'ya_rechazado', false,
    'pago_rechazado', v_pend IS NOT NULL,
    'nd_generada', true, 'nd_id', v_nd_id, 'numero_nd', v_numero_nd,
    'total_debitado', v_total,
    'mensaje', 'Cheque rechazado. Se generó ND ' || v_numero_nd || ' por $' || v_total::text || ' al cliente que entregó el cheque.'
  );
END;
$function$;
