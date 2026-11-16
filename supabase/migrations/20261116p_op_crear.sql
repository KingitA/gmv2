-- ═════════════════════════════════════════════════════════════════════════════
-- Órdenes de pago a proveedores — crear en UNA transacción y validar saldos
-- Prueba integral de ENTRADA, Tanda 0-B (16/11/2026): E-50, E-51, E-52, E-54.
--
-- Antes: POST /api/ordenes-pago hacía 3 inserts sueltos (cabecera, medios,
-- imputaciones). Si fallaba el 2º o el 3º la orden quedaba sin medios o sin
-- imputaciones y la ruta respondía "ok". Además monto_total sumaba las
-- retenciones dos veces y nada controlaba que no se pagara de más.
--
-- Ahora: op_crear(payload) hace todo junto o nada.
--
-- REGLA ÚNICA DE LOS TOTALES DE UNA OP (E-50) — la leen la lista, el PDF,
-- Jarvis y op_confirmar con este mismo significado:
--   monto_total       = lo que la OP cancela de la deuda del proveedor
--                       (lo imputado, ya restados los créditos NC/Reversa;
--                        sin imputaciones = medios + retenciones)
--   total_retenciones = Ganancias + IIBB + IVA + SUSS
--   neto_a_pagar      = monto_total − total_retenciones = suma de los medios
--   total_creditos    = NC/Reversas descontadas (bruto = monto_total + total_creditos)
--
-- Piezas:
--   1. ordenes_pago.clave_idempotencia  → doble click = una sola OP
--   1b. op_ganancias_bases v5          → no cortar si lo primero no tiene comprobante
--   2. op_movimiento_de()               → vencimiento/comprobante → movimiento de CC
--   3. op_normalizar_imputaciones()     → E-52: el vencimiento con comprobante
--                                         se imputa contra SU movimiento de CC
--   4. op_validar_imputaciones()        → E-54: no pagar de más ni dos veces
--   5. op_crear()                       → E-51: cabecera + medios + imputaciones
--
-- Seguro de re-ejecutar. No toca datos. op_confirmar v6 va en 20261116q.
-- ═════════════════════════════════════════════════════════════════════════════

-- ═══ 1. Idempotencia de la creación ═══
ALTER TABLE public.ordenes_pago ADD COLUMN IF NOT EXISTS clave_idempotencia uuid;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ordenes_pago_clave_idempotencia
  ON public.ordenes_pago (clave_idempotencia) WHERE clave_idempotencia IS NOT NULL;
COMMENT ON COLUMN public.ordenes_pago.clave_idempotencia IS
  'Clave que manda la pantalla al crear la OP: si llega dos veces (doble click, reintento), op_crear devuelve la misma OP.';


-- ═══ 1b. op_ganancias_bases v5 — no cortar cuando algo no tiene comprobante ═══
-- Cuerpo EXACTO de la v4 (20260807_op_eliminar_y_bases_v4.sql) con UNA sentencia
-- cambiada (marcada "v5": el vaciado de v_comp en cada vuelta). No cambia
-- ninguna base ni ninguna retención: solo evita el error cuando una
-- imputación es un vencimiento sin comprobante
-- (el caso de casi todos los vencimientos reales). Encontrado probando op_crear
-- en una base local el 16/11/2026. Generado por script desde la v4.
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
    ELSIF v_comp_id IS NOT NULL AND v_comp.tipo_comprobante IN ('NC','NCA','NCB','NCC')
       AND COALESCE(v_comp.total, 0) > 0 AND COALESCE(v_comp.total_neto, 0) <> 0 THEN
      -- NC fiscal descontada: base NEGATIVA (retención neta de NC)
      v_base := -round(abs(v_comp.total_neto) * LEAST(abs(v_monto) / v_comp.total, 1), 2);
      v_tipo := 'nota_credito';
      v_etiqueta := COALESCE(v_comp.numero_comprobante, v_etiqueta);
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
      'tipo_comprobante', CASE WHEN v_comp_id IS NOT NULL THEN v_comp.tipo_comprobante END,
      'numero', CASE WHEN v_comp_id IS NOT NULL THEN v_comp.numero_comprobante END,
      'fecha_comprobante', CASE WHEN v_comp_id IS NOT NULL THEN to_char(v_comp.fecha_comprobante, 'YYYY-MM-DD') END
    );
  END LOOP;

  RETURN jsonb_build_object('total_base', GREATEST(0, round(v_total, 2)), 'detalle', v_detalle);
END;
$function$;


