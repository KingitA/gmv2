-- ─────────────────────────────────────────────────────────────────────────────
-- Cableado entre la orden de compra (Tanda 1-A) y la validación de la factura (Tanda 1-B).
-- 17/11/2026. VA DESPUÉS de 20261117d_validar_renglones_suman.sql, de 20261117n_oc_guardar.sql y de
-- 20261117p_ordenes_pago_t1d.sql: si falta alguna de las tres, corta con un mensaje y no cambia nada.
--
-- A. La misma función comprobante_compra_validar de 20261117d con cuatro cambios:
--   1. Vencimiento real en CUOTAS. El servidor manda en p_plan.pagos un pago por cada cuota del
--      acuerdo ("30/60/90" = tres vencimientos; lib/compras/acuerdo-pago.ts). Las cuotas siempre
--      suman el total del comprobante (la última se lleva el resto). Sin p_plan.pagos se comporta
--      como antes: un solo vencimiento por el total.
--   2. El vencimiento ESTIMADO de la orden deja lugar al real, en la misma transacción:
--      oc_vencimiento_estimado_reemplazar(orden, canal, total del comprobante). Baja los estimados
--      de ese canal (blanco = con factura, negro = adquisición) y borra los que llegan a cero.
--      No toca ningún vencimiento que no sea un estimado de esa orden.
--   3. La provisión de la orden se baja POR CANAL: una orden mixta tiene dos provisiones (con
--      factura / sin factura, 20261117n) y cada comprobante baja solo la suya.
--   4. El neto de cada renglón para la regla de suma sale de oc_neto_unitario (la misma función
--      que usa la orden): una sola regla para "en cascada / sobre precio de lista".
--
--   5. Si la deuda ya se había pagado (en todo o en parte) ANTES de validar —una factura que entró
--      por mail deja la deuda en la cuenta corriente y se puede pagar con una orden de pago—, las
--      cuotas recién creadas se acomodan al saldo real del movimiento
--      (op_vencimientos_sincronizar_movimiento, de la 20261117p): no vuelve a aparecer como
--      pendiente lo que ya se pagó.
--   6. Una nota de débito no baja la provisión ni el estimado de la orden. La adquisición se lee
--      como 'Adquisicion' o 'ADQ' (valor viejo del procesador de mails).
--
-- B. oc_cerrar_estimados(orden): al FINALIZAR la orden, quita en una sola transacción todo lo
--    que era estimado y ya no va a pasar: provisión que quedó en la cuenta corriente, vencimientos
--    estimados y mercadería "en camino". Solo actúa sobre una orden finalizada o cancelada.
--
-- C. entrada_cableado_version(): marca de que esto está instalado. Sin esta migración el servidor
--    NO valida comprobantes de una orden de compra: contesta que falta aplicarla y no hace nada.
--    (Los comprobantes sin orden se siguen validando como antes.)
-- No modifica datos al instalarse. Se puede correr más de una vez.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF to_regprocedure('public.oc_vencimiento_estimado_reemplazar(uuid, text, numeric)') IS NULL
     OR to_regprocedure('public.oc_neto_unitario(numeric, numeric, numeric, numeric, numeric, text)') IS NULL THEN
    RAISE EXCEPTION 'Falta aplicar ANTES la migración 20261117n_oc_guardar.sql (funciones de la orden de compra). No se cambió nada.';
  END IF;
  IF to_regprocedure('public.op_vencimientos_sincronizar_movimiento(uuid, uuid, boolean)') IS NULL
     OR to_regprocedure('public.cc_proveedor_saldo_movimiento(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Falta aplicar ANTES la migración 20261117p_ordenes_pago_t1d.sql (pagos y saldo de la cuenta corriente). No se cambió nada.';
  END IF;
  IF to_regprocedure('public.comprobante_compra_validar(uuid, uuid, jsonb)') IS NULL
     OR position('renglones_no_suman' IN pg_get_functiondef('public.comprobante_compra_validar(uuid, uuid, jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'Falta aplicar ANTES la migración 20261117d_validar_renglones_suman.sql (y las anteriores: 20261116c, 20261117a_remito_no_se_valida). No se cambió nada.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.comprobante_compra_validar(
  p_comprobante_id uuid,
  p_usuario_id     uuid,
  p_plan           jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v              record;
  v_oc           uuid;
  v_numero_oc    text;
  v_prov         uuid;
  v_total        numeric;
  v_credito      boolean;
  v_documental   boolean;
  v_debito_nota  boolean;
  v_sin_articulo int;
  v_mov          uuid;
  v_mov_nuevo    boolean := false;
  v_fecha        timestamptz;
  v_desc         text;
  v_otros        int;
  v_prov_row     record;
  v_restante     numeric;
  v_provision    text := 'sin_provision';
  v_venc         uuid;
  v_venc_nuevo   boolean := false;
  v_fecha_venc   date;
  v_fecha_valid  date;
  v_adoptar      uuid;
  v_suma         numeric;
  v_suma2        numeric;
  v_tipo_dto     text := 'cascada';
  v_neto_comp    numeric;
  v_impuestos    numeric;
  v_dto          numeric;
  v_sufijo_oc    text;
  v_venc_monto   numeric;
  v_canal        text;
  v_pagos        jsonb;
  v_pago         jsonb;
  v_n_pagos      int;
  v_i            int;
  v_monto        numeric;
  v_resto        numeric;
  v_venc_i       uuid;
  v_creados      int := 0;
  v_estimados    int := 0;
  v_saldo        numeric;
  v_pagado_antes numeric := 0;
BEGIN
  SELECT * INTO v FROM comprobantes_compra WHERE id = p_comprobante_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El comprobante no existe (puede que lo hayan eliminado).' USING ERRCODE = 'P0002', DETAIL = 'no_encontrado';
  END IF;

  -- ── 1. Ya validado: no se repite nada ──
  IF v.estado IN ('validado', 'cerrado') THEN
    SELECT id INTO v_mov FROM cuenta_corriente_proveedores
     WHERE referencia_tipo = 'comprobante_compra' AND referencia_id = p_comprobante_id
     ORDER BY created_at LIMIT 1;
    RETURN jsonb_build_object('success', true, 'ya_validado', true, 'comprobante_id', p_comprobante_id, 'movimiento_cc_id', v_mov);
  END IF;

  -- ── 2. Controles ──
  IF v.estado = 'esperada' THEN
    RAISE EXCEPTION 'Es una nota de crédito esperada: se registra desde "NC pendientes" cuando llega el documento, no se valida acá.'
      USING ERRCODE = 'P0001', DETAIL = 'nc_esperada';
  END IF;

  -- Un remito NO se valida (decisión de Juan, 17/11): solo trae cantidades. Validar es dar
  -- por buenas cantidades Y precios, y eso lo hace la factura.
  IF v.tipo_comprobante = 'Remito' THEN
    RAISE EXCEPTION 'Un remito no se valida: solo sirve para controlar las cantidades contra lo recibido. Para controlar los precios y registrar la deuda hace falta la factura.'
      USING ERRCODE = 'P0001', DETAIL = 'remito_no_se_valida';
  END IF;

  SELECT count(*) INTO v_sin_articulo
    FROM comprobantes_compra_detalle
   WHERE comprobante_id = p_comprobante_id AND articulo_id IS NULL
     -- los renglones marcados "no es mercadería" (flete, etc.) quedan en el comprobante y no frenan
     AND coalesce(match_estado, '') <> 'no_mercaderia';
  IF v_sin_articulo > 0 THEN
    RAISE EXCEPTION 'Hay % renglón(es) del comprobante sin vincular a un artículo. Vinculalos (o marcá "No es mercadería" los que sean flete u otro concepto) en "Revisar matches" antes de validar.', v_sin_articulo
      USING ERRCODE = 'P0001', DETAIL = 'lineas_sin_articulo';
  END IF;

  v_total       := coalesce(v.total_factura_declarado, 0);
  v_credito     := v.tipo_comprobante IN ('NC', 'NCA', 'NCB', 'NCC', 'Reversa');
  v_debito_nota := v.tipo_comprobante IN ('ND', 'NDA', 'NDB', 'NDC');
  v_documental  := v.tipo_comprobante = 'Remito';

  IF NOT v_documental AND v_total <= 0 THEN
    RAISE EXCEPTION 'El comprobante % % no tiene total. Cargale el total (lápiz de editar) antes de validarlo; si es solo un remito, cambiale el tipo a Remito (un remito no se valida).', v.tipo_comprobante, v.numero_comprobante
      USING ERRCODE = 'P0001', DETAIL = 'sin_total';
  END IF;

  -- ── E-46 (regla de Juan, 17/11): los renglones tienen que sumar lo que dice el comprobante ──
  -- Misma cuenta que lib/compras/control-suma.ts. Se toleran centavos: la diferencia tiene que
  -- ser MENOR a $1 (20 contra 21 ya es un error).
  -- Lo que una factura trae además del neto. La retención de Ganancias NO va: no viene en la
  -- factura, la hacemos nosotros al pagar.
  v_impuestos := coalesce(v.total_iva, 0) + coalesce(v.percepcion_iva_monto, 0) + coalesce(v.percepcion_iibb_monto, 0)
               + coalesce(v.impuestos_internos, 0) + coalesce(v.otros_impuestos, 0);
  v_neto_comp := round(CASE WHEN coalesce(v.total_neto, 0) > 0 THEN v.total_neto ELSE v_total - v_impuestos END, 2);

  -- B. Primero la cabecera: neto + impuestos contra el total. Si no cierra, lo que está mal son
  --    los datos del comprobante, no los renglones.
  IF v_total > 0 AND abs(round(v_neto_comp + v_impuestos, 2) - v_total) >= 1 THEN
    RAISE EXCEPTION 'Los datos del comprobante no cierran: neto $% más impuestos $% da $% y el total dice $%. Corregí neto, IVA, percepciones u otros impuestos. No se validó.', v_neto_comp, round(v_impuestos, 2), round(v_neto_comp + v_impuestos, 2), v_total
      USING ERRCODE = 'P0001', DETAIL = 'renglones_no_suman';
  END IF;

  -- A. Renglones contra el neto. El importe de un renglón se arma de dos formas (cantidad × lista ×
  --    descuentos redondeado una vez, o cantidad × neto por unidad ya redondeado); con muchas
  --    unidades difieren en centavos. Pasa si CUALQUIERA de las dos cierra.
  IF v.tipo_comprobante IN ('FA', 'FB', 'FC', 'Adquisicion', 'ADQ') THEN
    -- Los descuentos del renglón se aplican como dice la ficha del proveedor: en cascada (uno sobre
    -- el otro) o sobre la lista (se suman). Sin dato: en cascada.
    SELECT coalesce(pr.tipo_descuento, 'cascada') INTO v_tipo_dto
      FROM proveedores pr
     WHERE pr.id = coalesce(v.proveedor_id, (SELECT oc.proveedor_id FROM ordenes_compra oc WHERE oc.id = v.orden_compra_id));
    v_tipo_dto := coalesce(v_tipo_dto, 'cascada');
    SELECT coalesce(sum(round(coalesce(d.cantidad_facturada, 0) * public.oc_neto_unitario(d.precio_unitario, d.descuento1, d.descuento2, d.descuento3, d.descuento4, v_tipo_dto), 2)), 0),
           coalesce(sum(round(coalesce(d.cantidad_facturada, 0) * round(public.oc_neto_unitario(d.precio_unitario, d.descuento1, d.descuento2, d.descuento3, d.descuento4, v_tipo_dto), 2), 2)), 0)
      INTO v_suma, v_suma2
      FROM comprobantes_compra_detalle d
     WHERE d.comprobante_id = p_comprobante_id;
    v_dto := coalesce(v.descuento_fuera_factura, 0);
    IF NOT (
         abs(v_suma - v_neto_comp) < 1 OR abs(v_suma2 - v_neto_comp) < 1
         OR (v_dto > 0 AND v_dto <= 100 AND (abs(round(v_suma * (1 - v_dto / 100.0), 2) - v_neto_comp) < 1
                                             OR abs(round(v_suma2 * (1 - v_dto / 100.0), 2) - v_neto_comp) < 1))
       ) THEN
      RAISE EXCEPTION 'Los renglones suman $% y la factura dice $%: hay $% de diferencia. Revisá los renglones leídos. No se validó.', v_suma, v_neto_comp, abs(v_neto_comp - v_suma)
        USING ERRCODE = 'P0001', DETAIL = 'renglones_no_suman';
    END IF;
  END IF;

  v_oc := v.orden_compra_id;
  IF v_oc IS NOT NULL THEN
    -- Dos comprobantes de la misma OC validándose a la vez: de a uno (la provisión es compartida)
    SELECT proveedor_id, numero_orden INTO v_prov, v_numero_oc FROM ordenes_compra WHERE id = v_oc FOR UPDATE;
  END IF;
  v_prov := coalesce(v.proveedor_id, v_prov);
  v_numero_oc := coalesce(v_numero_oc, p_plan ->> 'numero_orden');
  v_sufijo_oc := CASE WHEN v_oc IS NOT NULL THEN ' — OC ' || coalesce(v_numero_oc, '') ELSE '' END;

  IF NOT v_documental AND v_prov IS NULL THEN
    RAISE EXCEPTION 'El comprobante % % no tiene proveedor: no se puede registrar la deuda. Asignale el proveedor antes de validar.', v.tipo_comprobante, v.numero_comprobante
      USING ERRCODE = 'P0001', DETAIL = 'sin_proveedor';
  END IF;

  UPDATE comprobantes_compra
     SET estado = 'validado',
         saldo_pendiente = CASE WHEN v_credito THEN -v_total ELSE v_total END,
         estado_pago = 'pendiente'
   WHERE id = p_comprobante_id;
  PERFORM public.comprobante_compra_marcar_validador(p_comprobante_id, p_usuario_id);

  -- ── 4. Movimiento en la cuenta corriente del proveedor ──
  -- Con o sin orden de compra (decisión de Juan, 16/11: un comprobante sin OC también es deuda).
  IF v_prov IS NOT NULL THEN
    v_fecha := CASE WHEN v.fecha_comprobante IS NOT NULL
                    THEN (v.fecha_comprobante::date + time '12:00') AT TIME ZONE 'America/Argentina/Buenos_Aires'
                    ELSE now() END;
    v_desc := v.tipo_comprobante || ' ' || v.numero_comprobante || v_sufijo_oc;

    -- ¿Ya está en la cuenta corriente? (validación anterior a medias)
    SELECT id INTO v_mov FROM cuenta_corriente_proveedores
     WHERE referencia_tipo = 'comprobante_compra' AND referencia_id = p_comprobante_id
     ORDER BY created_at LIMIT 1;

    -- ¿Entró por mail? El procesador de mails ya dejó la deuda en la cuenta corriente
    -- (convierte la provisión de la OC en "factura", o crea un movimiento 'gmail') sin
    -- vincularla al comprobante. Cuál es ese movimiento lo decide el servidor ANTES de
    -- llamar (por número normalizado; si es ambiguo no llama: frena con un mensaje) y lo
    -- manda en p_plan.movimiento_adoptar. Acá se bloquea, se comprueba y se adopta.
    v_adoptar := nullif(p_plan ->> 'movimiento_adoptar', '')::uuid;
    IF v_mov IS NULL AND v_adoptar IS NOT NULL THEN
      SELECT id INTO v_mov FROM cuenta_corriente_proveedores
       WHERE id = v_adoptar
         AND proveedor_id = v_prov
         AND tipo_movimiento IN ('factura', 'nota_credito', 'nota_debito')
         AND referencia_tipo IN ('orden_compra', 'gmail')
         FOR UPDATE;
      IF v_mov IS NULL THEN
        RAISE EXCEPTION 'El movimiento de la cuenta corriente que correspondía a este comprobante cambió mientras se validaba. No se validó nada: volvé a intentar.'
          USING ERRCODE = 'P0001', DETAIL = 'movimiento_cambio';
      END IF;
    END IF;

    -- Movimiento que ya existía (validación a medias o entró por mail): queda vinculado al
    -- comprobante y con sus datos de hoy. No se crea otro.
    IF v_mov IS NOT NULL THEN
      UPDATE cuenta_corriente_proveedores
         SET referencia_tipo = 'comprobante_compra', referencia_id = p_comprobante_id,
             tipo_movimiento = CASE WHEN v_credito THEN 'nota_credito' WHEN v_debito_nota THEN 'nota_debito' ELSE 'factura' END,
             monto = CASE WHEN v_credito THEN -v_total ELSE v_total END,
             descripcion = v_desc, numero_comprobante = v.numero_comprobante,
             tipo_comprobante = v.tipo_comprobante, fecha = v_fecha, updated_at = now()
       WHERE id = v_mov;
    END IF;

    IF v_mov IS NULL THEN
      INSERT INTO cuenta_corriente_proveedores (
        proveedor_id, tipo_movimiento, monto, descripcion,
        referencia_id, referencia_tipo, numero_comprobante, tipo_comprobante, fecha
      ) VALUES (
        v_prov,
        CASE WHEN v_credito THEN 'nota_credito' WHEN v_debito_nota THEN 'nota_debito' ELSE 'factura' END,
        CASE WHEN v_credito THEN -v_total ELSE v_total END,
        v_desc, p_comprobante_id, 'comprobante_compra', v.numero_comprobante, v.tipo_comprobante, v_fecha
      ) RETURNING id INTO v_mov;
      v_mov_nuevo := true;
    END IF;

    -- ── 5. Provisión de la OC (solo la tocan los comprobantes de DEUDA) ──
    -- Una nota de débito NO es la factura de la orden: no baja la provisión.
    IF NOT v_credito AND NOT v_debito_nota AND v_oc IS NOT NULL THEN
      SELECT count(*) INTO v_otros
        FROM comprobantes_compra
       WHERE orden_compra_id = v_oc
         AND id <> p_comprobante_id
         AND estado NOT IN ('validado', 'cerrado', 'esperada')
         AND tipo_comprobante NOT IN ('Remito', 'NC', 'NCA', 'NCB', 'NCC', 'Reversa')
         -- solo los del mismo canal: una adquisición (sin factura) no espera a una factura ni al revés
         AND (tipo_comprobante IN ('Adquisicion', 'ADQ')) = (p_plan ->> 'canal' = 'negro');

      v_restante := v_total;
      v_provision := 'sin_provision';
      FOR v_prov_row IN
        SELECT id, monto FROM cuenta_corriente_proveedores
         WHERE referencia_tipo = 'orden_compra' AND referencia_id = v_oc AND tipo_movimiento = 'orden_compra'
           -- Una orden mixta tiene DOS provisiones (con factura / sin factura): este comprobante baja
           -- solo la de su canal. Las provisiones viejas, sin canal, se bajan como antes.
           AND (canal IS NULL OR canal = CASE WHEN p_plan ->> 'canal' = 'negro' THEN 'negro' ELSE 'blanco' END)
         ORDER BY created_at
           FOR UPDATE
      LOOP
        IF v_otros = 0 OR v_prov_row.monto - v_restante <= 0.01 THEN
          -- No queda nada por validar en la OC, o este comprobante cubre la provisión: se va
          DELETE FROM cuenta_corriente_proveedores WHERE id = v_prov_row.id;
          v_restante := greatest(0, v_restante - v_prov_row.monto);
          v_provision := 'eliminada';
        ELSE
          -- Quedan comprobantes sin validar: la provisión baja solo por lo ya facturado
          UPDATE cuenta_corriente_proveedores
             SET monto = round(v_prov_row.monto - v_restante, 2),
                 descripcion = 'Provisión OC: ' || coalesce(v_numero_oc, '') || ' (resto sin facturar)',
                 updated_at = now()
           WHERE id = v_prov_row.id;
          v_restante := 0;
          v_provision := 'reducida';
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- ── 6. Vencimiento (solo deuda) ──
  IF NOT v_credito THEN
    v_fecha_venc  := coalesce(v.fecha_vencimiento::date, nullif(p_plan ->> 'fecha_vencimiento', '')::date);
    v_fecha_valid := nullif(p_plan ->> 'fecha_validez', '')::date;
    v_canal := CASE WHEN p_plan ->> 'canal' = 'negro' THEN 'negro' ELSE 'blanco' END;
    -- Pagos acordados (lib/compras/acuerdo-pago.ts): uno solo, o uno por cuota "30/60/90"
    v_pagos := CASE WHEN jsonb_typeof(p_plan -> 'pagos') = 'array' AND jsonb_array_length(p_plan -> 'pagos') > 0
                    THEN p_plan -> 'pagos' ELSE NULL END;
    IF v_fecha_venc IS NULL AND v_pagos IS NOT NULL THEN
      v_fecha_venc := nullif(v_pagos -> 0 ->> 'fecha', '')::date;
    END IF;

    IF v_fecha_venc IS NOT NULL AND v.fecha_vencimiento IS NULL THEN
      UPDATE comprobantes_compra SET fecha_vencimiento = v_fecha_venc WHERE id = p_comprobante_id;
    END IF;

    -- Los vencimientos que ya existen NO se tocan (son las anotaciones reales de Juan)
    SELECT id, monto INTO v_venc, v_venc_monto FROM vencimientos
     WHERE estado <> 'cancelado'
       AND ((referencia_tipo = 'comprobante_compra' AND referencia_id = p_comprobante_id)
         OR (v_mov IS NOT NULL AND referencia_tipo = 'cuenta_corriente' AND referencia_id = v_mov))
     LIMIT 1;

    IF v_venc IS NULL AND v_fecha_venc IS NOT NULL THEN
     BEGIN
      -- Sin lista de pagos (servidor anterior): un solo vencimiento por el total, como siempre
      IF v_pagos IS NULL THEN
        v_pagos := jsonb_build_array(jsonb_build_object(
          'fecha', v_fecha_venc, 'monto', v_total,
          'forma_pago', p_plan ->> 'forma_pago', 'modalidad', p_plan ->> 'modalidad', 'fecha_validez', p_plan ->> 'fecha_validez'));
      END IF;
      v_n_pagos := jsonb_array_length(v_pagos);
      v_resto := v_total;
      FOR v_i IN 0 .. v_n_pagos - 1 LOOP
        v_pago := v_pagos -> v_i;
        -- La última cuota se lleva el resto: las cuotas SIEMPRE suman el total del comprobante
        v_monto := CASE WHEN v_i = v_n_pagos - 1 THEN v_resto
                        ELSE round(coalesce(nullif(v_pago ->> 'monto', '')::numeric, v_total / v_n_pagos), 2) END;
        IF v_monto <= 0 THEN
          RAISE EXCEPTION 'las cuotas no suman el total del comprobante';
        END IF;
        v_resto := v_resto - v_monto;
        INSERT INTO vencimientos (
          proveedor_id, tipo, canal, concepto, monto, fecha_vencimiento, estado,
          forma_pago, modalidad, fecha_validez, referencia_id, referencia_tipo
        ) VALUES (
          v_prov, 'factura', v_canal,
          v.tipo_comprobante || ' ' || v.numero_comprobante || v_sufijo_oc
            || CASE WHEN v_n_pagos > 1 THEN ' — cuota ' || (v_i + 1) || '/' || v_n_pagos ELSE '' END,
          v_monto, coalesce(nullif(v_pago ->> 'fecha', '')::date, v_fecha_venc), 'pendiente',
          nullif(v_pago ->> 'forma_pago', ''), nullif(v_pago ->> 'modalidad', ''), nullif(v_pago ->> 'fecha_validez', '')::date,
          coalesce(v_mov, p_comprobante_id),
          CASE WHEN v_mov IS NOT NULL THEN 'cuenta_corriente' ELSE 'comprobante_compra' END
        ) RETURNING id INTO v_venc_i;
        IF v_i = 0 THEN v_venc := v_venc_i; END IF;
        v_creados := v_creados + 1;
      END LOOP;
      v_venc_nuevo := true;
      v_venc_monto := v_total;
     EXCEPTION WHEN OTHERS THEN
      -- Deuda sin vencimiento = pago que se olvida. Todo o nada: se deshace la validación entera.
      RAISE EXCEPTION 'No se pudo crear el vencimiento del comprobante (%). No se validó nada: avisá a sistemas con este mensaje.', SQLERRM
        USING ERRCODE = 'P0001', DETAIL = 'vencimiento_fallido';
     END;
    END IF;

    -- ── 7. El vencimiento ESTIMADO de la orden deja lugar al real ──
    -- SOLO cuando el vencimiento real nació en ESTA validación (v_venc_nuevo): es el único lugar
    -- donde nace el vencimiento de una factura de una orden, así que el estimado se descuenta una
    -- sola vez. Si el vencimiento ya existía (uno cargado a mano, o de una factura que entró por
    -- mail antes de este cambio), el estimado no se toca: se quita al finalizar la orden.
    -- Una nota de débito tampoco lo descuenta: no es la factura de la mercadería pedida.
    -- Baja los estimados de ESE canal por el importe del comprobante, del más próximo al más
    -- lejano, y borra los que llegan a cero: si la orden se factura en partes, queda estimado solo
    -- lo que falta. No toca ningún vencimiento que no sea un estimado de esta orden.
    IF v_oc IS NOT NULL AND v_venc IS NOT NULL AND v_venc_nuevo AND NOT v_debito_nota THEN
      v_estimados := public.oc_vencimiento_estimado_reemplazar(v_oc, v_canal, v_total);
    END IF;

    -- ── 8. Lo que ya se pagó antes de validar ──
    -- Una factura que entró por mail deja la deuda en la cuenta corriente y se puede pagar con una
    -- orden de pago antes de validarla. Los vencimientos que acaban de nacer salen por el total:
    -- se acomodan al SALDO real del movimiento (cuotas más próximas primero), con la misma función
    -- que usan las órdenes de pago. p_op_id va con un id que no es de ninguna orden: así la cuota
    -- que queda cancelada se anota a nombre de la orden que de verdad pagó ese comprobante.
    IF v_mov IS NOT NULL AND v_venc_nuevo THEN
      v_saldo := public.cc_proveedor_saldo_movimiento(v_mov);
      IF v_saldo IS NOT NULL AND v_saldo < v_total - 0.01 THEN
        v_pagado_antes := round(v_total - greatest(v_saldo, 0), 2);
        PERFORM public.op_vencimientos_sincronizar_movimiento(v_mov, '00000000-0000-0000-0000-000000000000'::uuid, false);
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true, 'ya_validado', false, 'comprobante_id', p_comprobante_id,
    'sin_deuda', false,
    'movimiento_cc_id', v_mov, 'movimiento_cc_nuevo', v_mov_nuevo,
    'vencimiento_id', v_venc, 'vencimiento_nuevo', v_venc_nuevo, 'vencimiento_monto', v_venc_monto,
    'sin_vencimiento', (NOT v_credito AND v_venc IS NULL),
    'provision', v_provision,
    'vencimientos_creados', v_creados, 'estimados_reemplazados', v_estimados,
    'pagado_antes', v_pagado_antes
  );
END;
$$;

COMMENT ON FUNCTION public.comprobante_compra_validar(uuid, uuid, jsonb) IS
  'Valida un comprobante de compra CON precios: estado + cuenta corriente + provisión de la OC + vencimiento real (uno por cuota) + reemplazo del vencimiento estimado de la orden, todo o nada y una sola vez (E-32). Un remito no se valida; los renglones tienen que sumar el neto y el neto más impuestos el total (E-46).';

-- Solo la llama el servidor (cliente de servicio): nadie la ejecuta desde el navegador.
REVOKE ALL ON FUNCTION public.comprobante_compra_validar(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.comprobante_compra_validar(uuid, uuid, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';

-- ═══ B. Cierre de lo estimado al finalizar la orden ═══
-- La orden finalizada ya tiene sus facturas validadas (deuda real en la cuenta corriente, con sus
-- vencimientos). Lo que quedó ESTIMADO de la orden ya no corresponde:
--   · provisión en la cuenta corriente (movimientos 'orden_compra' de ESA orden);
--   · vencimientos estimados de ESA orden que nadie pagó ni imputó;
--   · kardex de compra pendiente ("en camino") de ESA orden.
-- No toca facturas, pagos, vencimientos reales ni stock.
CREATE OR REPLACE FUNCTION public.oc_cerrar_estimados(p_orden_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  o        record;
  v_prov   int := 0;
  v_venc   int := 0;
  v_kardex int := 0;
BEGIN
  SELECT id, numero_orden, estado INTO o FROM ordenes_compra WHERE id = p_orden_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La orden no existe.' USING ERRCODE = 'P0002', DETAIL = 'no_encontrada';
  END IF;
  IF o.estado NOT IN ('finalizada', 'cancelada') THEN
    RAISE EXCEPTION 'La orden % está %: lo estimado solo se quita cuando la orden está finalizada o cancelada.', o.numero_orden, replace(o.estado, '_', ' ')
      USING ERRCODE = 'P0001', DETAIL = 'orden_abierta';
  END IF;

  DELETE FROM cuenta_corriente_proveedores
   WHERE referencia_tipo = 'orden_compra' AND referencia_id = p_orden_id AND tipo_movimiento = 'orden_compra';
  GET DIAGNOSTICS v_prov = ROW_COUNT;

  v_venc := public.oc_vencimiento_estimado_reemplazar(p_orden_id);

  DELETE FROM kardex
   WHERE orden_compra_id = p_orden_id AND tipo_movimiento = 'compra' AND estado = 'pendiente';
  GET DIAGNOSTICS v_kardex = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'provisiones_quitadas', v_prov, 'vencimientos_estimados_quitados', v_venc, 'kardex_en_camino_quitado', v_kardex);
END;
$$;

COMMENT ON FUNCTION public.oc_cerrar_estimados(uuid) IS
  'Al finalizar (o cancelar) una orden de compra: quita su provisión en la cuenta corriente, sus vencimientos estimados y su kardex "en camino". No toca nada real.';

REVOKE ALL ON FUNCTION public.oc_cerrar_estimados(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.oc_cerrar_estimados(uuid) TO service_role;

-- ═══ C. Marca de que el cableado está instalado ═══
-- El servidor la consulta antes de validar un comprobante de una orden de compra: si no está,
-- contesta "falta aplicar la migración 20261117u" y no hace nada.
CREATE OR REPLACE FUNCTION public.entrada_cableado_version()
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$ SELECT '20261117u'::text $$;

REVOKE ALL ON FUNCTION public.entrada_cableado_version() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.entrada_cableado_version() TO service_role;
