-- ─────────────────────────────────────────────────────────────────────────────
-- Validar un comprobante de compra en UNA transacción, una sola vez.
-- Prueba integral de entrada, E-32 (16/11/2026).
--
-- Qué pasaba (app/api/comprobantes-compra/[id]/validar/route.ts hacía todo con
-- escrituras sueltas, sin mirar el estado):
--   · doble click en "Validar" (o "Finalizar OC" dos veces) = dos movimientos de
--     deuda en la cuenta corriente del proveedor y dos vencimientos;
--   · un remito (sin precios, total $0) se validaba como deuda de $0 y, de paso,
--     borraba la provisión de la OC: la deuda con el proveedor quedaba en cero
--     hasta que alguien validara la factura;
--   · el primer comprobante validado borraba TODA la provisión aunque faltaran
--     otros comprobantes de la misma OC;
--   · se validaba con renglones de la factura sin vincular a ningún artículo;
--   · si la factura había entrado por mail, la provisión ya estaba convertida en
--     "factura" y validar generaba un segundo movimiento y un segundo vencimiento.
--
-- Qué hace comprobante_compra_validar (todo o nada):
--   1. Bloquea el comprobante. Si ya está validado/cerrado ⇒ devuelve
--      ya_validado = true y no toca nada.
--   2. Rechaza: NC esperada, renglones sin artículo, total en 0 (salvo Remito).
--   3. Remito ⇒ queda validado como respaldo, SIN deuda ni vencimiento, y no toca
--      la provisión.
--   4. Deuda (factura, adquisición, nota de débito) o crédito (NC, reversa):
--      un movimiento en la cuenta corriente (si ya existe, lo reutiliza).
--   5. Provisión de la OC: se descuenta el total validado; se borra recién cuando
--      no quedan comprobantes de deuda sin validar en esa OC (o llega a 0).
--   6. Vencimiento (solo deuda): uno, si no existe ya.
--
-- Las fechas y la forma de pago del vencimiento las calcula el servidor con el
-- acuerdo de pago del proveedor (misma lógica de siempre) y vienen en p_plan:
--   { canal, fecha_vencimiento, forma_pago, modalidad, fecha_validez, numero_orden }
-- El kardex (confirmar lo pendiente, revalorizar lo que entró a $0) lo sigue
-- haciendo el servidor después: es repetible y no mueve plata.
--
-- Quién y cuándo validó se guarda en usuario_validador / fecha_validacion (las columnas
-- de la tabla original). El código viejo escribía validado_por / validado_at, que no
-- figuran en ningún script ni migración: si no existen en la base, ese UPDATE fallaba
-- en silencio y el comprobante nunca pasaba a "validado" (por eso se podía validar
-- infinitas veces). Verificar en la base.
--
-- No toca datos al instalarse: solo crea la función. Se puede correr más de una
-- vez. Sin esta migración el servidor sigue validando con las mismas reglas,
-- pero sin la garantía de "todo o nada".
-- ─────────────────────────────────────────────────────────────────────────────