-- ═══ 2. De un vencimiento o comprobante a su movimiento de cuenta corriente ═══
-- Devuelve NULL cuando no hay comprobante detrás (vencimiento cargado a mano:
-- es el caso de casi todos los vencimientos reales).
CREATE OR REPLACE FUNCTION public.op_movimiento_de(
  p_vencimiento_id uuid,
  p_comprobante_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_venc record;
  v_mov  uuid;
  v_comp uuid := p_comprobante_id;
BEGIN
  IF p_vencimiento_id IS NOT NULL THEN
    SELECT referencia_tipo, referencia_id INTO v_venc
    FROM vencimientos WHERE id = p_vencimiento_id;
    IF FOUND AND v_venc.referencia_id IS NOT NULL THEN
      IF v_venc.referencia_tipo = 'cuenta_corriente' THEN
        SELECT id INTO v_mov FROM cuenta_corriente_proveedores
        WHERE id = v_venc.referencia_id AND monto > 0;
        IF v_mov IS NOT NULL THEN RETURN v_mov; END IF;
      ELSIF v_venc.referencia_tipo = 'comprobante_compra' THEN
        v_comp := COALESCE(v_comp, v_venc.referencia_id);
      END IF;
    END IF;
  END IF;

  IF v_comp IS NOT NULL THEN
    SELECT id INTO v_mov FROM cuenta_corriente_proveedores
    WHERE referencia_tipo = 'comprobante_compra' AND referencia_id = v_comp AND monto > 0
    ORDER BY fecha ASC, id ASC
    LIMIT 1;
  END IF;
  RETURN v_mov;
END;
$function$;

REVOKE ALL ON FUNCTION public.op_movimiento_de(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.op_movimiento_de(uuid, uuid) TO service_role;


-- ═══ 3. Normalizar imputaciones (E-52) ═══
-- Entrada y salida: [{ movimiento_cc_id?, vencimiento_id?, comprobante_compra_id?, monto_imputado }]
-- Una deuda (monto > 0) elegida por su vencimiento se completa con el
-- movimiento de CC del comprobante, así op_confirmar baja la factura en la
-- cuenta corriente y no queda pagable otra vez. Sin comprobante detrás, queda
-- como pago contra el vencimiento (que pasa a pagado al confirmar).
-- Los renglones en 0 se descartan. Los créditos (monto < 0) no se tocan.
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
      'monto_imputado', v_monto
    );
  END LOOP;

  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.op_normalizar_imputaciones(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.op_normalizar_imputaciones(jsonb) TO service_role;


-- ═══ 4. Validar imputaciones (E-54) ═══
-- Recibe las imputaciones YA normalizadas. Corta con un mensaje claro si:
--   · la misma deuda está elegida dos veces (por el comprobante y por su vencimiento)
--   · algo es de otro proveedor o no existe
--   · lo imputado supera el saldo pendiente del comprobante/movimiento
--   · el vencimiento ya está pagado o cancelado, o ya está en otra OP pendiente
--     (al vencimiento SIN comprobante se le puede pagar un importe distinto al suyo)
--   · un crédito (NC/Reversa) no tiene saldo suficiente
-- p_contar_pendientes = true (al CREAR): además descuenta lo que ya tienen
--   tomado otras OP PENDIENTES sobre la misma deuda.
-- p_contar_pendientes = false (al CONFIRMAR): solo cuenta el saldo real; si
--   otra OP ya se confirmó sobre lo mismo, el saldo ya bajó y esta no pasa.
-- p_excluir_op: la propia OP (para no contarse a sí misma).
--
-- Saldo de un movimiento de CC = su monto − lo ya imputado en
-- imputaciones_proveedores (lo mismo que muestra la pantalla de Nueva OP).
-- Si además el comprobante lleva saldo propio (> 0), tampoco se lo puede pasar.
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

REVOKE ALL ON FUNCTION public.op_validar_imputaciones(uuid, jsonb, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.op_validar_imputaciones(uuid, jsonb, uuid, boolean) TO service_role;


-- ═══ 5. op_crear — cabecera + medios + imputaciones, todo o nada (E-51) ═══
-- p_payload:
--   { proveedor_id, fecha?, observaciones?, clave?,
--     ganancias_manual?, ganancias_motivo?, retencion_ganancias?,
--     retencion_iibb?, retencion_iva?, retencion_suss?,
--     medios_pago:  [{ medio, monto, cheque_id?, cheque_banco?, cheque_numero?,
--                      cheque_fecha_vencimiento?, banco_destino?, numero_cuenta?, cbu?,
--                      numero_transferencia?, fecha_transferencia?, observaciones?,
--                      cuenta_origen_tipo?, cuenta_origen_id? }],
--     imputaciones: [{ movimiento_cc_id?, vencimiento_id?, comprobante_compra_id?, monto_imputado }] }
-- Devuelve la fila de ordenes_pago (jsonb) + ya_existia.
-- La retención de Ganancias SIEMPRE la calcula el servidor; el valor de la
-- pantalla solo vale como ajuste manual con motivo.
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
    cuenta_origen_tipo, cuenta_origen_id
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
    NULLIF(e->>'cuenta_origen_id', '')::uuid
  FROM jsonb_array_elements(v_medios) e;

  INSERT INTO ordenes_pago_imputaciones (orden_pago_id, movimiento_cc_id, vencimiento_id, comprobante_compra_id, monto_imputado)
  SELECT
    v_op.id,
    NULLIF(e->>'movimiento_cc_id', '')::uuid,
    NULLIF(e->>'vencimiento_id', '')::uuid,
    NULLIF(e->>'comprobante_compra_id', '')::uuid,
    (e->>'monto_imputado')::numeric
  FROM jsonb_array_elements(v_imps) e;

  RETURN to_jsonb(v_op) || jsonb_build_object('ya_existia', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.op_crear(jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.op_crear(jsonb, text) TO service_role;

-- Control (no cambia nada):
-- select proname from pg_proc where proname in ('op_crear','op_validar_imputaciones','op_normalizar_imputaciones','op_movimiento_de');
