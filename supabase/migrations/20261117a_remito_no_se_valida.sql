-- ─────────────────────────────────────────────────────────────────────────────
-- Un remito no se valida. Decisión de Juan del 17/11/2026:
--   "No tiene sentido validar un remito, lo que buscamos con esta validación es que
--    las cantidades y precios estén bien, un remito solo va a traer cantidades, y sin
--    precio no deberíamos poder validar una orden de compra. Lo que sí podemos es
--    validar cantidades, pero no nos debería permitir cerrar la OC."
--
-- Qué cambia: comprobante_compra_validar (20261116c) dejaba el remito "validado sin
-- deuda". Ahora lo RECHAZA con un mensaje claro. Es la misma función, con ese único
-- cambio; el resto (cuenta corriente, provisión, vencimiento, todo o nada) queda igual.
--
-- El servidor ya rechaza el remito ANTES de llamar a la función, así que el código
-- funciona igual con o sin esta migración: es la segunda barrera. No toca datos (los
-- remitos que ya figuran "validado" quedan como están; no generaron deuda). Se puede
-- correr más de una vez. Que una OC con solo remitos no se pueda finalizar lo controla
-- el servidor (POST /api/ordenes-compra/[id]/finalizar), no esta función.
-- ─────────────────────────────────────────────────────────────────────────────

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
  v_sufijo_oc    text;
  v_venc_monto   numeric;
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
    IF NOT v_credito AND v_oc IS NOT NULL THEN
      SELECT count(*) INTO v_otros
        FROM comprobantes_compra
       WHERE orden_compra_id = v_oc
         AND id <> p_comprobante_id
         AND estado NOT IN ('validado', 'cerrado', 'esperada')
         AND tipo_comprobante NOT IN ('Remito', 'NC', 'NCA', 'NCB', 'NCC', 'Reversa');

      v_restante := v_total;
      v_provision := 'sin_provision';
      FOR v_prov_row IN
        SELECT id, monto FROM cuenta_corriente_proveedores
         WHERE referencia_tipo = 'orden_compra' AND referencia_id = v_oc AND tipo_movimiento = 'orden_compra'
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
      INSERT INTO vencimientos (
        proveedor_id, tipo, canal, concepto, monto, fecha_vencimiento, estado,
        forma_pago, modalidad, fecha_validez, referencia_id, referencia_tipo
      ) VALUES (
        v_prov, 'factura',
        CASE WHEN p_plan ->> 'canal' = 'negro' THEN 'negro' ELSE 'blanco' END,
        v.tipo_comprobante || ' ' || v.numero_comprobante || v_sufijo_oc,
        v_total, v_fecha_venc, 'pendiente',
        nullif(p_plan ->> 'forma_pago', ''), nullif(p_plan ->> 'modalidad', ''), v_fecha_valid,
        coalesce(v_mov, p_comprobante_id),
        CASE WHEN v_mov IS NOT NULL THEN 'cuenta_corriente' ELSE 'comprobante_compra' END
      ) RETURNING id INTO v_venc;
      v_venc_nuevo := true;
      v_venc_monto := v_total;
     EXCEPTION WHEN OTHERS THEN
      -- Deuda sin vencimiento = pago que se olvida. Todo o nada: se deshace la validación entera.
      RAISE EXCEPTION 'No se pudo crear el vencimiento del comprobante (%). No se validó nada: avisá a sistemas con este mensaje.', SQLERRM
        USING ERRCODE = 'P0001', DETAIL = 'vencimiento_fallido';
     END;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true, 'ya_validado', false, 'comprobante_id', p_comprobante_id,
    'sin_deuda', false,
    'movimiento_cc_id', v_mov, 'movimiento_cc_nuevo', v_mov_nuevo,
    'vencimiento_id', v_venc, 'vencimiento_nuevo', v_venc_nuevo, 'vencimiento_monto', v_venc_monto,
    'sin_vencimiento', (NOT v_credito AND v_venc IS NULL),
    'provision', v_provision
  );
END;
$$;

COMMENT ON FUNCTION public.comprobante_compra_validar(uuid, uuid, jsonb) IS
  'Valida un comprobante de compra CON precios: estado + cuenta corriente + provisión de la OC + vencimiento, todo o nada y una sola vez (E-32). Un remito no se valida (17/11).';

-- Solo la llama el servidor (cliente de servicio): nadie la ejecuta desde el navegador.
REVOKE ALL ON FUNCTION public.comprobante_compra_validar(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.comprobante_compra_validar(uuid, uuid, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