-- Quién y cuándo validó. Aparte y tolerante: si esas columnas no existieran en la base,
-- la validación (estado, deuda, vencimiento) NO se frena por un dato de auditoría.
CREATE OR REPLACE FUNCTION public.comprobante_compra_marcar_validador(p_comprobante_id uuid, p_usuario_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  BEGIN
    UPDATE comprobantes_compra
       SET usuario_validador = p_usuario_id::text, fecha_validacion = now()
     WHERE id = p_comprobante_id;
  EXCEPTION WHEN undefined_column THEN
    RAISE NOTICE 'comprobantes_compra sin usuario_validador / fecha_validacion: no se guardó quién validó';
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.comprobante_compra_marcar_validador(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.comprobante_compra_marcar_validador(uuid, uuid) TO service_role;

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

  SELECT count(*) INTO v_sin_articulo
    FROM comprobantes_compra_detalle
   WHERE comprobante_id = p_comprobante_id AND articulo_id IS NULL;
  IF v_sin_articulo > 0 THEN
    RAISE EXCEPTION 'Hay % renglón(es) del comprobante sin vincular a un artículo. Vinculalos (o quitá los que no son mercadería) en "Revisar matches" antes de validar.', v_sin_articulo
      USING ERRCODE = 'P0001', DETAIL = 'lineas_sin_articulo';
  END IF;

  v_total       := coalesce(v.total_factura_declarado, 0);
  v_credito     := v.tipo_comprobante IN ('NC', 'NCA', 'NCB', 'NCC', 'Reversa');
  v_debito_nota := v.tipo_comprobante IN ('ND', 'NDA', 'NDB', 'NDC');
  v_documental  := v.tipo_comprobante = 'Remito';

  IF NOT v_documental AND v_total <= 0 THEN
    RAISE EXCEPTION 'El comprobante % % no tiene total. Cargale el total (lápiz de editar) antes de validarlo; si es solo un remito, cambiale el tipo a Remito.', v.tipo_comprobante, v.numero_comprobante
      USING ERRCODE = 'P0001', DETAIL = 'sin_total';
  END IF;

  v_oc := v.orden_compra_id;
  IF v_oc IS NOT NULL THEN
    -- Dos comprobantes de la misma OC validándose a la vez: de a uno (la provisión es compartida)
    SELECT proveedor_id, numero_orden INTO v_prov, v_numero_oc FROM ordenes_compra WHERE id = v_oc FOR UPDATE;
  END IF;
  v_prov := coalesce(v.proveedor_id, v_prov);
  v_numero_oc := coalesce(v_numero_oc, p_plan ->> 'numero_orden');

  -- ── 3. Remito: respaldo de cantidades, sin deuda ──
  IF v_documental THEN
    UPDATE comprobantes_compra
       SET estado = 'validado', saldo_pendiente = 0, estado_pago = 'pendiente'
     WHERE id = p_comprobante_id;
    PERFORM public.comprobante_compra_marcar_validador(p_comprobante_id, p_usuario_id);
    RETURN jsonb_build_object('success', true, 'ya_validado', false, 'comprobante_id', p_comprobante_id,
                              'sin_deuda', true, 'movimiento_cc_id', NULL, 'vencimiento_id', NULL, 'provision', 'intacta');
  END IF;

  UPDATE comprobantes_compra
     SET estado = 'validado',
         saldo_pendiente = CASE WHEN v_credito THEN -v_total ELSE v_total END,
         estado_pago = 'pendiente'
   WHERE id = p_comprobante_id;
  PERFORM public.comprobante_compra_marcar_validador(p_comprobante_id, p_usuario_id);

  -- ── 4. Movimiento en la cuenta corriente del proveedor ──
  -- (igual que antes: solo comprobantes de una OC; los que no tienen OC generan el vencimiento y nada más)
  IF v_oc IS NOT NULL AND v_prov IS NOT NULL THEN
    v_fecha := CASE WHEN v.fecha_comprobante IS NOT NULL
                    THEN (v.fecha_comprobante::date + time '12:00') AT TIME ZONE 'America/Argentina/Buenos_Aires'
                    ELSE now() END;
    v_desc := v.tipo_comprobante || ' ' || v.numero_comprobante || ' — OC ' || coalesce(v_numero_oc, '');

    -- ¿Ya está en la cuenta corriente? (validación anterior a medias)
    SELECT id INTO v_mov FROM cuenta_corriente_proveedores
     WHERE referencia_tipo = 'comprobante_compra' AND referencia_id = p_comprobante_id
     ORDER BY created_at LIMIT 1;

    -- ¿Entró por mail? El procesador de mails convierte la provisión de la OC en la
    -- factura (mismo número, sigue referenciada a la OC): es ESTE comprobante, se adopta.
    IF v_mov IS NULL THEN
      SELECT id INTO v_mov FROM cuenta_corriente_proveedores
       WHERE referencia_tipo = 'orden_compra' AND referencia_id = v_oc
         AND tipo_movimiento <> 'orden_compra'
         AND numero_comprobante IS NOT NULL
         AND numero_comprobante = v.numero_comprobante
       ORDER BY created_at LIMIT 1
         FOR UPDATE;
      IF v_mov IS NOT NULL THEN
        UPDATE cuenta_corriente_proveedores
           SET referencia_tipo = 'comprobante_compra', referencia_id = p_comprobante_id,
               tipo_movimiento = CASE WHEN v_credito THEN 'nota_credito' WHEN v_debito_nota THEN 'nota_debito' ELSE 'factura' END,
               monto = CASE WHEN v_credito THEN -v_total ELSE v_total END,
               descripcion = v_desc, tipo_comprobante = v.tipo_comprobante, fecha = v_fecha, updated_at = now()
         WHERE id = v_mov;
      END IF;
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
    IF NOT v_credito THEN
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

    SELECT id INTO v_venc FROM vencimientos
     WHERE estado <> 'cancelado'
       AND ((referencia_tipo = 'comprobante_compra' AND referencia_id = p_comprobante_id)
         OR (v_mov IS NOT NULL AND referencia_tipo = 'cuenta_corriente' AND referencia_id = v_mov))
     LIMIT 1;

    IF v_venc IS NULL AND v_fecha_venc IS NOT NULL THEN
      INSERT INTO vencimientos (
        proveedor_id, tipo, canal, concepto, monto, fecha_vencimiento, estado,
        forma_pago, modalidad, fecha_validez, referencia_id, referencia_tipo
      ) VALUES (
        v_prov, 'factura',
        CASE WHEN p_plan ->> 'canal' = 'negro' THEN 'negro' ELSE 'blanco' END,
        v.tipo_comprobante || ' ' || v.numero_comprobante || ' — OC ' || coalesce(v_numero_oc, ''),
        v_total, v_fecha_venc, 'pendiente',
        nullif(p_plan ->> 'forma_pago', ''), nullif(p_plan ->> 'modalidad', ''), v_fecha_valid,
        coalesce(v_mov, p_comprobante_id),
        CASE WHEN v_mov IS NOT NULL THEN 'cuenta_corriente' ELSE 'comprobante_compra' END
      ) RETURNING id INTO v_venc;
      v_venc_nuevo := true;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true, 'ya_validado', false, 'comprobante_id', p_comprobante_id,
    'sin_deuda', false,
    'movimiento_cc_id', v_mov, 'movimiento_cc_nuevo', v_mov_nuevo,
    'vencimiento_id', v_venc, 'vencimiento_nuevo', v_venc_nuevo,
    'sin_vencimiento', (NOT v_credito AND v_venc IS NULL),
    'provision', v_provision
  );
END;
$$;

COMMENT ON FUNCTION public.comprobante_compra_validar(uuid, uuid, jsonb) IS
  'Valida un comprobante de compra: estado + cuenta corriente del proveedor + provisión de la OC + vencimiento, todo o nada y una sola vez (E-32).';

-- Solo la llama el servidor (cliente de servicio): nadie la ejecuta desde el navegador.
REVOKE ALL ON FUNCTION public.comprobante_compra_validar(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.comprobante_compra_validar(uuid, uuid, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
