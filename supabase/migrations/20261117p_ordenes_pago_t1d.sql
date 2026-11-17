-- ═════════════════════════════════════════════════════════════════════════════
-- ÓRDENES DE PAGO A PROVEEDORES — Tanda 1-D de la prueba integral de ENTRADA (17/11/2026)
--
-- UNA sola migración para toda la tanda. Reemplaza a las seis que se habían escrito por
-- separado (20261117p…u, nunca aplicadas): cada función está definida UNA sola vez, con
-- su versión final, así volver a correr este archivo nunca deja una versión vieja.
-- Seguro de re-ejecutar. No modifica ni borra ninguna fila existente.
--
-- REQUIERE (ya aplicadas): 20261116p_op_crear, 20261116q_op_confirmar_v6,
-- 20261117a_op_ganancias_bases_neto.
--
-- Qué trae (id del problema → pieza):
--   E-67  op_crear_y_confirmar: "Pagar ahora" crea y confirma en una transacción.
--   E-55  Pago parcial: el vencimiento guarda lo que falta (monto), el total
--         (monto_original) y lo pagado (monto_pagado). "Con este pago queda cancelado"
--         (Juan, 17/11): la diferencia va a monto_ajuste.
--   E-56  Una sola fuente de saldo: la cuenta corriente. comprobantes_compra.saldo_pendiente
--         se relee de ahí al confirmar y al anular. Las NC descontadas quedan asentadas.
--   E-57  Acumulado, retenido y fecha del certificado: por la fecha de la orden de pago.
--   E-58  Comprobante fiscal sin neto: base estimada (A: ÷ 1,21; B y C: el importe).
--   E-61  Períodos presentados ante ARCA: no se elimina una orden con certificado de ese
--         período, ni se crea o confirma una orden con retención fechada ahí.
--   E-62  Cheque propio / e-cheq con cuenta bancaria real; el banco baja al debitarse.
--   E-66  Una orden pendiente reserva los cheques de tercero que eligió.
--   Además: los vencimientos ESTIMADOS de una orden de compra no se pagan; las cuotas
--         recurrentes copian el importe completo aunque la última tenga un pago parcial.
--
-- Cómo están hechas las funciones que ya existían: cuerpo EXACTO de su versión anterior
-- con los cambios marcados en comentarios ("v2", "v7", "v10"…), generado por script.
--   op_confirmar            v11  (base: v6 de 20261116q)
--   op_anular               v5   (base: v3 de 20260806)
--   op_eliminar             v2   (base: 20260807)
--   op_crear                v4   (base: 20261116p)
--   op_normalizar_imputaciones v2, op_validar_imputaciones v2 (base: 20261116p)
--   op_ganancias_bases      v8   (base: v6 de 20261117a)
--   ganancias_calcular      v3   (base: v2 de 20261116p)
--   vencimientos_mantener        (base: 20261102) — solo de dónde copia el importe
-- ═════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF to_regprocedure('public.op_crear(jsonb, text)') IS NULL
     OR to_regprocedure('public.op_confirmar(uuid, uuid, uuid, uuid)') IS NULL
     OR to_regprocedure('public.op_movimiento_de(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'Faltan las funciones de 20261116p_op_crear.sql / 20261116q_op_confirmar_v6.sql. No se cambió nada.';
  END IF;
END $$;

-- ═════════════════════ 1. COLUMNAS Y TABLAS NUEVAS ═════════════════════
-- (Los datos para pagarle al proveedor — CBU, alias, titular, si acepta cheques de terceros
--  o e-cheq — son de 20261117m_proveedores_datos_compra.sql, de la Tanda 1-A. Acá no se crean.)

ALTER TABLE public.vencimientos
  ADD COLUMN IF NOT EXISTS monto_original numeric(20,2),
  ADD COLUMN IF NOT EXISTS monto_pagado numeric(20,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS monto_ajuste numeric(20,2) NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.vencimientos.monto_original IS
  'Importe completo del vencimiento cuando recibió un pago parcial por orden de pago (ahí "monto" pasa a ser lo que falta). NULL = nunca tuvo pago parcial: el importe es "monto".';
COMMENT ON COLUMN public.vencimientos.monto_pagado IS
  'Lo ya pagado de este vencimiento por órdenes de pago confirmadas.';
COMMENT ON COLUMN public.vencimientos.monto_ajuste IS
  'Descuento / ajuste: parte del vencimiento que NO se pagó y se dio por cancelada al pagarlo por orden de pago ("con este pago queda cancelado").';

ALTER TABLE public.ordenes_pago_imputaciones ADD COLUMN IF NOT EXISTS cancela_vencimiento boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.ordenes_pago_imputaciones.cancela_vencimiento IS
  'Solo vencimientos sin comprobante: true = con este pago el vencimiento queda cancelado aunque se pague menos (la diferencia va a vencimientos.monto_ajuste).';

ALTER TABLE public.ordenes_pago_detalle ADD COLUMN IF NOT EXISTS es_echeq boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.ordenes_pago_detalle.es_echeq IS
  'Cheque propio electrónico (e-cheq). La cuenta de la que sale va en cuenta_origen_tipo = BANCO / cuenta_origen_id.';
-- cheques.cuenta_banco_id ya existía ("para depósito"); en un cheque PROPIO es la cuenta emisora.
ALTER TABLE public.cheques ADD COLUMN IF NOT EXISTS cuenta_banco_id uuid;

-- Exportaciones de retenciones. Solo las marcadas "presentado" cierran el período.
CREATE TABLE IF NOT EXISTS public.retenciones_exportaciones (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  formato      varchar(10) NOT NULL,          -- 'txt' (SICORE)
  desde        date NOT NULL,
  hasta        date NOT NULL,
  certificados integer NOT NULL DEFAULT 0,
  total        numeric(20,2) NOT NULL DEFAULT 0,
  presentado   boolean NOT NULL DEFAULT false,
  usuario_id   uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.retenciones_exportaciones ADD COLUMN IF NOT EXISTS presentado boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_ret_exportaciones_hasta ON public.retenciones_exportaciones (formato, hasta);
ALTER TABLE public.retenciones_exportaciones ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.retenciones_exportaciones IS
  'Períodos de retenciones marcados como PRESENTADOS ante ARCA (TXT de SICORE). Hasta la última fecha presentada no se crean, confirman ni eliminan órdenes con retención: se anulan.';

-- Hasta qué día están presentadas las retenciones (NULL = nunca se presentó nada)
CREATE OR REPLACE FUNCTION public.retenciones_presentado_hasta()
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT max(x.hasta) FROM retenciones_exportaciones x WHERE x.formato = 'txt' AND x.presentado
$function$;
REVOKE ALL ON FUNCTION public.retenciones_presentado_hasta() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retenciones_presentado_hasta() TO service_role;


-- ═════════════════════ 2. CUENTA CORRIENTE: UNA SOLA FUENTE DE SALDO (E-56) ═════════════════════
-- saldo de una deuda  = su importe − lo imputado contra ella
-- saldo de un crédito = su importe + lo que ya se usó (nunca pasa de 0)

CREATE OR REPLACE FUNCTION public.cc_proveedor_saldo_movimiento(p_movimiento_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN cc.monto >= 0 THEN
      round(cc.monto - COALESCE((SELECT sum(i.monto_imputado) FROM imputaciones_proveedores i
                                  WHERE i.id_movimiento_documento = cc.id), 0), 2)
    ELSE
      LEAST(0, round(cc.monto + COALESCE((SELECT sum(i.monto_imputado) FROM imputaciones_proveedores i
                                           WHERE i.id_movimiento_pago = cc.id OR i.id_movimiento_documento = cc.id), 0), 2))
  END
  FROM cuenta_corriente_proveedores cc WHERE cc.id = p_movimiento_id
$function$;

-- Movimientos de la cuenta corriente que corresponden a un comprobante de compra:
-- los que lo referencian y, si no hay ninguno, los que entraron por mail (referencia 'gmail')
-- del mismo proveedor, con el mismo número y el mismo signo.
CREATE OR REPLACE FUNCTION public.cc_proveedor_movimientos_de_comprobante(p_comprobante_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT cc.id FROM cuenta_corriente_proveedores cc
   WHERE cc.referencia_tipo = 'comprobante_compra' AND cc.referencia_id = p_comprobante_id
  UNION
  SELECT cc.id
    FROM comprobantes_compra c
    JOIN cuenta_corriente_proveedores cc
      ON cc.referencia_tipo = 'gmail'
     AND cc.proveedor_id = c.proveedor_id
     AND NULLIF(btrim(cc.numero_comprobante), '') IS NOT NULL
     AND btrim(cc.numero_comprobante) = btrim(c.numero_comprobante)
     AND (cc.monto < 0) = (c.tipo_comprobante IN ('NC', 'NCA', 'NCB', 'NCC', 'Reversa'))
   WHERE c.id = p_comprobante_id
     AND NOT EXISTS (SELECT 1 FROM cuenta_corriente_proveedores d
                      WHERE d.referencia_tipo = 'comprobante_compra' AND d.referencia_id = p_comprobante_id)
$function$;

-- Copia el saldo de la cuenta corriente al comprobante. Sin movimiento no toca nada.
CREATE OR REPLACE FUNCTION public.cc_proveedor_sincronizar_comprobante(p_comprobante_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_saldo  numeric;
  v_total  numeric;
  v_n      int;
  v_estado text;
BEGIN
  SELECT count(*), COALESCE(sum(cc_proveedor_saldo_movimiento(cc.id)), 0), COALESCE(sum(cc.monto), 0)
  INTO v_n, v_saldo, v_total
  FROM cuenta_corriente_proveedores cc
  WHERE cc.id IN (SELECT cc_proveedor_movimientos_de_comprobante(p_comprobante_id));
  IF v_n = 0 THEN RETURN; END IF;

  v_saldo := round(v_saldo, 2);
  v_estado := CASE WHEN abs(v_saldo) <= 0.01 THEN 'pagado'
                   WHEN abs(v_saldo) < abs(v_total) - 0.01 THEN 'parcial'
                   ELSE 'pendiente' END;
  UPDATE comprobantes_compra
     SET saldo_pendiente = v_saldo, estado_pago = v_estado
   WHERE id = p_comprobante_id
     AND (saldo_pendiente IS DISTINCT FROM v_saldo OR estado_pago IS DISTINCT FROM v_estado);
END;
$function$;

-- Créditos (NC / Reversa) descontados en una orden → imputación en la cuenta corriente
CREATE OR REPLACE FUNCTION public.op_asentar_creditos(p_op_id uuid, p_pago_mov uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_imp record;
  v_mov uuid;
BEGIN
  IF p_pago_mov IS NULL THEN RETURN; END IF;
  FOR v_imp IN
    SELECT * FROM ordenes_pago_imputaciones WHERE orden_pago_id = p_op_id AND monto_imputado < 0
  LOOP
    v_mov := v_imp.movimiento_cc_id;
    IF v_mov IS NULL AND v_imp.comprobante_compra_id IS NOT NULL THEN
      -- incluye los créditos que entraron por mail (referencia 'gmail')
      SELECT cc.id INTO v_mov FROM cuenta_corriente_proveedores cc
       WHERE cc.id IN (SELECT cc_proveedor_movimientos_de_comprobante(v_imp.comprobante_compra_id)) AND cc.monto < 0
       ORDER BY cc.created_at DESC LIMIT 1;
    END IF;
    IF v_mov IS NULL THEN CONTINUE; END IF;
    INSERT INTO imputaciones_proveedores (id_movimiento_pago, id_movimiento_documento, monto_imputado, fecha_imputacion)
    SELECT p_pago_mov, v_mov, abs(v_imp.monto_imputado), now()
    WHERE NOT EXISTS (SELECT 1 FROM imputaciones_proveedores
                       WHERE id_movimiento_pago = p_pago_mov AND id_movimiento_documento = v_mov);
  END LOOP;
END;
$function$;

-- Comprobantes tocados por una orden → saldo releído de la cuenta corriente
CREATE OR REPLACE FUNCTION public.op_sincronizar_saldos_comprobantes(p_op_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_comp uuid;
BEGIN
  FOR v_comp IN
    SELECT DISTINCT x.comp FROM (
      SELECT COALESCE(i.comprobante_compra_id,
                      CASE WHEN cc.referencia_tipo = 'comprobante_compra' THEN cc.referencia_id END,
                      -- movimiento que entró por mail: el comprobante del mismo proveedor y número
                      (SELECT c.id FROM comprobantes_compra c
                        WHERE cc.referencia_tipo = 'gmail' AND c.proveedor_id = cc.proveedor_id
                          AND btrim(c.numero_comprobante) = btrim(cc.numero_comprobante)
                        ORDER BY c.created_at DESC LIMIT 1)) AS comp
        FROM ordenes_pago_imputaciones i
        LEFT JOIN cuenta_corriente_proveedores cc ON cc.id = i.movimiento_cc_id
       WHERE i.orden_pago_id = p_op_id
    ) x
    WHERE x.comp IS NOT NULL
  LOOP
    PERFORM cc_proveedor_sincronizar_comprobante(v_comp);
  END LOOP;
END;
$function$;

-- Emparejar comprobantes viejos. NO se ejecuta sola: cambia saldo_pendiente / estado_pago de
-- comprobantes de compra. Devuelve cuántos cambiaron.
--   select public.cc_proveedor_resincronizar_saldos();          -- todos
--   select public.cc_proveedor_resincronizar_saldos('<uuid>');  -- un proveedor
CREATE OR REPLACE FUNCTION public.cc_proveedor_resincronizar_saldos(p_proveedor_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_comp   record;
  v_cambio int := 0;
BEGIN
  FOR v_comp IN
    SELECT c.id, c.saldo_pendiente
      FROM comprobantes_compra c
     WHERE (p_proveedor_id IS NULL OR c.proveedor_id = p_proveedor_id)
       AND EXISTS (SELECT 1 FROM cc_proveedor_movimientos_de_comprobante(c.id))
  LOOP
    PERFORM cc_proveedor_sincronizar_comprobante(v_comp.id);
    IF (SELECT saldo_pendiente FROM comprobantes_compra WHERE id = v_comp.id) IS DISTINCT FROM v_comp.saldo_pendiente THEN
      v_cambio := v_cambio + 1;
    END IF;
  END LOOP;
  RETURN v_cambio;
END;
$function$;

REVOKE ALL ON FUNCTION public.cc_proveedor_saldo_movimiento(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cc_proveedor_saldo_movimiento(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.cc_proveedor_movimientos_de_comprobante(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cc_proveedor_movimientos_de_comprobante(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.cc_proveedor_sincronizar_comprobante(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cc_proveedor_sincronizar_comprobante(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.op_asentar_creditos(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.op_asentar_creditos(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.op_sincronizar_saldos_comprobantes(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.op_sincronizar_saldos_comprobantes(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.cc_proveedor_resincronizar_saldos(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cc_proveedor_resincronizar_saldos(uuid) TO service_role;


-- ═════════════════════ 3. PAGO PARCIAL DE VENCIMIENTOS (E-55) ═════════════════════
-- Pago total  → el vencimiento queda pagado y muestra su importe completo.
-- Pago parcial → sigue pendiente; "monto" pasa a ser lo que falta.
-- "Con este pago queda cancelado" → pagado; la diferencia va a monto_ajuste.
-- Regla que se mantiene siempre mientras hay pagos por orden:
--     monto_original = monto_pagado + monto_ajuste + (monto si está pendiente)

CREATE OR REPLACE FUNCTION public.op_vencimiento_aplicar_pago(p_vencimiento_id uuid, p_monto numeric, p_op_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v         vencimientos%ROWTYPE;
  v_cancela boolean;
  v_total   numeric;
  v_pagado  numeric;
BEGIN
  SELECT * INTO v FROM vencimientos WHERE id = p_vencimiento_id FOR UPDATE;
  IF NOT FOUND OR v.estado <> 'pendiente' THEN RETURN; END IF;

  SELECT COALESCE(bool_or(cancela_vencimiento), false) INTO v_cancela
  FROM ordenes_pago_imputaciones WHERE orden_pago_id = p_op_id AND vencimiento_id = p_vencimiento_id;

  v_total  := COALESCE(v.monto_original, v.monto, 0);
  v_pagado := COALESCE(v.monto_pagado, 0) + p_monto;

  IF p_monto >= COALESCE(v.monto, 0) - 0.01 OR v_cancela THEN
    -- Se pagó lo que faltaba (o más), o se pagó menos y se da por cancelado:
    -- pagado, vuelve a mostrar el importe completo y la diferencia queda como ajuste
    UPDATE vencimientos
       SET estado = 'pagado', orden_pago_id = p_op_id,
           monto = v_total,
           monto_pagado = v_pagado,
           monto_ajuste = GREATEST(0, round(v_total - v_pagado, 2)),
           updated_at = now()
     WHERE id = p_vencimiento_id;
  ELSE
    -- Pago parcial: sigue pendiente por lo que falta
    UPDATE vencimientos
       SET monto_original = COALESCE(monto_original, monto),
           monto = round(monto - p_monto, 2),
           monto_pagado = v_pagado,
           updated_at = now()
     WHERE id = p_vencimiento_id;
  END IF;
END;
$function$;

-- Devolver un pago (al anular la orden).
CREATE OR REPLACE FUNCTION public.op_vencimiento_revertir_pago(p_vencimiento_id uuid, p_monto numeric, p_op_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v        vencimientos%ROWTYPE;
  v_pagado numeric;
  v_total  numeric;
  v_falta  numeric;
  v_cancelaba boolean;
BEGIN
  SELECT * INTO v FROM vencimientos WHERE id = p_vencimiento_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT COALESCE(bool_or(cancela_vencimiento), false) INTO v_cancelaba
  FROM ordenes_pago_imputaciones WHERE orden_pago_id = p_op_id AND vencimiento_id = p_vencimiento_id;
  v_pagado := GREATEST(0, COALESCE(v.monto_pagado, 0) - p_monto);
  v_total  := COALESCE(v.monto_original, v.monto, 0);

  IF v.estado = 'pagado' AND v.orden_pago_id IS DISTINCT FROM p_op_id THEN
    -- Lo terminó de pagar OTRA orden y se anula una anterior (100 = A 40 + B 60, se anula A):
    -- lo que A había pagado vuelve a faltar ⇒ el vencimiento vuelve a PENDIENTE por eso.
    -- (Lo que se dio por cancelado con "queda cancelado" sigue cancelado.)
    v_falta := round(v_total - v_pagado - COALESCE(v.monto_ajuste, 0), 2);
    IF v_falta > 0.01 THEN
      UPDATE vencimientos
         SET estado = 'pendiente', orden_pago_id = NULL,
             monto_original = v_total, monto = v_falta, monto_pagado = v_pagado, updated_at = now()
       WHERE id = p_vencimiento_id;
    ELSE
      UPDATE vencimientos SET monto_pagado = v_pagado, updated_at = now() WHERE id = p_vencimiento_id;
    END IF;
    RETURN;
  END IF;

  -- Pendiente (pago parcial de esta orden), o pagado por ESTA orden (op_anular lo vuelve a
  -- pendiente a continuación). Si esta orden lo había dado por cancelado, el ajuste se va.
  UPDATE vencimientos
     SET monto_pagado = v_pagado,
         monto_ajuste = CASE WHEN estado = 'pagado' OR v_cancelaba THEN 0 ELSE monto_ajuste END,
         monto = CASE WHEN monto_original IS NOT NULL
                      THEN round(monto_original - v_pagado - CASE WHEN estado = 'pagado' OR v_cancelaba THEN 0 ELSE COALESCE(monto_ajuste, 0) END, 2)
                      ELSE monto END,
         monto_original = CASE WHEN v_pagado <= 0.01 AND (estado = 'pagado' OR v_cancelaba OR COALESCE(monto_ajuste, 0) <= 0.01) THEN NULL ELSE monto_original END,
         updated_at = now()
   WHERE id = p_vencimiento_id;
END;
$function$;

-- Vencimientos de un comprobante: siguen el saldo de la cuenta corriente.
-- p_marcar_pagado = true (al confirmar): saldo 0 ⇒ pagado; si no, pendiente por el saldo.
-- p_marcar_pagado = false (al anular): actualiza lo pendiente y, si el comprobante volvió a
--   tener saldo, REABRE los vencimientos que una orden de pago había dejado pagados.
--   (Los marcados pagados a mano desde el calendario, sin orden, no se tocan.)
CREATE OR REPLACE FUNCTION public.op_vencimientos_sincronizar_movimiento(p_movimiento_id uuid, p_op_id uuid, p_marcar_pagado boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cc    record;
  v_saldo numeric;
  v       record;
  v_total numeric;
BEGIN
  SELECT id, monto, referencia_tipo, referencia_id INTO v_cc FROM cuenta_corriente_proveedores WHERE id = p_movimiento_id;
  IF NOT FOUND THEN RETURN; END IF;
  v_saldo := cc_proveedor_saldo_movimiento(p_movimiento_id);

  FOR v IN
    SELECT ve.* FROM vencimientos ve
     WHERE (ve.estado = 'pendiente'
            OR (NOT p_marcar_pagado AND ve.estado = 'pagado' AND ve.orden_pago_id IS NOT NULL))
       AND ( (ve.referencia_tipo = 'cuenta_corriente' AND ve.referencia_id = p_movimiento_id)
          OR (ve.referencia_tipo = 'comprobante_compra' AND v_cc.referencia_tipo = 'comprobante_compra' AND ve.referencia_id = v_cc.referencia_id)
          OR ve.id IN (SELECT i.vencimiento_id FROM ordenes_pago_imputaciones i
                        WHERE i.orden_pago_id = p_op_id AND i.movimiento_cc_id = p_movimiento_id AND i.vencimiento_id IS NOT NULL) )
       FOR UPDATE OF ve
  LOOP
    v_total := COALESCE(v.monto_original, v.monto);
    IF v_saldo <= 0.01 THEN
      IF p_marcar_pagado AND v.estado = 'pendiente' THEN
        UPDATE vencimientos
           SET estado = 'pagado', orden_pago_id = p_op_id, monto = v_total, monto_pagado = v_total, updated_at = now()
         WHERE id = v.id;
      END IF;
    ELSIF v_saldo >= v_total - 0.01 THEN
      -- Al comprobante no le queda nada pagado: pendiente por el importe completo
      UPDATE vencimientos
         SET estado = 'pendiente',
             orden_pago_id = CASE WHEN estado = 'pagado' THEN NULL ELSE orden_pago_id END,
             monto = v_total, monto_original = NULL, monto_pagado = 0, updated_at = now()
       WHERE id = v.id
         AND (estado = 'pagado' OR monto_original IS NOT NULL OR COALESCE(monto_pagado, 0) <> 0);
    ELSE
      -- Pago parcial del comprobante: pendiente por el saldo
      UPDATE vencimientos
         SET estado = 'pendiente',
             orden_pago_id = CASE WHEN estado = 'pagado' THEN NULL ELSE orden_pago_id END,
             monto_original = v_total, monto = v_saldo, monto_pagado = round(v_total - v_saldo, 2), updated_at = now()
       WHERE id = v.id;
    END IF;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.op_vencimiento_aplicar_pago(uuid, numeric, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.op_vencimiento_aplicar_pago(uuid, numeric, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.op_vencimiento_revertir_pago(uuid, numeric, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.op_vencimiento_revertir_pago(uuid, numeric, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.op_vencimientos_sincronizar_movimiento(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.op_vencimientos_sincronizar_movimiento(uuid, uuid, boolean) TO service_role;


-- ═════════════════════ 4. RETENCIONES (E-57, E-58) ═════════════════════

CREATE OR REPLACE FUNCTION public.op_ganancias_bases(p_imputaciones jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item        jsonb;
  v_monto       numeric;
  v_comp_id     uuid;
  v_cc          record;
  v_venc        record;
  v_comp        record;
  v_base        numeric;
  v_tipo        text;
  v_detalle     jsonb := '[]'::jsonb;
  v_total       numeric := 0;
  v_etiqueta    text;
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_imputaciones, '[]'::jsonb))
  LOOP
    v_monto := COALESCE((v_item->>'monto_imputado')::numeric, 0);
    IF v_monto = 0 THEN CONTINUE; END IF;

    v_comp_id := NULL;
    v_etiqueta := 'imputación';

    IF v_item->>'comprobante_compra_id' IS NOT NULL THEN
      v_comp_id := (v_item->>'comprobante_compra_id')::uuid;
    ELSIF v_item->>'movimiento_cc_id' IS NOT NULL THEN
      SELECT referencia_tipo, referencia_id, descripcion INTO v_cc
      FROM cuenta_corriente_proveedores WHERE id = (v_item->>'movimiento_cc_id')::uuid;
      IF FOUND THEN
        v_etiqueta := COALESCE(v_cc.descripcion, 'mov. cuenta corriente');
        IF v_cc.referencia_tipo = 'comprobante_compra' THEN
          v_comp_id := v_cc.referencia_id;
        END IF;
      END IF;
    ELSIF v_item->>'vencimiento_id' IS NOT NULL THEN
      SELECT referencia_tipo, referencia_id, concepto INTO v_venc
      FROM vencimientos WHERE id = (v_item->>'vencimiento_id')::uuid;
      IF FOUND THEN
        v_etiqueta := COALESCE(v_venc.concepto, 'vencimiento');
        IF v_venc.referencia_tipo = 'cuenta_corriente' THEN
          SELECT referencia_tipo, referencia_id, descripcion INTO v_cc
          FROM cuenta_corriente_proveedores WHERE id = v_venc.referencia_id;
          IF FOUND AND v_cc.referencia_tipo = 'comprobante_compra' THEN
            v_comp_id := v_cc.referencia_id;
          END IF;
        END IF;
      END IF;
    END IF;

    -- v5: antes era "v_comp := NULL;", que deja el registro SIN forma: si la
    -- imputación no tiene comprobante (vencimiento cargado a mano, provisión,
    -- saldo inicial) las condiciones de abajo cortaban con
    -- 'record "v_comp" is not assigned yet'. Mismo efecto (todo en NULL), con forma.
    SELECT NULL::text AS tipo_comprobante, NULL::text AS numero_comprobante, NULL::numeric AS total_neto,
           NULL::date AS fecha_comprobante, NULL::numeric AS total
    INTO v_comp;
    IF v_comp_id IS NOT NULL THEN
      SELECT tipo_comprobante, numero_comprobante, total_neto, fecha_comprobante,
             COALESCE(NULLIF(abs(total_factura_declarado), 0), NULLIF(abs(total_calculado), 0)) AS total
      INTO v_comp
      FROM comprobantes_compra WHERE id = v_comp_id;
    END IF;

    IF v_comp_id IS NOT NULL AND v_comp.tipo_comprobante IN ('FA','FB','FC','ND','NDA','NDB','NDC')
       AND COALESCE(v_comp.total, 0) > 0 AND COALESCE(v_comp.total_neto, 0) > 0 THEN
      -- Factura fiscal: base positiva, neto prorrateado
      v_base := round(v_comp.total_neto * LEAST(abs(v_monto) / v_comp.total, 1), 2);
      v_tipo := 'factura';
      v_etiqueta := COALESCE(v_comp.numero_comprobante, v_etiqueta);
    ELSIF v_comp_id IS NOT NULL AND v_comp.tipo_comprobante IN ('FA','FB','FC','ND','NDA','NDB','NDC')
       AND COALESCE(v_comp.total, 0) > 0 THEN
      -- v7 (E-58): factura fiscal SIN neto cargado (pasa con comprobantes sin orden de compra).
      -- Antes la base quedaba en 0 y no se retenía nada. Ahora se estima y la pantalla avisa.
      -- v8: A (discrimina IVA) → lo imputado ÷ 1,21. B y C no discriminan IVA → lo imputado.
      v_base := round(LEAST(abs(v_monto), v_comp.total)
                      / CASE WHEN v_comp.tipo_comprobante IN ('FB','FC','NDB','NDC') THEN 1 ELSE 1.21 END, 2);
      v_tipo := 'estimada';
      v_etiqueta := COALESCE(v_comp.numero_comprobante, v_etiqueta);
    ELSIF v_comp_id IS NOT NULL AND v_comp.tipo_comprobante IN ('NC','NCA','NCB','NCC')
       AND COALESCE(v_comp.total, 0) > 0 AND COALESCE(v_comp.total_neto, 0) = 0 THEN
      -- v8: nota de crédito fiscal SIN neto cargado → base NEGATIVA estimada (misma regla)
      v_base := -round(LEAST(abs(v_monto), v_comp.total)
                       / CASE WHEN v_comp.tipo_comprobante IN ('NCB','NCC') THEN 1 ELSE 1.21 END, 2);
      v_tipo := 'estimada';
      v_etiqueta := COALESCE(v_comp.numero_comprobante, v_etiqueta);
    ELSIF v_comp_id IS NOT NULL AND v_comp.tipo_comprobante IN ('NC','NCA','NCB','NCC')
       AND COALESCE(v_comp.total, 0) > 0 AND COALESCE(v_comp.total_neto, 0) <> 0 THEN
      -- NC fiscal descontada: base NEGATIVA (retención neta de NC)
      v_base := -round(abs(v_comp.total_neto) * LEAST(abs(v_monto) / v_comp.total, 1), 2);
      v_tipo := 'nota_credito';
      v_etiqueta := COALESCE(v_comp.numero_comprobante, v_etiqueta);
    ELSIF v_comp_id IS NULL AND v_monto > 0
       AND NULLIF(v_item->>'vencimiento_id', '') IS NOT NULL
       AND COALESCE(NULLIF(v_item->>'retiene_ganancias', '')::boolean, false)
       AND NOT EXISTS (SELECT 1 FROM vencimientos vn
                       WHERE vn.id = (v_item->>'vencimiento_id')::uuid AND vn.canal = 'negro') THEN
      -- v5b (Juan, 16/11/2026): vencimiento cargado a mano en el que se contestó
      -- que SÍ corresponde retener. Canal negro: nunca.
      -- v6 (Juan, 17/11/2026): la base es el NETO sin IVA = importe pagado ÷ 1,21
      -- (antes era el importe completo).
      v_base := round(v_monto / 1.21, 2);
      v_tipo := 'vencimiento_con_retencion';
    ELSE
      -- Adquisición, Reversa, Remito, provisión de OC, pago a cuenta:
      -- SIN comprobante fiscal → JAMÁS integra la base de retención.
      v_base := 0;
      v_tipo := 'sin_retencion';
      IF v_comp_id IS NOT NULL THEN
        v_etiqueta := COALESCE(v_comp.numero_comprobante, v_etiqueta) || ' (' || COALESCE(v_comp.tipo_comprobante, '—') || ')';
      END IF;
    END IF;

    v_total := v_total + v_base;
    v_detalle := v_detalle || jsonb_build_object(
      'etiqueta', v_etiqueta, 'monto_imputado', v_monto, 'base', v_base, 'tipo', v_tipo,
      'vencimiento_id', NULLIF(v_item->>'vencimiento_id', ''),                                  -- v6
      'base_divisor', CASE WHEN v_tipo = 'vencimiento_con_retencion' THEN 1.21 END,             -- v6
      'tipo_comprobante', CASE WHEN v_comp_id IS NOT NULL THEN v_comp.tipo_comprobante END,
      'numero', CASE WHEN v_comp_id IS NOT NULL THEN v_comp.numero_comprobante END,
      'fecha_comprobante', CASE WHEN v_comp_id IS NOT NULL THEN to_char(v_comp.fecha_comprobante, 'YYYY-MM-DD') END
    );
  END LOOP;

  RETURN jsonb_build_object('total_base', GREATEST(0, round(v_total, 2)), 'detalle', v_detalle);
END;
$function$;

CREATE OR REPLACE FUNCTION public.ganancias_calcular(
  p_proveedor_id uuid,
  p_base         numeric,
  p_fecha        date DEFAULT NULL,
  p_excluir_op   uuid DEFAULT NULL   -- al recalcular una OP existente, excluirla del acumulado
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fecha       date := COALESCE(p_fecha, (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date);
  v_prov        record;
  v_reg         record;
  v_exclusion   numeric := 0;
  v_acum_previo numeric;
  v_ret_previa  numeric;
  v_alicuota    numeric;
  v_minimo      numeric;
  v_teorica     numeric;
  v_ret         numeric;
  v_motivo      text := NULL;
  v_exento      boolean := false;   -- v2
  v_exento_venc boolean := false;   -- v2
BEGIN
  SELECT nombre, cuit, regimen_ganancias, condicion_ganancias, ganancias_exento_hasta INTO v_prov   -- v2: + ganancias_exento_hasta
  FROM proveedores WHERE id = p_proveedor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ganancias_calcular: proveedor % no encontrado', p_proveedor_id;
  END IF;

  SELECT * INTO v_reg FROM retencion_regimenes
  WHERE clave = COALESCE(v_prov.regimen_ganancias, 'bienes')
    AND vigencia_desde <= v_fecha
    AND (vigencia_hasta IS NULL OR vigencia_hasta >= v_fecha)
  ORDER BY vigencia_desde DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ganancias_calcular: sin régimen vigente para clave % al %', v_prov.regimen_ganancias, v_fecha;
  END IF;

  -- Certificado de exclusión vigente
  SELECT COALESCE(max(porcentaje_excencion), 0) INTO v_exclusion
  FROM excenciones_impositivas
  WHERE proveedor_id = p_proveedor_id
    AND tipo = 'retencion_ganancias'
    AND activo = true
    AND fecha_desde <= v_fecha
    AND (fecha_hasta IS NULL OR fecha_hasta >= v_fecha);

  -- Acumulado del mes calendario (bases de OPs pagadas) y retenido previo
  SELECT COALESCE(sum(base_ganancias), 0) INTO v_acum_previo
  FROM ordenes_pago
  WHERE proveedor_id = p_proveedor_id
    AND estado = 'pagada'
    AND date_trunc('month', fecha) = date_trunc('month', v_fecha)
    AND (p_excluir_op IS NULL OR id <> p_excluir_op);

  -- v3 (E-57): lo ya retenido en el mes se cuenta por la FECHA DE LA ORDEN DE PAGO, la
  -- misma con la que se cuenta el acumulado de bases de arriba. Antes se contaba por la
  -- fecha del certificado (el día que se confirmó): una orden fechada a fin de mes y
  -- confirmada al mes siguiente sumaba su base en un mes y su retención en otro.
  SELECT COALESCE(sum(re.monto), 0) INTO v_ret_previa
  FROM retenciones_emitidas re
  LEFT JOIN ordenes_pago o ON o.id = re.orden_pago_id
  WHERE re.proveedor_id = p_proveedor_id
    AND re.estado = 'emitida'
    AND date_trunc('month', COALESCE(o.fecha, re.fecha)) = date_trunc('month', v_fecha)
    AND (p_excluir_op IS NULL OR re.orden_pago_id <> p_excluir_op);

  IF v_prov.condicion_ganancias = 'no_inscripto' THEN
    v_alicuota := v_reg.alicuota_no_inscripto;
    v_minimo := 0;  -- no inscriptos: sin monto no sujeto
  ELSE
    v_alicuota := v_reg.alicuota_inscripto;
    v_minimo := v_reg.minimo_no_sujeto;
  END IF;

  v_teorica := round((v_alicuota / 100.0) * GREATEST(0, v_acum_previo + COALESCE(p_base, 0) - v_minimo), 2);
  v_ret := GREATEST(0, round(v_teorica - v_ret_previa, 2));

  IF v_ret > 0 AND v_ret < v_reg.retencion_minima THEN
    v_motivo := 'menor a retención mínima (' || v_reg.retencion_minima || ')';
    v_ret := 0;
  ELSIF v_acum_previo + COALESCE(p_base, 0) <= v_minimo THEN
    v_motivo := 'acumulado del mes no supera el mínimo no sujeto';
  END IF;

  IF v_exclusion > 0 AND v_ret > 0 THEN
    v_ret := round(v_ret * (1 - v_exclusion / 100.0), 2);
    v_motivo := 'certificado de exclusión ' || v_exclusion || '%';
  END IF;

  -- ── v2: proveedor EXENTO de Ganancias (ficha: condición 'exento') ──
  -- Mientras la exención esté vigente (sin fecha o fecha >= día del pago) no se
  -- retiene nada, con motivo claro. Vencida, se calcula como inscripto y se avisa
  -- (exento_vencido). Un certificado de exclusión del 100 % vale lo mismo para el
  -- cartel de la pantalla (exento = true). El resto del cálculo no cambia.
  v_exento := v_prov.condicion_ganancias = 'exento'
              AND (v_prov.ganancias_exento_hasta IS NULL OR v_prov.ganancias_exento_hasta >= v_fecha);
  v_exento_venc := v_prov.condicion_ganancias = 'exento' AND NOT v_exento;
  IF v_exento THEN
    v_ret := 0;
    v_motivo := 'proveedor exento de Ganancias' ||
                COALESCE(' (certificado vigente hasta el ' || to_char(v_prov.ganancias_exento_hasta, 'DD/MM/YYYY') || ')', '');
  END IF;
  -- ── fin v2 ──

  RETURN jsonb_build_object(
    'proveedor', v_prov.nombre,
    'cuit', v_prov.cuit,
    'regimen_id', v_reg.id,
    'regimen', v_reg.clave,
    'regimen_descripcion', v_reg.descripcion,
    'condicion', v_prov.condicion_ganancias,
    'alicuota', v_alicuota,
    'minimo_no_sujeto', v_minimo,
    'retencion_minima', v_reg.retencion_minima,
    'exclusion_pct', v_exclusion,
    'base', round(COALESCE(p_base, 0), 2),
    'acumulado_previo_mes', v_acum_previo,
    'acumulado_total_mes', round(v_acum_previo + COALESCE(p_base, 0), 2),
    'retenido_previo_mes', v_ret_previa,
    'retencion', v_ret,
    'motivo_sin_retencion', v_motivo,
    'exento', (v_exento OR v_exclusion >= 100),                 -- v2
    'exento_hasta', v_prov.ganancias_exento_hasta,             -- v2
    'exento_vencido', v_exento_venc                            -- v2
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ganancias_calcular(uuid, numeric, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ganancias_calcular(uuid, numeric, date, uuid) TO authenticated, service_role;

-- ═════════════════════ 5. LA ORDEN DE PAGO ═════════════════════

CREATE OR REPLACE FUNCTION public.op_normalizar_imputaciones(p_imputaciones jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_item  jsonb;
  v_out   jsonb := '[]'::jsonb;
  v_monto numeric;
  v_mov   uuid;
  v_venc  uuid;
  v_comp  uuid;
BEGIN
  IF p_imputaciones IS NULL OR jsonb_typeof(p_imputaciones) <> 'array' THEN
    RETURN v_out;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_imputaciones)
  LOOP
    v_monto := round(COALESCE(NULLIF(v_item->>'monto_imputado', '')::numeric, 0), 2);
    IF v_monto = 0 THEN CONTINUE; END IF;

    v_mov  := NULLIF(v_item->>'movimiento_cc_id', '')::uuid;
    v_venc := NULLIF(v_item->>'vencimiento_id', '')::uuid;
    v_comp := NULLIF(v_item->>'comprobante_compra_id', '')::uuid;

    IF v_monto > 0 AND v_mov IS NULL THEN
      v_mov := op_movimiento_de(v_venc, v_comp);
    END IF;

    v_out := v_out || jsonb_build_object(
      'movimiento_cc_id', v_mov,
      'vencimiento_id', v_venc,
      'comprobante_compra_id', v_comp,
      'monto_imputado', v_monto,
      -- La respuesta "¿corresponde retener?" solo vale para un vencimiento sin comprobante
      'retiene_ganancias', CASE WHEN v_monto > 0 AND v_mov IS NULL AND v_venc IS NOT NULL
                                THEN NULLIF(v_item->>'retiene_ganancias', '')::boolean END,
      -- v2 (Juan, 17/11): "con este pago queda cancelado" — solo vencimiento sin comprobante
      'cancela_vencimiento', CASE WHEN v_monto > 0 AND v_mov IS NULL AND v_venc IS NOT NULL
                                  THEN COALESCE(NULLIF(v_item->>'cancela_vencimiento', '')::boolean, false) END
    );
  END LOOP;

  RETURN v_out;
END;
$function$;

CREATE OR REPLACE FUNCTION public.op_validar_imputaciones(
  p_proveedor_id      uuid,
  p_imputaciones      jsonb,
  p_excluir_op        uuid DEFAULT NULL,
  p_contar_pendientes boolean DEFAULT true
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_item      jsonb;
  v_monto     numeric;
  v_mov       uuid;
  v_venc      uuid;
  v_comp      uuid;
  v_cc        record;
  v_v         record;
  v_c         record;
  v_pagado    numeric;
  v_saldo     numeric;
  v_reservado numeric;
  v_ops       text;
  v_nombre    text;
BEGIN
  IF p_imputaciones IS NULL OR jsonb_typeof(p_imputaciones) <> 'array' THEN
    RETURN;
  END IF;

  -- La misma deuda por dos caminos
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_imputaciones) e
    WHERE NULLIF(e->>'movimiento_cc_id', '') IS NOT NULL
    GROUP BY e->>'movimiento_cc_id' HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'La misma deuda está elegida dos veces (por el comprobante y por su vencimiento). Dejala tildada una sola vez.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_imputaciones) e
    WHERE NULLIF(e->>'vencimiento_id', '') IS NOT NULL
    GROUP BY e->>'vencimiento_id' HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'El mismo vencimiento está elegido dos veces. Dejalo tildado una sola vez.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_imputaciones) e
    WHERE NULLIF(e->>'comprobante_compra_id', '') IS NOT NULL
      AND NULLIF(e->>'movimiento_cc_id', '') IS NULL
    GROUP BY e->>'comprobante_compra_id' HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'El mismo comprobante está elegido dos veces. Dejalo tildado una sola vez.';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_imputaciones)
  LOOP
    v_monto := round(COALESCE(NULLIF(v_item->>'monto_imputado', '')::numeric, 0), 2);
    IF v_monto = 0 THEN CONTINUE; END IF;
    v_mov  := NULLIF(v_item->>'movimiento_cc_id', '')::uuid;
    v_venc := NULLIF(v_item->>'vencimiento_id', '')::uuid;
    v_comp := NULLIF(v_item->>'comprobante_compra_id', '')::uuid;

    IF v_mov IS NULL AND v_venc IS NULL AND v_comp IS NULL THEN
      RAISE EXCEPTION 'Hay un renglón de % sin comprobante ni vencimiento: no se sabe qué paga.', fmt_moneda(v_monto);
    END IF;

    -- ───────────── DEUDA (monto > 0) ─────────────
    IF v_monto > 0 THEN

      IF v_mov IS NOT NULL THEN
        SELECT * INTO v_cc FROM cuenta_corriente_proveedores WHERE id = v_mov;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Uno de los comprobantes elegidos ya no existe en la cuenta corriente. Volvé a cargar la pantalla.';
        END IF;
        v_nombre := COALESCE(NULLIF(v_cc.numero_comprobante, ''), NULLIF(v_cc.descripcion, ''), 'comprobante');
        IF v_cc.proveedor_id IS DISTINCT FROM p_proveedor_id THEN
          RAISE EXCEPTION 'El comprobante % es de otro proveedor.', v_nombre;
        END IF;
        IF v_cc.monto <= 0 THEN
          RAISE EXCEPTION 'El movimiento % no es una deuda (es un pago o un crédito): no se puede pagar.', v_nombre;
        END IF;

        SELECT COALESCE(sum(monto_imputado), 0) INTO v_pagado
        FROM imputaciones_proveedores WHERE id_movimiento_documento = v_mov;
        v_saldo := round(v_cc.monto - v_pagado, 2);

        v_reservado := 0; v_ops := NULL;
        IF p_contar_pendientes THEN
          SELECT COALESCE(sum(i.monto_imputado), 0), string_agg(DISTINCT o.numero_op, ', ')
          INTO v_reservado, v_ops
          FROM ordenes_pago_imputaciones i
          JOIN ordenes_pago o ON o.id = i.orden_pago_id
          WHERE o.estado = 'pendiente'
            AND i.monto_imputado > 0
            AND (p_excluir_op IS NULL OR o.id <> p_excluir_op)
            AND (i.movimiento_cc_id = v_mov
                 OR (i.movimiento_cc_id IS NULL
                     AND op_movimiento_de(i.vencimiento_id, i.comprobante_compra_id) = v_mov));
        END IF;

        IF v_saldo <= 0.01 THEN
          RAISE EXCEPTION 'El comprobante % ya figura pagado en la cuenta corriente: no se puede volver a pagar.', v_nombre;
        END IF;
        IF v_monto > v_saldo - v_reservado + 0.01 THEN
          IF v_reservado > 0 THEN
            RAISE EXCEPTION 'El comprobante % tiene un saldo de % y ya hay % tomados por la orden de pago pendiente %: quedan % para pagar y se quieren imputar %. Confirmá o eliminá esa orden primero.',
              v_nombre, fmt_moneda(v_saldo), fmt_moneda(v_reservado), v_ops,
              fmt_moneda(GREATEST(0, v_saldo - v_reservado)), fmt_moneda(v_monto);
          END IF;
          RAISE EXCEPTION 'Al comprobante % le quedan % por pagar y se quieren imputar %. No se puede pagar de más.',
            v_nombre, fmt_moneda(v_saldo), fmt_moneda(v_monto);
        END IF;

        -- Saldo propio del comprobante (cuando lo lleva): tampoco se lo puede pasar
        IF v_cc.referencia_tipo = 'comprobante_compra' AND v_cc.referencia_id IS NOT NULL THEN
          SELECT saldo_pendiente, numero_comprobante INTO v_c
          FROM comprobantes_compra WHERE id = v_cc.referencia_id;
          IF FOUND AND COALESCE(v_c.saldo_pendiente, 0) > 0 AND v_monto > v_c.saldo_pendiente + 0.01 THEN
            RAISE EXCEPTION 'El comprobante % tiene % de saldo pendiente y se quieren imputar %. No se puede pagar de más.',
              COALESCE(NULLIF(v_c.numero_comprobante, ''), v_nombre), fmt_moneda(v_c.saldo_pendiente), fmt_moneda(v_monto);
          END IF;
        END IF;
      END IF;

      IF v_venc IS NOT NULL THEN
        SELECT * INTO v_v FROM vencimientos WHERE id = v_venc;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Uno de los vencimientos elegidos ya no existe. Volvé a cargar la pantalla.';
        END IF;
        v_nombre := COALESCE(NULLIF(v_v.concepto, ''), 'vencimiento');
        IF v_v.proveedor_id IS NOT NULL AND v_v.proveedor_id IS DISTINCT FROM p_proveedor_id THEN
          RAISE EXCEPTION 'El vencimiento "%" es de otro proveedor.', v_nombre;
        END IF;
        -- v2: el vencimiento ESTIMADO de una orden de compra todavía no tiene factura: no se paga
        IF COALESCE(v_v.es_estimado, false) AND v_v.referencia_tipo = 'orden_compra' THEN
          RAISE EXCEPTION 'El vencimiento "%" es un ESTIMADO de una orden de compra: todavía no hay factura, no se puede pagar. Cuando se valide la factura aparece el vencimiento real.', v_nombre;
        END IF;
        IF v_v.estado IN ('pagado', 'cancelado') THEN
          RAISE EXCEPTION 'El vencimiento "%" ya figura %: no se puede volver a pagar.', v_nombre, v_v.estado;
        END IF;

        v_reservado := 0; v_ops := NULL;
        IF p_contar_pendientes THEN
          SELECT COALESCE(sum(i.monto_imputado), 0), string_agg(DISTINCT o.numero_op, ', ')
          INTO v_reservado, v_ops
          FROM ordenes_pago_imputaciones i
          JOIN ordenes_pago o ON o.id = i.orden_pago_id
          WHERE o.estado = 'pendiente'
            AND i.monto_imputado > 0
            AND i.vencimiento_id = v_venc
            AND (p_excluir_op IS NULL OR o.id <> p_excluir_op);
        END IF;

        -- Vencimiento sin comprobante: NO hay tope de importe. Se puede pagar más
        -- (o menos) que lo que dice el vencimiento: la diferencia queda como
        -- ajuste o entrega a cuenta del proveedor (decisión de Juan, 16/11/2026).
        -- Lo único que no se puede es tenerlo en dos órdenes a la vez.
        IF v_reservado > 0 THEN
          RAISE EXCEPTION 'El vencimiento "%" ya está en la orden de pago pendiente %. Confirmá o eliminá esa orden primero.', v_nombre, v_ops;
        END IF;
      END IF;

      -- Deuda directa a un comprobante que no tiene movimiento de CC
      IF v_mov IS NULL AND v_venc IS NULL AND v_comp IS NOT NULL THEN
        SELECT proveedor_id, saldo_pendiente, numero_comprobante INTO v_c
        FROM comprobantes_compra WHERE id = v_comp;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Uno de los comprobantes elegidos ya no existe. Volvé a cargar la pantalla.';
        END IF;
        v_nombre := COALESCE(NULLIF(v_c.numero_comprobante, ''), 'comprobante');
        IF v_c.proveedor_id IS DISTINCT FROM p_proveedor_id THEN
          RAISE EXCEPTION 'El comprobante % es de otro proveedor.', v_nombre;
        END IF;
        v_reservado := 0;
        IF p_contar_pendientes THEN
          SELECT COALESCE(sum(i.monto_imputado), 0) INTO v_reservado
          FROM ordenes_pago_imputaciones i
          JOIN ordenes_pago o ON o.id = i.orden_pago_id
          WHERE o.estado = 'pendiente' AND i.monto_imputado > 0
            AND i.comprobante_compra_id = v_comp
            AND (p_excluir_op IS NULL OR o.id <> p_excluir_op);
        END IF;
        IF v_monto > COALESCE(v_c.saldo_pendiente, 0) - v_reservado + 0.01 THEN
          RAISE EXCEPTION 'Al comprobante % le quedan % por pagar y se quieren imputar %. No se puede pagar de más.',
            v_nombre, fmt_moneda(GREATEST(0, COALESCE(v_c.saldo_pendiente, 0) - v_reservado)), fmt_moneda(v_monto);
        END IF;
      END IF;

    -- ───────────── CRÉDITO (monto < 0): NC / Reversa que se descuenta ─────────────
    ELSE
      IF v_comp IS NULL AND v_mov IS NOT NULL THEN
        SELECT referencia_id INTO v_comp FROM cuenta_corriente_proveedores
        WHERE id = v_mov AND referencia_tipo = 'comprobante_compra';
      END IF;
      IF v_comp IS NOT NULL THEN
        SELECT proveedor_id, saldo_pendiente, numero_comprobante, tipo_comprobante INTO v_c
        FROM comprobantes_compra WHERE id = v_comp;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Uno de los créditos elegidos ya no existe. Volvé a cargar la pantalla.';
        END IF;
        v_nombre := COALESCE(v_c.tipo_comprobante || ' ', '') || COALESCE(NULLIF(v_c.numero_comprobante, ''), 'crédito');
        IF v_c.proveedor_id IS DISTINCT FROM p_proveedor_id THEN
          RAISE EXCEPTION 'El crédito % es de otro proveedor.', v_nombre;
        END IF;
        v_saldo := GREATEST(0, -COALESCE(v_c.saldo_pendiente, 0));   -- disponible, en positivo
        v_reservado := 0; v_ops := NULL;
        IF p_contar_pendientes THEN
          SELECT COALESCE(sum(abs(i.monto_imputado)), 0), string_agg(DISTINCT o.numero_op, ', ')
          INTO v_reservado, v_ops
          FROM ordenes_pago_imputaciones i
          JOIN ordenes_pago o ON o.id = i.orden_pago_id
          WHERE o.estado = 'pendiente' AND i.monto_imputado < 0
            AND i.comprobante_compra_id = v_comp
            AND (p_excluir_op IS NULL OR o.id <> p_excluir_op);
        END IF;
        IF abs(v_monto) > v_saldo - v_reservado + 0.01 THEN
          IF v_reservado > 0 THEN
            RAISE EXCEPTION 'El crédito % tiene % disponibles y % ya están tomados por la orden de pago pendiente %: se quieren usar %.',
              v_nombre, fmt_moneda(v_saldo), fmt_moneda(v_reservado), v_ops, fmt_moneda(abs(v_monto));
          END IF;
          RAISE EXCEPTION 'El crédito % tiene % disponibles y se quieren usar %.',
            v_nombre, fmt_moneda(v_saldo), fmt_moneda(abs(v_monto));
        END IF;
      END IF;
    END IF;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.op_crear(p_payload jsonb, p_usuario text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_prov        uuid := NULLIF(p_payload->>'proveedor_id', '')::uuid;
  v_fecha       date := COALESCE(NULLIF(p_payload->>'fecha', '')::date, public.hoy_ar());
  v_clave       uuid := NULLIF(p_payload->>'clave', '')::uuid;
  v_medios      jsonb := p_payload->'medios_pago';
  v_manual      boolean := COALESCE((p_payload->>'ganancias_manual')::boolean, false);
  v_motivo      text := NULLIF(btrim(COALESCE(p_payload->>'ganancias_motivo', '')), '');
  v_imps        jsonb;
  v_calc        jsonb;
  v_base        numeric;
  v_ret_gan     numeric;
  v_ret_iibb    numeric := round(COALESCE(NULLIF(p_payload->>'retencion_iibb', '')::numeric, 0), 2);
  v_ret_iva     numeric := round(COALESCE(NULLIF(p_payload->>'retencion_iva', '')::numeric, 0), 2);
  v_ret_suss    numeric := round(COALESCE(NULLIF(p_payload->>'retencion_suss', '')::numeric, 0), 2);
  v_total_ret   numeric;
  v_total_med   numeric;
  v_total_imp   numeric;
  v_total_cred  numeric;
  v_neto_esp    numeric;
  v_monto_total numeric;
  v_m           jsonb;
  v_medio       text;
  v_cheque      record;
  v_numero      text;
  v_op          ordenes_pago%ROWTYPE;
  v_sin_resp    text;
  v_reserva     text;   -- v3
  v_presentado  date;   -- v4
BEGIN
  IF v_prov IS NULL THEN
    RAISE EXCEPTION 'Proveedor es obligatorio';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM proveedores WHERE id = v_prov) THEN
    RAISE EXCEPTION 'El proveedor no existe';
  END IF;
  IF v_medios IS NULL OR jsonb_typeof(v_medios) <> 'array' OR jsonb_array_length(v_medios) = 0 THEN
    RAISE EXCEPTION 'Debe agregar al menos un medio de pago';
  END IF;

  -- Una creación por proveedor a la vez (la validación de saldos lee OP pendientes)
  PERFORM pg_advisory_xact_lock(hashtext('op_proveedor:' || v_prov::text));

  -- Doble click / reintento: devolver la que ya se creó
  IF v_clave IS NOT NULL THEN
    SELECT * INTO v_op FROM ordenes_pago WHERE clave_idempotencia = v_clave;
    IF FOUND THEN
      RETURN to_jsonb(v_op) || jsonb_build_object('ya_existia', true);
    END IF;
  END IF;

  -- E-52 + E-54
  v_imps := op_normalizar_imputaciones(p_payload->'imputaciones');
  PERFORM op_validar_imputaciones(v_prov, v_imps, NULL, true);

  -- Vencimiento sin comprobante: hay que contestar si corresponde retener
  -- Ganancias (no hay valor por defecto). No se pregunta si el proveedor está
  -- exento ni si el vencimiento es de canal negro (nunca retiene).
  IF NOT COALESCE((ganancias_calcular(v_prov, 0, v_fecha)->>'exento')::boolean, false) THEN
    SELECT string_agg('"' || COALESCE(vn.concepto, 'vencimiento') || '"', ', ') INTO v_sin_resp
    FROM jsonb_array_elements(v_imps) e
    JOIN vencimientos vn ON vn.id = NULLIF(e->>'vencimiento_id', '')::uuid
    WHERE NULLIF(e->>'movimiento_cc_id', '') IS NULL
      AND (e->>'monto_imputado')::numeric > 0
      AND vn.canal IS DISTINCT FROM 'negro'
      AND NULLIF(e->>'retiene_ganancias', '') IS NULL;
    IF v_sin_resp IS NOT NULL THEN
      RAISE EXCEPTION 'Falta contestar si corresponde retener Ganancias en: %. Elegí Sí o No en cada vencimiento.', v_sin_resp;
    END IF;
  END IF;

  -- Retención de Ganancias RG 830
  v_calc := op_ganancias_preview(v_prov, v_imps, v_fecha);
  v_base := COALESCE((v_calc->>'base')::numeric, 0);
  v_ret_gan := COALESCE((v_calc->>'retencion')::numeric, 0);
  IF v_manual THEN
    IF v_motivo IS NULL THEN
      RAISE EXCEPTION 'El ajuste manual de la retención requiere un motivo';
    END IF;
    v_ret_gan := round(COALESCE(NULLIF(p_payload->>'retencion_ganancias', '')::numeric, 0), 2);
  END IF;
  -- v4: una orden que entra en el cálculo de retenciones (tiene base o retiene) no puede
  -- llevar una fecha de un período que ya se presentó ante ARCA (SICORE).
  v_presentado := retenciones_presentado_hasta();
  IF v_presentado IS NOT NULL AND v_fecha <= v_presentado AND (v_base > 0 OR v_ret_gan > 0) THEN
    RAISE EXCEPTION 'La fecha de la orden (%) cae en un período de retenciones que ya se presentó ante ARCA (hasta el %). Usá una fecha posterior.',
      to_char(v_fecha, 'DD/MM/YYYY'), to_char(v_presentado, 'DD/MM/YYYY');
  END IF;
  IF v_ret_gan < 0 OR v_ret_iibb < 0 OR v_ret_iva < 0 OR v_ret_suss < 0 THEN
    RAISE EXCEPTION 'Las retenciones no pueden ser negativas';
  END IF;
  v_total_ret := v_ret_gan + v_ret_iibb + v_ret_iva + v_ret_suss;

  -- Medios de pago
  v_total_med := 0;
  FOR v_m IN SELECT * FROM jsonb_array_elements(v_medios)
  LOOP
    v_medio := v_m->>'medio';
    IF v_medio IS NULL OR v_medio NOT IN ('efectivo', 'cheque', 'cheque_propio', 'transferencia', 'deposito') THEN
      RAISE EXCEPTION 'Medio de pago desconocido: %', COALESCE(v_medio, '(vacío)');
    END IF;
    IF COALESCE(NULLIF(v_m->>'monto', '')::numeric, 0) < 0 THEN
      RAISE EXCEPTION 'Un medio de pago tiene importe negativo';
    END IF;
    IF v_medio = 'cheque' AND NULLIF(v_m->>'cheque_id', '') IS NOT NULL THEN
      SELECT numero, estado INTO v_cheque FROM cheques WHERE id = (v_m->>'cheque_id')::uuid;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Uno de los cheques elegidos ya no existe. Volvé a cargar la pantalla.';
      END IF;
      IF v_cheque.estado::text <> 'EN_CARTERA' THEN
        RAISE EXCEPTION 'El cheque % ya no está en cartera (está %). Sacalo del pago.', v_cheque.numero, v_cheque.estado;
      END IF;
      -- v3 (E-66): una orden PENDIENTE reserva los cheques de tercero que eligió
      SELECT string_agg(DISTINCT o.numero_op, ', ') INTO v_reserva
      FROM ordenes_pago_detalle d JOIN ordenes_pago o ON o.id = d.orden_pago_id
      WHERE o.estado = 'pendiente' AND d.cheque_id = (v_m->>'cheque_id')::uuid;
      IF v_reserva IS NOT NULL THEN
        RAISE EXCEPTION 'El cheque % ya está reservado por la orden de pago pendiente %. Elegí otro, o confirmá o eliminá esa orden.', v_cheque.numero, v_reserva;
      END IF;
      IF (SELECT count(*) FROM jsonb_array_elements(v_medios) x WHERE x->>'cheque_id' = v_m->>'cheque_id') > 1 THEN
        RAISE EXCEPTION 'El cheque % está dos veces en el pago.', v_cheque.numero;
      END IF;
    END IF;
    -- v3 (E-62): cheque propio / e-cheq — hacen falta el número y la fecha de pago
    IF v_medio = 'cheque_propio' OR (v_medio = 'cheque' AND NULLIF(v_m->>'cheque_id', '') IS NULL) THEN
      IF NULLIF(btrim(COALESCE(v_m->>'cheque_numero', '')), '') IS NULL THEN
        RAISE EXCEPTION 'Al cheque propio de % le falta el número.', fmt_moneda(COALESCE(NULLIF(v_m->>'monto', '')::numeric, 0));
      END IF;
      IF NULLIF(v_m->>'cheque_fecha_vencimiento', '') IS NULL THEN
        RAISE EXCEPTION 'Al cheque propio N° % le falta la fecha de pago.', v_m->>'cheque_numero';
      END IF;
      IF NULLIF(v_m->>'cuenta_origen_id', '') IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM cuentas_bancarias WHERE id = (v_m->>'cuenta_origen_id')::uuid) THEN
        RAISE EXCEPTION 'La cuenta bancaria del cheque propio N° % no existe.', v_m->>'cheque_numero';
      END IF;
    END IF;
    v_total_med := v_total_med + round(COALESCE(NULLIF(v_m->>'monto', '')::numeric, 0), 2);
  END LOOP;
  IF v_total_med <= 0 THEN
    RAISE EXCEPTION 'El total de medios de pago debe ser mayor a 0';
  END IF;

  SELECT COALESCE(sum((e->>'monto_imputado')::numeric), 0),
         COALESCE(sum(GREATEST(0, -(e->>'monto_imputado')::numeric)), 0)
  INTO v_total_imp, v_total_cred
  FROM jsonb_array_elements(v_imps) e;

  -- Cuadre y totales (regla única, ver cabecera del archivo)
  IF v_total_imp > 0 THEN
    v_neto_esp := round(v_total_imp - v_total_ret, 2);
    IF abs(v_total_med - v_neto_esp) > 0.01 THEN
      RAISE EXCEPTION 'No cuadra: imputado % − retenciones % = neto %, pero los medios suman %',
        fmt_moneda(v_total_imp), fmt_moneda(v_total_ret), fmt_moneda(v_neto_esp), fmt_moneda(v_total_med);
    END IF;
    v_monto_total := v_total_imp;
  ELSE
    -- Pago a cuenta (sin imputar): cancela de la deuda lo pagado + lo retenido
    v_monto_total := v_total_med + v_total_ret;
  END IF;

  v_numero := op_siguiente_numero();

  INSERT INTO ordenes_pago (
    numero_op, proveedor_id, fecha, monto_total, estado, observaciones,
    retencion_ganancias, retencion_iibb, retencion_iva, retencion_suss,
    total_retenciones, neto_a_pagar, base_ganancias, total_creditos,
    ganancias_ajuste_manual, ganancias_motivo, usuario_creador, clave_idempotencia
  ) VALUES (
    v_numero, v_prov, v_fecha, v_monto_total, 'pendiente', NULLIF(btrim(COALESCE(p_payload->>'observaciones', '')), ''),
    v_ret_gan, v_ret_iibb, v_ret_iva, v_ret_suss,
    v_total_ret, v_total_med, v_base, v_total_cred,
    v_manual, CASE WHEN v_manual THEN v_motivo END, left(COALESCE(NULLIF(p_usuario, ''), 'admin'), 100), v_clave
  ) RETURNING * INTO v_op;

  INSERT INTO ordenes_pago_detalle (
    orden_pago_id, medio, monto, cheque_id, cheque_banco, cheque_numero, cheque_fecha_vencimiento,
    banco_destino, numero_cuenta, cbu, numero_transferencia, fecha_transferencia, observaciones,
    cuenta_origen_tipo, cuenta_origen_id, es_echeq   -- v3: + es_echeq
  )
  SELECT
    v_op.id,
    -- op_confirmar reconoce el cheque propio como medio 'cheque' SIN cheque_id
    CASE WHEN e->>'medio' = 'cheque_propio' THEN 'cheque' ELSE e->>'medio' END,
    round(COALESCE(NULLIF(e->>'monto', '')::numeric, 0), 2),
    NULLIF(e->>'cheque_id', '')::uuid,
    NULLIF(e->>'cheque_banco', ''),
    NULLIF(e->>'cheque_numero', ''),
    NULLIF(e->>'cheque_fecha_vencimiento', '')::date,
    NULLIF(e->>'banco_destino', ''),
    NULLIF(e->>'numero_cuenta', ''),
    NULLIF(e->>'cbu', ''),
    NULLIF(e->>'numero_transferencia', ''),
    NULLIF(e->>'fecha_transferencia', '')::date,
    NULLIF(e->>'observaciones', ''),
    NULLIF(e->>'cuenta_origen_tipo', ''),
    NULLIF(e->>'cuenta_origen_id', '')::uuid,
    COALESCE(NULLIF(e->>'es_echeq', '')::boolean, false)   -- v3
  FROM jsonb_array_elements(v_medios) e;

  INSERT INTO ordenes_pago_imputaciones (orden_pago_id, movimiento_cc_id, vencimiento_id, comprobante_compra_id, monto_imputado, retiene_ganancias, cancela_vencimiento)   -- v2: + cancela_vencimiento
  SELECT
    v_op.id,
    NULLIF(e->>'movimiento_cc_id', '')::uuid,
    NULLIF(e->>'vencimiento_id', '')::uuid,
    NULLIF(e->>'comprobante_compra_id', '')::uuid,
    (e->>'monto_imputado')::numeric,
    NULLIF(e->>'retiene_ganancias', '')::boolean,
    COALESCE(NULLIF(e->>'cancela_vencimiento', '')::boolean, false)   -- v2
  FROM jsonb_array_elements(v_imps) e;

  RETURN to_jsonb(v_op) || jsonb_build_object('ya_existia', false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.op_confirmar(p_op_id uuid, p_usuario_id uuid, p_caja_id uuid DEFAULT NULL::uuid, p_cuenta_banco_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_op        ordenes_pago%ROWTYPE;
  v_det       record;
  v_imp       record;
  v_caja      uuid := p_caja_id;
  v_caja_linea  uuid;
  v_banco_linea uuid;
  v_pago_mov  uuid;
  v_cheque    cheques%ROWTYPE;
  v_cheque_id uuid;
  v_kardex    int := 0;
  v_hoy_ar    date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_cc_ids    uuid[] := '{}';
  v_calc      jsonb;
  v_ret_calc  numeric;
  v_num_cert  text;
  v_cert_id   uuid;
  v_comp_id   uuid;
  v_saldo     numeric;
BEGIN
  SELECT * INTO v_op FROM ordenes_pago WHERE id = p_op_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'op_confirmar: orden de pago % no encontrada', p_op_id;
  END IF;
  IF v_op.estado = 'pagada' THEN
    RETURN jsonb_build_object('success', true, 'ya_confirmada', true);
  END IF;
  IF v_op.estado = 'anulada' THEN
    RAISE EXCEPTION 'op_confirmar: la OP está anulada';
  END IF;
  -- v6 (E-73): solo se confirma una orden PENDIENTE (antes una cancelada pasaba)
  IF v_op.estado IS DISTINCT FROM 'pendiente' THEN
    RAISE EXCEPTION 'La orden de pago % está %: solo se puede confirmar una orden pendiente.', v_op.numero_op, COALESCE(v_op.estado, 'sin estado');
  END IF;

  -- v11: no se emite un certificado con fecha de un período ya presentado ante ARCA
  IF COALESCE(v_op.retencion_ganancias, 0) > 0 AND v_op.fecha <= COALESCE(retenciones_presentado_hasta(), '0001-01-01'::date) THEN
    RAISE EXCEPTION 'La orden % tiene fecha % y retención de Ganancias, pero ese período ya se presentó ante ARCA. Eliminá la orden y armala de nuevo con la fecha de hoy.',
      v_op.numero_op, to_char(v_op.fecha, 'DD/MM/YYYY');
  END IF;

  -- ── v6 (E-52 / E-54) ──────────────────────────────────────────────────────
  -- Una confirmación por proveedor a la vez (misma llave que op_crear): dos OP
  -- sobre la misma factura no pueden validar el saldo al mismo tiempo.
  PERFORM pg_advisory_xact_lock(hashtext('op_proveedor:' || v_op.proveedor_id::text));

  -- E-52: una deuda imputada solo por su vencimiento se completa con el
  -- movimiento de CC del comprobante (OP creadas antes de op_crear), así el
  -- paso 3 baja la factura en la cuenta corriente. Sin comprobante detrás no
  -- cambia nada: se paga contra el vencimiento, igual que antes.
  UPDATE ordenes_pago_imputaciones
  SET movimiento_cc_id = op_movimiento_de(vencimiento_id, comprobante_compra_id)
  WHERE orden_pago_id = p_op_id
    AND monto_imputado > 0
    AND movimiento_cc_id IS NULL
    AND op_movimiento_de(vencimiento_id, comprobante_compra_id) IS NOT NULL;
  -- ── fin v6 ────────────────────────────────────────────────────────────────

  -- v5: solo exige banco global si alguna transferencia NO trae su origen propio
  IF EXISTS (
       SELECT 1 FROM ordenes_pago_detalle d
       WHERE d.orden_pago_id = p_op_id AND d.medio = 'transferencia'
         AND NOT (d.cuenta_origen_tipo = 'BANCO' AND d.cuenta_origen_id IS NOT NULL)
     )
     AND p_cuenta_banco_id IS NULL THEN
    RAISE EXCEPTION 'op_confirmar: la OP incluye transferencias sin banco de origen — indicá desde qué cuenta bancaria salen (p_cuenta_banco_id)';
  END IF;
  IF v_caja IS NULL THEN
    SELECT id INTO v_caja FROM cajas_financieras WHERE nombre = 'Caja Grande' AND activo LIMIT 1;
  END IF;

  IF COALESCE(v_op.base_ganancias, 0) > 0 AND NOT COALESCE(v_op.ganancias_ajuste_manual, false) THEN
    v_calc := ganancias_calcular(v_op.proveedor_id, v_op.base_ganancias, v_op.fecha, p_op_id);
    v_ret_calc := (v_calc->>'retencion')::numeric;
    IF abs(v_ret_calc - COALESCE(v_op.retencion_ganancias, 0)) > 0.01 THEN
      RAISE EXCEPTION 'op_confirmar: la retención calculada cambió desde que se creó la OP (era %, ahora corresponde % por el acumulado del mes). Anulá y recreá la OP, o ajustá manualmente con motivo.',
        COALESCE(v_op.retencion_ganancias, 0), v_ret_calc;
    END IF;
  ELSIF COALESCE(v_op.retencion_ganancias, 0) > 0 THEN
    v_calc := ganancias_calcular(v_op.proveedor_id, COALESCE(v_op.base_ganancias, 0), v_op.fecha, p_op_id);
  END IF;

  -- ── 1. CC proveedor: pago + retenciones (guard) ──
  IF NOT EXISTS (
    SELECT 1 FROM cuenta_corriente_proveedores
    WHERE referencia_tipo = 'orden_pago' AND referencia_id = p_op_id AND tipo_movimiento = 'pago'
  ) THEN
    -- ── v6 (E-54): lo imputado no puede superar el saldo real de cada
    --    comprobante / vencimiento / crédito. Corta con un mensaje claro en
    --    vez de absorber la diferencia (el GREATEST(0, …) de más abajo queda
    --    solo para centavos de redondeo). ──
    PERFORM op_validar_imputaciones(
      v_op.proveedor_id,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'movimiento_cc_id', i.movimiento_cc_id,
                'vencimiento_id', i.vencimiento_id,
                'comprobante_compra_id', i.comprobante_compra_id,
                'monto_imputado', i.monto_imputado)), '[]'::jsonb)
       FROM ordenes_pago_imputaciones i WHERE i.orden_pago_id = p_op_id),
      p_op_id,
      false
    );

    INSERT INTO cuenta_corriente_proveedores (
      proveedor_id, fecha, tipo_movimiento, monto, descripcion,
      referencia_id, referencia_tipo, numero_comprobante, tipo_comprobante
    ) VALUES (
      v_op.proveedor_id, now(), 'pago', -(v_op.neto_a_pagar),
      'Pago ' || v_op.numero_op ||
        CASE WHEN COALESCE(v_op.total_creditos, 0) > 0
             THEN ' (créditos descontados ' || v_op.total_creditos || ')'
             ELSE '' END,
      p_op_id, 'orden_pago', v_op.numero_op, 'OP'
    ) RETURNING id INTO v_pago_mov;

    IF COALESCE(v_op.retencion_ganancias, 0) > 0 THEN
      INSERT INTO cuenta_corriente_proveedores (proveedor_id, fecha, tipo_movimiento, monto, descripcion, referencia_id, referencia_tipo)
      VALUES (v_op.proveedor_id, now(), 'retencion', -(v_op.retencion_ganancias), 'Ret. Ganancias ' || v_op.numero_op, p_op_id, 'orden_pago');
    END IF;
    IF COALESCE(v_op.retencion_iibb, 0) > 0 THEN
      INSERT INTO cuenta_corriente_proveedores (proveedor_id, fecha, tipo_movimiento, monto, descripcion, referencia_id, referencia_tipo)
      VALUES (v_op.proveedor_id, now(), 'retencion', -(v_op.retencion_iibb), 'Ret. IIBB ' || v_op.numero_op, p_op_id, 'orden_pago');
    END IF;
    IF COALESCE(v_op.retencion_iva, 0) > 0 THEN
      INSERT INTO cuenta_corriente_proveedores (proveedor_id, fecha, tipo_movimiento, monto, descripcion, referencia_id, referencia_tipo)
      VALUES (v_op.proveedor_id, now(), 'retencion', -(v_op.retencion_iva), 'Ret. IVA ' || v_op.numero_op, p_op_id, 'orden_pago');
    END IF;
    IF COALESCE(v_op.retencion_suss, 0) > 0 THEN
      INSERT INTO cuenta_corriente_proveedores (proveedor_id, fecha, tipo_movimiento, monto, descripcion, referencia_id, referencia_tipo)
      VALUES (v_op.proveedor_id, now(), 'retencion', -(v_op.retencion_suss), 'Ret. SUSS ' || v_op.numero_op, p_op_id, 'orden_pago');
    END IF;

    -- ── 1b. Consumir/aplicar saldos de comprobantes (créditos y facturas) ──
    FOR v_imp IN
      SELECT * FROM ordenes_pago_imputaciones WHERE orden_pago_id = p_op_id
    LOOP
      v_comp_id := v_imp.comprobante_compra_id;
      IF v_comp_id IS NULL AND v_imp.movimiento_cc_id IS NOT NULL THEN
        SELECT referencia_id INTO v_comp_id FROM cuenta_corriente_proveedores
        WHERE id = v_imp.movimiento_cc_id AND referencia_tipo = 'comprobante_compra';
      END IF;
      IF v_comp_id IS NULL AND v_imp.vencimiento_id IS NOT NULL THEN
        SELECT cc.referencia_id INTO v_comp_id
        FROM vencimientos v
        JOIN cuenta_corriente_proveedores cc ON cc.id = v.referencia_id AND v.referencia_tipo = 'cuenta_corriente'
        WHERE v.id = v_imp.vencimiento_id AND cc.referencia_tipo = 'comprobante_compra';
      END IF;
      IF v_comp_id IS NULL THEN CONTINUE; END IF;

      IF v_imp.monto_imputado < 0 THEN
        -- Crédito (NC/Reversa): saldo negativo sube hacia 0
        SELECT saldo_pendiente INTO v_saldo FROM comprobantes_compra WHERE id = v_comp_id FOR UPDATE;
        IF COALESCE(v_saldo, 0) > -abs(v_imp.monto_imputado) + 0.01 THEN
          RAISE EXCEPTION 'op_confirmar: el crédito % no tiene saldo suficiente (saldo %, se intenta usar %)',
            v_comp_id, COALESCE(v_saldo, 0), abs(v_imp.monto_imputado);
        END IF;
        UPDATE comprobantes_compra
        SET saldo_pendiente = LEAST(0, saldo_pendiente + abs(v_imp.monto_imputado)),
            estado_pago = CASE WHEN saldo_pendiente + abs(v_imp.monto_imputado) >= -0.01 THEN 'pagado' ELSE 'parcial' END
        WHERE id = v_comp_id;
      ELSE
        -- Factura/Adquisición: baja el saldo pendiente
        UPDATE comprobantes_compra
        SET saldo_pendiente = GREATEST(0, saldo_pendiente - v_imp.monto_imputado),
            estado_pago = CASE WHEN saldo_pendiente - v_imp.monto_imputado <= 0.01 THEN 'pagado' ELSE 'parcial' END
        WHERE id = v_comp_id AND saldo_pendiente > 0;
      END IF;
    END LOOP;
  ELSE
    SELECT id INTO v_pago_mov FROM cuenta_corriente_proveedores
    WHERE referencia_tipo = 'orden_pago' AND referencia_id = p_op_id AND tipo_movimiento = 'pago' LIMIT 1;
  END IF;

  -- ── 2. Certificado de retención (guard) ──
  IF COALESCE(v_op.retencion_ganancias, 0) > 0 AND NOT EXISTS (
    SELECT 1 FROM retenciones_emitidas WHERE orden_pago_id = p_op_id AND estado = 'emitida'
  ) THEN
    v_num_cert := retencion_siguiente_numero();
    INSERT INTO retenciones_emitidas (
      orden_pago_id, proveedor_id, regimen_id, fecha,
      base_calculo, acumulado_mes, alicuota, monto,
      numero_certificado, ajuste_manual, motivo_ajuste, creado_por
    ) VALUES (
      p_op_id, v_op.proveedor_id,
      NULLIF(v_calc->>'regimen_id', '')::uuid,
      v_op.fecha,   -- v9 (E-57): el certificado lleva la fecha de la orden de pago (antes: el día de la confirmación)
      COALESCE(v_op.base_ganancias, 0),
      NULLIF(v_calc->>'acumulado_total_mes', '')::numeric,
      COALESCE(NULLIF(v_calc->>'alicuota', '')::numeric, 0),
      v_op.retencion_ganancias,
      v_num_cert,
      COALESCE(v_op.ganancias_ajuste_manual, false),
      v_op.ganancias_motivo,
      p_usuario_id
    ) RETURNING id INTO v_cert_id;
  END IF;

  -- ── 3. Imputaciones (solo débitos marcan vencimientos) ──
  FOR v_imp IN
    SELECT * FROM ordenes_pago_imputaciones WHERE orden_pago_id = p_op_id AND monto_imputado > 0
  LOOP
    IF v_imp.movimiento_cc_id IS NOT NULL AND v_pago_mov IS NOT NULL THEN
      INSERT INTO imputaciones_proveedores (id_movimiento_pago, id_movimiento_documento, monto_imputado, fecha_imputacion)
      SELECT v_pago_mov, v_imp.movimiento_cc_id, v_imp.monto_imputado, now()
      WHERE NOT EXISTS (
        SELECT 1 FROM imputaciones_proveedores
        WHERE id_movimiento_pago = v_pago_mov AND id_movimiento_documento = v_imp.movimiento_cc_id
      );
      v_cc_ids := array_append(v_cc_ids, v_imp.movimiento_cc_id);
    END IF;
    -- v7 (E-55): el vencimiento SIN comprobante queda pagado solo si se pagó entero;
    -- si se pagó una parte, queda pendiente por lo que falta.
    IF v_imp.vencimiento_id IS NOT NULL AND v_imp.movimiento_cc_id IS NULL THEN
      PERFORM op_vencimiento_aplicar_pago(v_imp.vencimiento_id, v_imp.monto_imputado, p_op_id);
    END IF;
  END LOOP;
  -- v7 (E-55): vencimientos de comprobantes — pagados solo si al comprobante no le
  -- queda saldo en la cuenta corriente; si no, quedan pendientes por ese saldo.
  IF array_length(v_cc_ids, 1) > 0 THEN
    PERFORM op_vencimientos_sincronizar_movimiento(m, p_op_id, true) FROM unnest(v_cc_ids) AS m;
  END IF;

  -- ── 4. Medios de pago → kardex: UNA LÍNEA POR MOVIMIENTO, cada una con su
  --       origen (banco/caja del renglón; fallback a los parámetros) ──
  IF NOT EXISTS (
    SELECT 1 FROM kardex_contable WHERE referencia_tipo = 'orden_pago' AND referencia_id = p_op_id
  ) THEN
    FOR v_det IN
      SELECT * FROM ordenes_pago_detalle WHERE orden_pago_id = p_op_id
    LOOP
      IF COALESCE(v_det.monto, 0) <= 0 THEN CONTINUE; END IF;

      IF v_det.medio = 'cheque' AND v_det.cheque_id IS NOT NULL THEN
        SELECT * INTO v_cheque FROM cheques WHERE id = v_det.cheque_id FOR UPDATE;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'op_confirmar: cheque % no encontrado', v_det.cheque_id;
        END IF;
        IF v_cheque.estado <> 'EN_CARTERA' THEN
          RAISE EXCEPTION 'op_confirmar: el cheque % está % (se requiere EN_CARTERA)', v_cheque.numero, v_cheque.estado;
        END IF;
        UPDATE cheques SET estado = 'ENTREGADO_A_PROVEEDOR', proveedor_destino_id = v_op.proveedor_id, orden_pago_id = p_op_id
        WHERE id = v_det.cheque_id;

        PERFORM kardex_registrar(
          p_tipo_movimiento => 'PAGO_PROVEEDOR',
          p_concepto        => 'Pago ' || v_op.numero_op || ' — cheque tercero ' || COALESCE(v_cheque.numero, ''),
          p_monto           => v_det.monto,
          p_color           => v_cheque.color::text,
          p_origen_tipo     => 'EN_CARTERA',
          p_destino_tipo    => 'PROVEEDOR',
          p_destino_id      => v_op.proveedor_id,
          p_metodo          => 'CHEQUE_TERCERO',
          p_referencia_tipo => 'orden_pago',
          p_referencia_id   => p_op_id,
          p_cheque_id       => v_det.cheque_id,
          p_usuario_id      => p_usuario_id,
          p_verificado      => true
        );
        v_kardex := v_kardex + 1;

      ELSIF v_det.medio = 'cheque' THEN
        -- v10 (E-62): el cheque propio / e-cheq queda atado a la cuenta bancaria de la que sale
        -- (cuentas_bancarias, no texto libre) y marcado como e-cheq si corresponde. El banco baja
        -- recién cuando el cheque se debita (cheque_propio_debitar).
        INSERT INTO cheques (tipo, estado, banco, numero, fecha_emision, fecha_vencimiento, monto, color, proveedor_destino_id, orden_pago_id,
                             cuenta_banco_id, es_echeq)
        VALUES ('PROPIO', 'ENTREGADO_A_PROVEEDOR',
                COALESCE((SELECT cb.nombre FROM cuentas_bancarias cb
                           WHERE cb.id = v_det.cuenta_origen_id AND v_det.cuenta_origen_tipo = 'BANCO'), v_det.cheque_banco, 'S/D'),
                COALESCE(v_det.cheque_numero, 'S/N'),
                v_hoy_ar, COALESCE(v_det.cheque_fecha_vencimiento, v_hoy_ar + 30), v_det.monto, 'BLANCO',
                v_op.proveedor_id, p_op_id,
                CASE WHEN v_det.cuenta_origen_tipo = 'BANCO' THEN v_det.cuenta_origen_id END,
                COALESCE(v_det.es_echeq, false))
        RETURNING id INTO v_cheque_id;

        PERFORM kardex_registrar(
          p_tipo_movimiento => 'PAGO_PROVEEDOR',
          p_concepto        => 'Pago ' || v_op.numero_op || ' — cheque propio ' || COALESCE(v_det.cheque_numero, ''),
          p_monto           => v_det.monto,
          p_destino_tipo    => 'PROVEEDOR',
          p_destino_id      => v_op.proveedor_id,
          p_metodo          => 'CHEQUE_PROPIO',
          p_referencia_tipo => 'orden_pago',
          p_referencia_id   => p_op_id,
          p_cheque_id       => v_cheque_id,
          p_usuario_id      => p_usuario_id,
          p_verificado      => true
        );
        v_kardex := v_kardex + 1;

      ELSIF v_det.medio = 'efectivo' THEN
        v_caja_linea := COALESCE(
          CASE WHEN v_det.cuenta_origen_tipo = 'CAJA' THEN v_det.cuenta_origen_id END,
          v_caja
        );
        IF v_caja_linea IS NULL THEN
          RAISE EXCEPTION 'op_confirmar: no hay caja de efectivo (renglón sin origen, Caja Grande inactiva y sin p_caja_id)';
        END IF;
        PERFORM kardex_registrar(
          p_tipo_movimiento => 'PAGO_PROVEEDOR',
          p_concepto        => 'Pago ' || v_op.numero_op || ' — efectivo' || COALESCE(' ' || v_det.observaciones, ''),
          p_monto           => v_det.monto,
          p_origen_tipo     => 'CAJA',
          p_origen_id       => v_caja_linea,
          p_destino_tipo    => 'PROVEEDOR',
          p_destino_id      => v_op.proveedor_id,
          p_metodo          => 'EFECTIVO',
          p_referencia_tipo => 'orden_pago',
          p_referencia_id   => p_op_id,
          p_usuario_id      => p_usuario_id,
          p_verificado      => true
        );
        v_kardex := v_kardex + 1;

      ELSIF v_det.medio = 'transferencia' THEN
        v_banco_linea := COALESCE(
          CASE WHEN v_det.cuenta_origen_tipo = 'BANCO' THEN v_det.cuenta_origen_id END,
          p_cuenta_banco_id
        );
        IF v_banco_linea IS NULL THEN
          RAISE EXCEPTION 'op_confirmar: transferencia sin banco de origen';
        END IF;
        PERFORM kardex_registrar(
          p_tipo_movimiento => 'PAGO_PROVEEDOR',
          p_concepto        => 'Pago ' || v_op.numero_op || ' — transferencia' ||
                               COALESCE(' ' || v_det.numero_transferencia, '') ||
                               COALESCE(' ' || v_det.observaciones, ''),
          p_monto           => v_det.monto,
          p_origen_tipo     => 'BANCO',
          p_origen_id       => v_banco_linea,
          p_destino_tipo    => 'PROVEEDOR',
          p_destino_id      => v_op.proveedor_id,
          p_metodo          => 'TRANSFERENCIA',
          p_referencia_tipo => 'orden_pago',
          p_referencia_id   => p_op_id,
          p_usuario_id      => p_usuario_id,
          p_verificado      => true
        );
        v_kardex := v_kardex + 1;
      END IF;
    END LOOP;
  END IF;

  -- v8 (E-56): los créditos (NC / Reversa) descontados en esta orden quedan asentados en
  -- la cuenta corriente contra el pago (antes solo bajaba el saldo del comprobante y en la
  -- cuenta corriente la NC figuraba pendiente para siempre); y el saldo de cada comprobante
  -- tocado se vuelve a leer de la cuenta corriente: una sola fuente.
  PERFORM op_asentar_creditos(p_op_id, v_pago_mov);
  PERFORM op_sincronizar_saldos_comprobantes(p_op_id);

  UPDATE ordenes_pago SET estado = 'pagada', updated_at = now() WHERE id = p_op_id;

  RETURN jsonb_build_object(
    'success', true, 'ya_confirmada', false,
    'cc_pago_id', v_pago_mov, 'kardex_lineas', v_kardex,
    'certificado_id', v_cert_id, 'numero_certificado', v_num_cert
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.op_anular(
  p_op_id      uuid,
  p_usuario_id uuid,
  p_motivo     text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_op   ordenes_pago%ROWTYPE;
  v_k    record;
  v_mov  record;
  v_imp  record;
  v_comp_id uuid;
  v_revs int := 0;
  v_certs int := 0;
BEGIN
  SELECT * INTO v_op FROM ordenes_pago WHERE id = p_op_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'op_anular: orden de pago % no encontrada', p_op_id;
  END IF;
  IF v_op.estado <> 'pagada' THEN
    RAISE EXCEPTION 'op_anular: la OP está % — solo se anulan OP pagadas', v_op.estado;
  END IF;

  FOR v_k IN
    SELECT * FROM kardex_contable
    WHERE referencia_tipo = 'orden_pago' AND referencia_id = p_op_id
      AND kardex_reversa_de IS NULL
      AND NOT EXISTS (SELECT 1 FROM kardex_contable r WHERE r.kardex_reversa_de = kardex_contable.id)
  LOOP
    PERFORM kardex_registrar(
      p_tipo_movimiento => 'PAGO_PROVEEDOR',
      p_concepto        => 'ANULACIÓN ' || v_op.numero_op || COALESCE(' — ' || p_motivo, '') || ' (reversa: ' || v_k.concepto || ')',
      p_monto           => v_k.monto,
      p_color           => v_k.color,
      p_origen_tipo     => v_k.destino_tipo,
      p_origen_id       => v_k.destino_id,
      p_destino_tipo    => v_k.origen_tipo,
      p_destino_id      => v_k.origen_id,
      p_metodo          => v_k.metodo,
      p_gastos          => 0,
      p_referencia_tipo => 'orden_pago_anulacion',
      p_referencia_id   => p_op_id,
      p_cheque_id       => v_k.cheque_id,
      p_usuario_id      => p_usuario_id,
      p_verificado      => true,
      p_reversa_de      => v_k.id
    );
    v_revs := v_revs + 1;
  END LOOP;

  UPDATE cheques SET estado = 'EN_CARTERA', proveedor_destino_id = NULL, orden_pago_id = NULL
  WHERE orden_pago_id = p_op_id AND tipo = 'TERCERO' AND estado = 'ENTREGADO_A_PROVEEDOR';
  UPDATE cheques SET estado = 'ANULADO'
  WHERE orden_pago_id = p_op_id AND tipo = 'PROPIO' AND estado = 'ENTREGADO_A_PROVEEDOR';

  FOR v_mov IN
    SELECT * FROM cuenta_corriente_proveedores
    WHERE referencia_tipo = 'orden_pago' AND referencia_id = p_op_id
  LOOP
    INSERT INTO cuenta_corriente_proveedores (proveedor_id, fecha, tipo_movimiento, monto, descripcion, referencia_id, referencia_tipo)
    VALUES (v_mov.proveedor_id, now(), 'anulacion', -(v_mov.monto),
            'ANULACIÓN ' || COALESCE(v_mov.descripcion, v_op.numero_op), p_op_id, 'orden_pago_anulacion');
    DELETE FROM imputaciones_proveedores WHERE id_movimiento_pago = v_mov.id;
  END LOOP;

  -- Restaurar saldos de comprobantes (créditos vuelven a negativo, facturas a deber)
  FOR v_imp IN
    SELECT * FROM ordenes_pago_imputaciones WHERE orden_pago_id = p_op_id
  LOOP
    v_comp_id := v_imp.comprobante_compra_id;
    IF v_comp_id IS NULL AND v_imp.movimiento_cc_id IS NOT NULL THEN
      SELECT referencia_id INTO v_comp_id FROM cuenta_corriente_proveedores
      WHERE id = v_imp.movimiento_cc_id AND referencia_tipo = 'comprobante_compra';
    END IF;
    IF v_comp_id IS NULL AND v_imp.vencimiento_id IS NOT NULL THEN
      SELECT cc.referencia_id INTO v_comp_id
      FROM vencimientos v
      JOIN cuenta_corriente_proveedores cc ON cc.id = v.referencia_id AND v.referencia_tipo = 'cuenta_corriente'
      WHERE v.id = v_imp.vencimiento_id AND cc.referencia_tipo = 'comprobante_compra';
    END IF;
    IF v_comp_id IS NULL THEN CONTINUE; END IF;

    IF v_imp.monto_imputado < 0 THEN
      UPDATE comprobantes_compra
      SET saldo_pendiente = saldo_pendiente - abs(v_imp.monto_imputado),
          estado_pago = 'pendiente'
      WHERE id = v_comp_id;
    ELSE
      UPDATE comprobantes_compra
      SET saldo_pendiente = saldo_pendiente + v_imp.monto_imputado,
          estado_pago = 'pendiente'
      WHERE id = v_comp_id;
    END IF;
  END LOOP;

  -- v4 (E-55): devolver al vencimiento SIN comprobante el importe que había pagado esta orden
  FOR v_imp IN
    SELECT * FROM ordenes_pago_imputaciones
    WHERE orden_pago_id = p_op_id AND monto_imputado > 0 AND vencimiento_id IS NOT NULL AND movimiento_cc_id IS NULL
  LOOP
    PERFORM op_vencimiento_revertir_pago(v_imp.vencimiento_id, v_imp.monto_imputado, p_op_id);
  END LOOP;

  UPDATE vencimientos SET estado = 'pendiente', orden_pago_id = NULL, updated_at = now()
  WHERE orden_pago_id = p_op_id AND estado = 'pagado';

  -- v4 (E-55): vencimientos de comprobantes — vuelven a mostrar el saldo que quedó en la
  -- cuenta corriente (las imputaciones de esta orden ya se borraron más arriba)
  PERFORM op_vencimientos_sincronizar_movimiento(x.movimiento_cc_id, p_op_id, false)
  FROM (SELECT DISTINCT movimiento_cc_id FROM ordenes_pago_imputaciones
        WHERE orden_pago_id = p_op_id AND monto_imputado > 0 AND movimiento_cc_id IS NOT NULL) x;

  -- v5 (E-56): el saldo de cada comprobante tocado se vuelve a leer de la cuenta corriente
  -- (las imputaciones de esta orden, incluidas las de créditos, ya se borraron más arriba)
  PERFORM op_sincronizar_saldos_comprobantes(p_op_id);

  UPDATE retenciones_emitidas SET estado = 'anulada'
  WHERE orden_pago_id = p_op_id AND estado = 'emitida';
  GET DIAGNOSTICS v_certs = ROW_COUNT;

  UPDATE ordenes_pago
  SET estado = 'anulada',
      observaciones = COALESCE(observaciones || E'\n', '') || 'ANULADA: ' || COALESCE(p_motivo, 'sin motivo') ||
                      ' (' || to_char(now() AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD-MM-YYYY HH24:MI') || ')',
      updated_at = now()
  WHERE id = p_op_id;

  RETURN jsonb_build_object('success', true, 'kardex_reversas', v_revs, 'certificados_anulados', v_certs);
END;
$$;

CREATE OR REPLACE FUNCTION public.op_eliminar(p_op_id uuid, p_usuario_id uuid, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_op        ordenes_pago%ROWTYPE;
  v_cert      record;
  v_seq       int;
  v_op_lib    boolean := false;
  v_cert_lib  boolean := false;
  v_revs      int := 0;
  v_res       jsonb;
BEGIN
  SELECT * INTO v_op FROM ordenes_pago WHERE id = p_op_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'op_eliminar: orden de pago % no encontrada', p_op_id;
  END IF;

  -- v2 (E-61): si el certificado de retención de esta orden cae en un período que ya se
  -- marcó como presentado ante ARCA, no se puede borrar ni reutilizar su número: hay que ANULAR.
  IF EXISTS (
    SELECT 1 FROM retenciones_emitidas re
     WHERE re.orden_pago_id = p_op_id
       AND re.fecha <= retenciones_presentado_hasta()
  ) THEN
    RAISE EXCEPTION 'La orden % tiene un certificado de retención de un período que ya se presentó ante ARCA (SICORE). No se puede eliminar (se perdería el certificado y se reutilizaría su número): usá Anular.', v_op.numero_op;
  END IF;

  -- 1. Si está pagada: revertir todo primero (kardex, cheques, saldos, vencs)
  IF v_op.estado = 'pagada' THEN
    v_res := op_anular(p_op_id, p_usuario_id, COALESCE(p_motivo, 'eliminación total'));
    v_revs := COALESCE((v_res->>'kardex_reversas')::int, 0);
  END IF;

  -- 2. CC del proveedor: borrar los movimientos de la OP y los contraasientos
  --    de la anulación (queda exactamente como estaba)
  DELETE FROM imputaciones_proveedores ip
  USING cuenta_corriente_proveedores cc
  WHERE (ip.id_movimiento_pago = cc.id OR ip.id_movimiento_documento = cc.id)
    AND cc.referencia_id = p_op_id
    AND cc.referencia_tipo IN ('orden_pago', 'orden_pago_anulacion');
  DELETE FROM cuenta_corriente_proveedores
  WHERE referencia_id = p_op_id
    AND referencia_tipo IN ('orden_pago', 'orden_pago_anulacion');

  -- 3. Certificados de retención: liberar número (si era el último) y eliminar
  FOR v_cert IN SELECT * FROM retenciones_emitidas WHERE orden_pago_id = p_op_id
  LOOP
    v_seq := NULLIF(split_part(v_cert.numero_certificado, '-', 2), '')::int;
    IF v_seq IS NOT NULL THEN
      UPDATE numeracion_comprobantes
      SET ultimo_numero = ultimo_numero - 1, updated_at = now()
      WHERE tipo_comprobante = 'RETGAN'
        AND punto_venta = split_part(v_cert.numero_certificado, '-', 1)
        AND ultimo_numero = v_seq;
      IF FOUND THEN v_cert_lib := true; END IF;
    END IF;
    DELETE FROM retenciones_emitidas WHERE id = v_cert.id;
  END LOOP;

  -- 4. Número de OP: liberar si era el último de la serie
  v_seq := NULLIF(split_part(v_op.numero_op, '-', 2), '')::int;
  IF v_seq IS NOT NULL THEN
    UPDATE numeracion_comprobantes
    SET ultimo_numero = ultimo_numero - 1, updated_at = now()
    WHERE tipo_comprobante = 'OP'
      AND punto_venta = split_part(v_op.numero_op, '-', 1)
      AND ultimo_numero = v_seq;
    IF FOUND THEN v_op_lib := true; END IF;
  END IF;

  -- 5. Desvincular referencias y borrar la OP entera
  UPDATE cheques SET orden_pago_id = NULL WHERE orden_pago_id = p_op_id;
  UPDATE vencimientos SET orden_pago_id = NULL, updated_at = now() WHERE orden_pago_id = p_op_id;
  DELETE FROM ordenes_pago_imputaciones WHERE orden_pago_id = p_op_id;
  DELETE FROM ordenes_pago_detalle WHERE orden_pago_id = p_op_id;
  DELETE FROM ordenes_pago WHERE id = p_op_id;

  RETURN jsonb_build_object(
    'success', true,
    'kardex_reversas', v_revs,
    'numero_op_liberado', v_op_lib,
    'certificado_liberado', v_cert_lib
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.op_crear_y_confirmar(
  p_payload    jsonb,
  p_usuario    text DEFAULT NULL,
  p_usuario_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_op     jsonb;
  v_op_id  uuid;
  v_caja   uuid;
  v_banco  uuid;
  v_conf   jsonb;
  v_fila   ordenes_pago%ROWTYPE;
BEGIN
  v_op := op_crear(p_payload, p_usuario);
  v_op_id := (v_op->>'id')::uuid;

  SELECT cuenta_origen_id INTO v_caja FROM ordenes_pago_detalle
   WHERE orden_pago_id = v_op_id AND cuenta_origen_tipo = 'CAJA' AND cuenta_origen_id IS NOT NULL
   ORDER BY created_at, id LIMIT 1;
  SELECT cuenta_origen_id INTO v_banco FROM ordenes_pago_detalle
   WHERE orden_pago_id = v_op_id AND cuenta_origen_tipo = 'BANCO' AND cuenta_origen_id IS NOT NULL
   ORDER BY created_at, id LIMIT 1;

  -- Si falla, la excepción deshace también lo que hizo op_crear (misma transacción)
  v_conf := op_confirmar(v_op_id, p_usuario_id, v_caja, v_banco);

  SELECT * INTO v_fila FROM ordenes_pago WHERE id = v_op_id;
  RETURN to_jsonb(v_fila)
      || jsonb_build_object('ya_existia', COALESCE((v_op->>'ya_existia')::boolean, false), 'confirmacion', v_conf);
END;
$function$;

COMMENT ON FUNCTION public.op_confirmar(uuid, uuid, uuid, uuid) IS 'op_confirmar v11 (20261117p_ordenes_pago_t1d)';
COMMENT ON FUNCTION public.op_anular(uuid, uuid, text) IS 'op_anular v5 (20261117p_ordenes_pago_t1d)';
COMMENT ON FUNCTION public.op_crear(jsonb, text) IS 'op_crear v4 (20261117p_ordenes_pago_t1d)';
COMMENT ON FUNCTION public.op_eliminar(uuid, uuid, text) IS 'op_eliminar v2 (20261117p_ordenes_pago_t1d)';

REVOKE ALL ON FUNCTION public.op_normalizar_imputaciones(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.op_normalizar_imputaciones(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.op_validar_imputaciones(uuid, jsonb, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.op_validar_imputaciones(uuid, jsonb, uuid, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.op_crear(jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.op_crear(jsonb, text) TO service_role;
REVOKE ALL ON FUNCTION public.op_confirmar(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.op_confirmar(uuid, uuid, uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.op_anular(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.op_anular(uuid, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.op_eliminar(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.op_eliminar(uuid, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.op_crear_y_confirmar(jsonb, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.op_crear_y_confirmar(jsonb, text, uuid) TO service_role;


-- ═════════════════════ 6. CHEQUE PROPIO / E-CHEQ (E-62) ═════════════════════

CREATE OR REPLACE FUNCTION public.cheque_propio_debitar(
  p_cheque_id       uuid,
  p_fecha           date DEFAULT NULL,
  p_cuenta_banco_id uuid DEFAULT NULL,
  p_usuario_id      uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ch     cheques%ROWTYPE;
  v_cuenta uuid;
  v_k      uuid;
BEGIN
  SELECT * INTO v_ch FROM cheques WHERE id = p_cheque_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El cheque no existe.';
  END IF;
  IF v_ch.tipo::text <> 'PROPIO' THEN
    RAISE EXCEPTION 'Solo se debita un cheque propio (este es de terceros).';
  END IF;
  IF v_ch.estado::text = 'COBRADO' THEN
    RETURN jsonb_build_object('success', true, 'ya_debitado', true);
  END IF;
  IF v_ch.estado::text <> 'ENTREGADO_A_PROVEEDOR' THEN
    RAISE EXCEPTION 'El cheque % está %: solo se debita un cheque propio entregado al proveedor.', v_ch.numero, v_ch.estado;
  END IF;

  v_cuenta := COALESCE(v_ch.cuenta_banco_id, p_cuenta_banco_id);
  IF v_cuenta IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cuentas_bancarias WHERE id = v_cuenta) THEN
    RAISE EXCEPTION 'La cuenta bancaria indicada no existe.';
  END IF;

  UPDATE cheques
     SET estado = 'COBRADO', fecha_debito = COALESCE(p_fecha, public.hoy_ar()),
         cuenta_banco_id = COALESCE(cuenta_banco_id, v_cuenta)
   WHERE id = p_cheque_id;

  IF v_cuenta IS NOT NULL THEN
    v_k := kardex_registrar(
      p_tipo_movimiento => 'DEBITO_CHEQUE_PROPIO',
      p_concepto        => 'Débito ' || CASE WHEN COALESCE(v_ch.es_echeq, false) THEN 'e-cheq' ELSE 'cheque propio' END || ' N° ' || COALESCE(v_ch.numero, ''),
      p_monto           => v_ch.monto,
      p_color           => v_ch.color::text,
      p_origen_tipo     => 'BANCO',
      p_origen_id       => v_cuenta,
      p_destino_tipo    => 'PROVEEDOR',
      p_destino_id      => v_ch.proveedor_destino_id,
      p_metodo          => 'CHEQUE_PROPIO',
      p_referencia_tipo => 'cheque',
      p_referencia_id   => p_cheque_id,
      p_cheque_id       => p_cheque_id,
      p_usuario_id      => p_usuario_id,
      p_verificado      => true
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'ya_debitado', false,
                            'bajo_el_banco', v_cuenta IS NOT NULL, 'cuenta_banco_id', v_cuenta, 'kardex_id', v_k);
END;
$function$;

REVOKE ALL ON FUNCTION public.cheque_propio_debitar(uuid, date, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cheque_propio_debitar(uuid, date, uuid, uuid) TO service_role;


-- ═════════════════════ 7. CUOTAS RECURRENTES ═════════════════════
-- vencimientos_mantener: cuerpo EXACTO de 20261102_vencimientos_fin_de_mes.sql. Único cambio:
-- el importe de las cuotas nuevas sale del importe COMPLETO de la última (monto_original
-- cuando tiene un pago parcial), no de lo que le falta pagar.

CREATE OR REPLACE FUNCTION public.vencimientos_mantener(
  p_horizonte_meses int DEFAULT 6
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_serie      record;
  v_ultima     date;
  v_siguiente  date;
  v_monto      numeric;
  v_promedio   numeric;
  v_hoy        date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_limite     date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date + (p_horizonte_meses || ' months')::interval;
  v_paso       int;
  v_generados  int := 0;
  v_renov      int := 0;
  v_guard      int;
  v_dia        int;   -- día del mes de la serie (30, 31…): no se pierde al pasar por febrero
  v_mes        date;  -- primer día del mes de la próxima cuota
BEGIN
  -- ── 1. Extender series activas hasta el horizonte ──
  FOR v_serie IN
    SELECT DISTINCT ON (COALESCE(proveedor_id, '00000000-0000-0000-0000-000000000000'::uuid), concepto, recurrencia)
           *
    FROM vencimientos
    WHERE recurrencia IS NOT NULL
      AND recurrencia IN ('mensual', 'bimestral', 'trimestral', 'semestral', 'anual')
      AND estado <> 'cancelado'
    ORDER BY COALESCE(proveedor_id, '00000000-0000-0000-0000-000000000000'::uuid), concepto, recurrencia,
             fecha_vencimiento DESC
  LOOP
    v_paso := CASE v_serie.recurrencia
      WHEN 'mensual' THEN 1 WHEN 'bimestral' THEN 2 WHEN 'trimestral' THEN 3
      WHEN 'semestral' THEN 6 ELSE 12 END;
    v_ultima := v_serie.fecha_vencimiento;

    -- Día de la serie: el de la última cuota. Si esa cayó a fin de mes (un 28/02
    -- de una serie del 30), el mayor día de las últimas cuotas pendientes.
    v_dia := extract(day FROM v_ultima)::int;
    IF v_ultima = (date_trunc('month', v_ultima) + interval '1 month - 1 day')::date THEN
      SELECT greatest(v_dia, COALESCE(max(extract(day FROM fecha_vencimiento))::int, v_dia)) INTO v_dia
        FROM (
          SELECT fecha_vencimiento FROM vencimientos
           WHERE concepto = v_serie.concepto
             AND COALESCE(proveedor_id, '00000000-0000-0000-0000-000000000000'::uuid)
                 = COALESCE(v_serie.proveedor_id, '00000000-0000-0000-0000-000000000000'::uuid)
             AND recurrencia = v_serie.recurrencia
             AND estado = 'pendiente'
           ORDER BY fecha_vencimiento DESC LIMIT 3
        ) ult;
    END IF;

    -- Monto de las cuotas nuevas: si la serie es estimada, promedio de los
    -- últimos 3 pagos reales (no estimados) del mismo concepto; si no hay,
    -- arrastra el de la última cuota.
    -- (Tanda 1-D) si la última cuota tiene un pago parcial, "monto" es lo que falta: la
    -- cuota nueva copia el importe completo (monto_original).
    v_monto := COALESCE(v_serie.monto_original, v_serie.monto);
    IF v_serie.es_estimado THEN
      SELECT round(avg(monto), 2) INTO v_promedio FROM (
        SELECT monto FROM vencimientos
        WHERE concepto = v_serie.concepto
          AND COALESCE(proveedor_id, '00000000-0000-0000-0000-000000000000'::uuid)
              = COALESCE(v_serie.proveedor_id, '00000000-0000-0000-0000-000000000000'::uuid)
          AND estado = 'pagado' AND es_estimado = false AND monto > 0
        ORDER BY fecha_vencimiento DESC LIMIT 3
      ) ult;
      v_monto := COALESCE(v_promedio, v_serie.monto_original, v_serie.monto);
    END IF;

    v_guard := 0;
    LOOP
      -- Mismo día de la serie, o el último del mes si ese mes es más corto
      -- (30/01 → 28/02 → 30/03; antes 30/01 + 1 mes daba bien pero la serie
      -- quedaba en 28 para siempre).
      v_mes := (date_trunc('month', v_ultima) + (v_paso || ' months')::interval)::date;
      v_siguiente := v_mes + (least(v_dia, extract(day FROM (v_mes + interval '1 month - 1 day'))::int) - 1);
      EXIT WHEN v_siguiente > v_limite;
      EXIT WHEN v_serie.recurrencia_hasta IS NOT NULL AND v_siguiente > v_serie.recurrencia_hasta;
      v_guard := v_guard + 1;
      EXIT WHEN v_guard > 24;  -- backstop

      IF NOT EXISTS (
        SELECT 1 FROM vencimientos
        WHERE concepto = v_serie.concepto
          AND COALESCE(proveedor_id, '00000000-0000-0000-0000-000000000000'::uuid)
              = COALESCE(v_serie.proveedor_id, '00000000-0000-0000-0000-000000000000'::uuid)
          AND fecha_vencimiento = v_siguiente
          AND estado <> 'cancelado'
      ) THEN
        INSERT INTO vencimientos (
          proveedor_id, tipo, concepto, monto, moneda, fecha_vencimiento,
          recurrencia, recurrencia_hasta, observaciones, dias_alerta,
          forma_pago, modalidad, descuentos_aplicados, es_estimado, estado
        ) VALUES (
          v_serie.proveedor_id, v_serie.tipo, v_serie.concepto, v_monto,
          v_serie.moneda, v_siguiente, v_serie.recurrencia, v_serie.recurrencia_hasta,
          v_serie.observaciones, v_serie.dias_alerta, v_serie.forma_pago,
          v_serie.modalidad, COALESCE(v_serie.descuentos_aplicados, false),
          v_serie.es_estimado, 'pendiente'
        );
        v_generados := v_generados + 1;
      END IF;
      v_ultima := v_siguiente;
    END LOOP;

    -- ── 2. Renovación de ciclo (recurrencia_hasta próxima) ──
    IF v_serie.recurrencia_hasta IS NOT NULL
       AND v_serie.recurrencia_hasta <= v_limite
       AND NOT EXISTS (
         SELECT 1 FROM vencimientos
         WHERE concepto = 'Renovación: ' || v_serie.concepto
           AND fecha_vencimiento = v_serie.recurrencia_hasta
           AND estado <> 'cancelado'
       )
    THEN
      INSERT INTO vencimientos (
        proveedor_id, tipo, concepto, monto, moneda, fecha_vencimiento,
        observaciones, dias_alerta, forma_pago, modalidad, es_estimado, estado
      )
      SELECT v_serie.proveedor_id, v_serie.tipo,
             'Renovación: ' || v_serie.concepto,
             -- estimado del ciclo completo = suma de las cuotas del ciclo actual
             COALESCE((SELECT sum(monto) FROM vencimientos
                       WHERE concepto = v_serie.concepto
                         AND recurrencia = v_serie.recurrencia
                         AND recurrencia_hasta = v_serie.recurrencia_hasta
                         AND estado <> 'cancelado'), v_serie.monto),
             v_serie.moneda, v_serie.recurrencia_hasta,
             'Fin de ciclo — cargar las cuotas del período nuevo al renovar',
             7, v_serie.forma_pago, v_serie.modalidad, true, 'pendiente';
      v_renov := v_renov + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'generados', v_generados, 'renovaciones', v_renov);
END;
$$;

REVOKE ALL ON FUNCTION public.vencimientos_mantener(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vencimientos_mantener(int) TO authenticated, service_role;

-- ═════════════════════ CONTROLES (solo lectura) ═════════════════════
-- Comprobantes cuyo saldo propio NO coincide con la cuenta corriente
-- (si devuelve filas, cc_proveedor_resincronizar_saldos() las empareja):
-- select p.nombre, c.tipo_comprobante, c.numero_comprobante, c.saldo_pendiente as saldo_comprobante,
--        (select sum(public.cc_proveedor_saldo_movimiento(m)) from public.cc_proveedor_movimientos_de_comprobante(c.id) m) as saldo_cuenta_corriente
--   from comprobantes_compra c left join proveedores p on p.id = c.proveedor_id
--  where exists (select 1 from public.cc_proveedor_movimientos_de_comprobante(c.id))
--    and abs(coalesce(c.saldo_pendiente, 0) - (select sum(public.cc_proveedor_saldo_movimiento(m)) from public.cc_proveedor_movimientos_de_comprobante(c.id) m)) > 0.01;
-- Vencimientos con pago por orden: la cuenta tiene que cerrar
-- select id, concepto, estado, monto, monto_original, monto_pagado, monto_ajuste from vencimientos
--  where monto_original is not null and estado = 'pendiente'
--    and abs(monto_original - monto_pagado - monto_ajuste - monto) > 0.01;
