-- ════════════════════════════════════════════════════════════════════════════════════════
-- Compras: revisión antes de producción (19/11/2026, rama salida-compras)
-- ════════════════════════════════════════════════════════════════════════════════════════
-- 1. comprobante_compra_deshacer_deuda (NUEVA): al eliminar un comprobante SIN validar que entró
--    por mail, su movimiento de cuenta corriente (referencia_tipo = 'comprobante_compra') vuelve a
--    ser la provisión de la orden (o se quita, si no había provisión que devolver). Antes quedaba
--    huérfano y, al volver a cargar el comprobante, la deuda quedaba dos veces.
-- 2. comprobante_compra_validar: también adopta un movimiento 'comprobante_compra' HUÉRFANO (su
--    comprobante ya no existe) que el servidor identificó como de este comprobante.
-- 3. oc_cancelar / oc_guardar: una recepción "borrador" (la crea la oficina al subir la factura)
--    en la que el depósito YA contó algo frena cancelar y editar la orden, igual que "en proceso".
-- 4. ordenes_compra: quién y cuándo aceptó finalizar con diferencias de precio/cantidad sin resolver.
--
-- Parte de la definición VIGENTE en la base al 19/11 (todas las migraciones hasta 20261119k
-- aplicadas). Idempotente: se puede correr más de una vez. Nunca borra vencimientos: los cancela.
-- ════════════════════════════════════════════════════════════════════════════════════════

-- ── 4. Diferencias aceptadas al finalizar ────────────────────────────────────────────────
ALTER TABLE public.ordenes_compra ADD COLUMN IF NOT EXISTS diferencias_aceptadas_at  timestamptz;
ALTER TABLE public.ordenes_compra ADD COLUMN IF NOT EXISTS diferencias_aceptadas_por uuid;
ALTER TABLE public.ordenes_compra ADD COLUMN IF NOT EXISTS diferencias_aceptadas     jsonb;
COMMENT ON COLUMN public.ordenes_compra.diferencias_aceptadas IS
  'Al finalizar con diferencias sin resolver: lista de artículos (sku, descripción, qué diferencia) que quien finalizó aceptó expresamente.';

-- ── 1. Deshacer la deuda de un comprobante sin validar ───────────────────────────────────
-- La llama el servidor ANTES de borrar el comprobante (lib/services/detalle.ts →
-- revertirComprobanteOCR). Si después falla el borrado, el comprobante queda sin deuda y al
-- validarlo nace como cualquier otro (baja la provisión una sola vez): no queda nada duplicado.
--
-- Cómo lo dejó el procesador de mails (lib/ai/email-invoice-processor.ts):
--   a. La factura cubría toda la provisión de su canal → la provisión SE CONVIRTIÓ en la factura.
--   b. La factura era por menos → la provisión bajó a "resto sin facturar" y la factura entró como
--      movimiento propio.
--   c. Sin provisión (o NC / ND, o sin orden) → la factura entró como movimiento propio.
-- Deshacer: lo que la factura le sacó a la provisión de su canal vuelve a la provisión (se suma a
-- la que quedó, o el movimiento vuelve a ser la provisión), con tope en lo que la orden todavía
-- estima para ese canal (total del canal − otros comprobantes de la orden − provisión que quedó).
-- Lo que no vuelve a la provisión se quita de la cuenta corriente. Con la orden finalizada o
-- cancelada no hay provisión que devolver: el movimiento solo se quita.
-- Frena (no cambia nada) si esa deuda ya tiene pagos imputados o vencimientos pagados.
CREATE OR REPLACE FUNCTION public.comprobante_compra_deshacer_deuda(p_comprobante_id uuid, p_usuario_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v            record;
  v_oc         uuid;
  v_oc_estado  text;
  v_oc_numero  text;
  v_oc_fecha   timestamptz;
  m            record;
  t            record;
  v_canal      text;
  v_convierte  boolean;
  v_total_can  numeric;
  v_otros      numeric;
  v_prov_hoy   numeric;
  v_vuelve     numeric;
  v_prov_id    uuid;
  v_quitados   int := 0;
  v_devuelto   numeric := 0;
  v_cancelados int := 0;
  v_n          int;
BEGIN
  SELECT * INTO v FROM comprobantes_compra WHERE id = p_comprobante_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'sin_comprobante', true);
  END IF;
  IF v.estado IN ('validado', 'cerrado') THEN
    RAISE EXCEPTION 'El comprobante % % ya fue validado: anulá la validación antes de eliminarlo.', v.tipo_comprobante, v.numero_comprobante
      USING ERRCODE = 'P0001', DETAIL = 'comprobante_validado';
  END IF;

  IF v.orden_compra_id IS NOT NULL THEN
    -- La provisión de la orden es compartida con la validación de otros comprobantes: de a uno
    SELECT id, numero_orden, estado, fecha_orden INTO v_oc, v_oc_numero, v_oc_estado, v_oc_fecha
      FROM ordenes_compra WHERE id = v.orden_compra_id FOR UPDATE;
  END IF;
  v_canal := CASE WHEN v.tipo_comprobante IN ('Adquisicion', 'ADQ') THEN 'negro' ELSE 'blanco' END;
  -- Solo una factura o una adquisición convierte la provisión (misma regla que el procesador)
  v_convierte := v.tipo_comprobante IN ('FA', 'FB', 'FC', 'Adquisicion', 'ADQ');

  FOR m IN
    SELECT * FROM cuenta_corriente_proveedores
     WHERE referencia_tipo = 'comprobante_compra' AND referencia_id = p_comprobante_id
     ORDER BY created_at
       FOR UPDATE
  LOOP
    -- ¿Ya se pagó (todo o en parte)? Entonces no se toca nada: primero hay que anular el pago.
    IF EXISTS (SELECT 1 FROM imputaciones_proveedores i WHERE i.id_movimiento_documento = m.id OR i.id_movimiento_pago = m.id)
       OR EXISTS (SELECT 1 FROM ordenes_pago_imputaciones x WHERE x.movimiento_cc_id = m.id)
       OR EXISTS (SELECT 1 FROM vencimientos ve
                   WHERE ve.referencia_tipo = 'cuenta_corriente' AND ve.referencia_id = m.id
                     AND (ve.estado = 'pagado' OR coalesce(ve.monto_pagado, 0) > 0)) THEN
      RAISE EXCEPTION 'El comprobante % % ya tiene pagos imputados en la cuenta corriente del proveedor: no se puede eliminar así. Anulá primero el pago (orden de pago) y después eliminalo.', v.tipo_comprobante, v.numero_comprobante
        USING ERRCODE = 'P0001', DETAIL = 'comprobante_con_pagos';
    END IF;

    -- Vencimientos de esa deuda (mails viejos los creaban al llegar): se CANCELAN, nunca se borran
    UPDATE vencimientos
       SET estado = 'cancelado',
           observaciones = left(coalesce(nullif(observaciones, '') || ' · ', '')
             || 'Cancelado: se eliminó el comprobante ' || v.tipo_comprobante || ' ' || v.numero_comprobante || ' sin validar.', 1000),
           actualizado_por = coalesce(p_usuario_id, actualizado_por),
           updated_at = now()
     WHERE referencia_tipo = 'cuenta_corriente' AND referencia_id = m.id
       AND estado IN ('pendiente', 'vencido');
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_cancelados := v_cancelados + v_n;

    -- ¿Cuánto de esta deuda era la provisión de la orden?
    v_vuelve := 0;
    v_prov_id := NULL;
    IF v_convierte AND coalesce(m.monto, 0) > 0 AND v_oc IS NOT NULL AND v_oc_estado NOT IN ('finalizada', 'cancelada') THEN
      SELECT * INTO t FROM oc_totales(v_oc);
      v_total_can := coalesce(CASE WHEN v_canal = 'negro' THEN t.total_negro ELSE t.total_blanco END, 0);
      -- Lo que ya facturan OTROS comprobantes de esta orden y de este canal (validados o por mail)
      SELECT coalesce(sum(cc.monto), 0) INTO v_otros
        FROM cuenta_corriente_proveedores cc
        JOIN comprobantes_compra c ON c.id = cc.referencia_id
       WHERE cc.referencia_tipo = 'comprobante_compra'
         AND c.orden_compra_id = v_oc
         AND c.id <> p_comprobante_id
         AND (c.tipo_comprobante IN ('Adquisicion', 'ADQ')) = (v_canal = 'negro')
         AND c.tipo_comprobante IN ('FA', 'FB', 'FC', 'Adquisicion', 'ADQ')
         AND cc.monto > 0;
      -- La provisión que quedó de este canal (las viejas, sin canal, valen para cualquiera)
      SELECT coalesce(sum(monto), 0) INTO v_prov_hoy
        FROM cuenta_corriente_proveedores
       WHERE referencia_tipo = 'orden_compra' AND referencia_id = v_oc AND tipo_movimiento = 'orden_compra'
         AND (canal IS NULL OR canal = v_canal);
      v_vuelve := round(least(m.monto, greatest(0, v_total_can - v_otros - v_prov_hoy)), 2);

      SELECT id INTO v_prov_id
        FROM cuenta_corriente_proveedores
       WHERE referencia_tipo = 'orden_compra' AND referencia_id = v_oc AND tipo_movimiento = 'orden_compra'
         AND (canal IS NULL OR canal = v_canal)
       ORDER BY (canal IS NULL), created_at
       LIMIT 1
         FOR UPDATE;
    END IF;

    IF v_vuelve > 0.01 AND v_prov_id IS NOT NULL THEN
      -- b. La provisión había bajado: recupera lo que le sacó esta factura; el movimiento se va
      UPDATE cuenta_corriente_proveedores
         SET monto = round(monto + v_vuelve, 2), updated_at = now()
       WHERE id = v_prov_id;
      DELETE FROM cuenta_corriente_proveedores WHERE id = m.id;
      v_devuelto := v_devuelto + v_vuelve;
    ELSIF v_vuelve > 0.01 THEN
      -- a. La provisión se había convertido en esta factura: vuelve a ser la provisión
      UPDATE cuenta_corriente_proveedores
         SET tipo_movimiento = 'orden_compra',
             referencia_tipo = 'orden_compra',
             referencia_id = v_oc,
             canal = v_canal,
             monto = v_vuelve,
             descripcion = 'Provisión OC: ' || coalesce(v_oc_numero, '')
               || CASE WHEN v_canal = 'negro' THEN ' — sin factura (estimado)' ELSE ' — con factura (estimado)' END,
             numero_comprobante = NULL,
             tipo_comprobante = NULL,
             fecha = coalesce(v_oc_fecha, fecha),
             updated_at = now()
       WHERE id = m.id;
      v_devuelto := v_devuelto + v_vuelve;
    ELSE
      -- c. No había provisión que devolver (NC / ND, sin orden, orden cerrada): la deuda se quita
      DELETE FROM cuenta_corriente_proveedores WHERE id = m.id;
    END IF;
    v_quitados := v_quitados + 1;
  END LOOP;

  -- Vencimientos colgados directo del comprobante (no debería haber sin validar): se cancelan
  UPDATE vencimientos
     SET estado = 'cancelado',
         observaciones = left(coalesce(nullif(observaciones, '') || ' · ', '')
           || 'Cancelado: se eliminó el comprobante ' || v.tipo_comprobante || ' ' || v.numero_comprobante || ' sin validar.', 1000),
         actualizado_por = coalesce(p_usuario_id, actualizado_por),
         updated_at = now()
   WHERE referencia_tipo = 'comprobante_compra' AND referencia_id = p_comprobante_id
     AND estado IN ('pendiente', 'vencido');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_cancelados := v_cancelados + v_n;

  RETURN jsonb_build_object('success', true, 'movimientos', v_quitados, 'provision_devuelta', v_devuelto,
                            'vencimientos_cancelados', v_cancelados);
END;
$function$;

REVOKE ALL ON FUNCTION public.comprobante_compra_deshacer_deuda(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.comprobante_compra_deshacer_deuda(uuid, uuid) TO service_role;

-- ── 2. Validar: adopta también un movimiento huérfano de un comprobante eliminado ──────────
-- Igual a la vigente (20261119k) salvo el bloque marcado (19/11) en "¿Entró por mail?".
CREATE OR REPLACE FUNCTION public.comprobante_compra_validar(p_comprobante_id uuid, p_usuario_id uuid, p_plan jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
  v_enlazar      jsonb;
  v_e            record;
  v_enlazado     boolean := false;
  v_n_enl        int := 0;
  v_suma_enl     numeric := 0;
  v_ultimo_enl   uuid;
  v_monto_enl    numeric;
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
         AND (referencia_tipo IN ('orden_compra', 'gmail')
              -- (19/11) o el de un comprobante que se eliminó sin deshacer su deuda (huérfano):
              -- el servidor (buscarMovimientoPrevio) ya comprobó que es de este comprobante
              OR (referencia_tipo = 'comprobante_compra'
                  AND NOT EXISTS (SELECT 1 FROM comprobantes_compra c2
                                   WHERE c2.id = cuenta_corriente_proveedores.referencia_id)))
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
    -- SOLO si el movimiento de deuda nació en ESTA validación (v_mov_nuevo). Si ya existía —una
    -- factura que entró por mail: el procesador ya bajó la provisión al dejar la deuda, o la
    -- convirtió entera— no se vuelve a restar: se restaría dos veces lo mismo.
    IF NOT v_credito AND NOT v_debito_nota AND v_oc IS NOT NULL AND v_mov_nuevo THEN
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
        EXIT WHEN v_restante <= 0.01;
        IF v_prov_row.monto - v_restante <= 0.01 THEN
          -- Este comprobante cubre la provisión: se va. (Antes también se iba entera cuando no había
          -- otro comprobante cargado sin validar, aunque este fuera por una parte de la orden.)
          DELETE FROM cuenta_corriente_proveedores WHERE id = v_prov_row.id;
          v_restante := greatest(0, v_restante - v_prov_row.monto);
          v_provision := 'eliminada';
        ELSE
          -- La provisión baja solo por lo facturado: el resto sigue siendo deuda estimada
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

    -- ── 6.b Vencimientos que ya estaban ANOTADOS A MANO en el calendario (E-102) ──
    -- Quien valida dijo "es esta factura": en vez de crear otro vencimiento (la deuda quedaba dos
    -- veces en el calendario), el anotado a mano pasa a ser el vencimiento del comprobante. Se
    -- conservan su fecha y su concepto (es la anotación de Juan). NUNCA se borra nada.
    --   · Uno solo elegido: queda por el TOTAL del comprobante (si el importe anotado era otro, se
    --     ajusta y queda dicho en observaciones). No se crean cuotas: manda lo que ya estaba anotado.
    --   · Varios elegidos (las cuotas ya estaban anotadas): quedan todos enlazados con su importe; si
    --     entre todos no suman el total, la diferencia va al último.
    v_enlazar := CASE WHEN jsonb_typeof(p_plan -> 'enlazar_vencimientos') = 'array' AND jsonb_array_length(p_plan -> 'enlazar_vencimientos') > 0
                      THEN p_plan -> 'enlazar_vencimientos' ELSE NULL END;
    IF v_venc IS NULL AND v_enlazar IS NOT NULL THEN
      FOR v_e IN
        SELECT ve.* FROM vencimientos ve
         WHERE ve.id IN (SELECT x::uuid FROM jsonb_array_elements_text(v_enlazar) x)
         ORDER BY ve.fecha_vencimiento, ve.id
           FOR UPDATE
      LOOP
        -- Tiene que seguir siendo un vencimiento a mano, pendiente, de este proveedor y sin enlazar
        IF v_e.proveedor_id IS DISTINCT FROM v_prov
           OR v_e.estado NOT IN ('pendiente', 'vencido')
           OR coalesce(v_e.es_estimado, false)
           OR (v_e.referencia_id IS NOT NULL AND coalesce(v_e.referencia_tipo, '') IN ('cuenta_corriente', 'comprobante_compra', 'orden_compra')) THEN
          RAISE EXCEPTION 'El vencimiento anotado a mano que se quiso enlazar cambió mientras se validaba (se pagó, se canceló o ya está enlazado a otro comprobante). No se validó nada: volvé a intentar.'
            USING ERRCODE = 'P0001', DETAIL = 'vencimiento_cambio';
        END IF;
        UPDATE vencimientos
           SET referencia_id = coalesce(v_mov, p_comprobante_id),
               referencia_tipo = CASE WHEN v_mov IS NOT NULL THEN 'cuenta_corriente' ELSE 'comprobante_compra' END,
               canal = coalesce(canal, v_canal),
               observaciones = left(coalesce(nullif(observaciones, '') || ' · ', '')
                 || 'Estaba anotado a mano; se enlazó al validar ' || v.tipo_comprobante || ' ' || v.numero_comprobante || v_sufijo_oc || '.', 1000),
               actualizado_por = coalesce(p_usuario_id, actualizado_por),
               updated_at = now()
         WHERE id = v_e.id;
        v_n_enl := v_n_enl + 1;
        v_suma_enl := v_suma_enl + coalesce(v_e.monto, 0);
        v_ultimo_enl := v_e.id;
        IF v_venc IS NULL THEN v_venc := v_e.id; END IF;
      END LOOP;
      IF v_n_enl = 0 THEN
        RAISE EXCEPTION 'El vencimiento anotado a mano que se quiso enlazar ya no existe. No se validó nada: volvé a intentar.'
          USING ERRCODE = 'P0001', DETAIL = 'vencimiento_cambio';
      END IF;
      -- La deuda es el total del comprobante: si lo anotado no da eso, se ajusta el último
      IF abs(v_suma_enl - v_total) > 0.01 THEN
        SELECT monto INTO v_monto_enl FROM vencimientos WHERE id = v_ultimo_enl;
        IF round(v_monto_enl + (v_total - v_suma_enl), 2) <= 0 THEN
          RAISE EXCEPTION 'Los vencimientos elegidos suman $% y el comprobante es por $%: no pueden ser todos de esta factura. No se validó nada.', v_suma_enl, v_total
            USING ERRCODE = 'P0001', DETAIL = 'vencimientos_de_mas';
        END IF;
        UPDATE vencimientos
           SET monto = round(v_monto_enl + (v_total - v_suma_enl), 2),
               observaciones = left(coalesce(nullif(observaciones, '') || ' · ', '')
                 || 'Importe ajustado de $' || v_monto_enl::text || ' a $' || round(v_monto_enl + (v_total - v_suma_enl), 2)::text
                 || ': el comprobante validado es por $' || v_total::text || '.', 1000),
               updated_at = now()
         WHERE id = v_ultimo_enl;
      END IF;
      v_enlazado := true;
      v_venc_monto := v_total;
    END IF;

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
    IF v_oc IS NOT NULL AND v_venc IS NOT NULL AND (v_venc_nuevo OR v_enlazado) AND NOT v_debito_nota THEN
      v_estimados := public.oc_vencimiento_estimado_reemplazar(v_oc, v_canal, v_total);
    END IF;

    -- ── 8. Lo que ya se pagó antes de validar ──
    -- Una factura que entró por mail deja la deuda en la cuenta corriente y se puede pagar con una
    -- orden de pago antes de validarla. Los vencimientos que acaban de nacer salen por el total:
    -- se acomodan al SALDO real del movimiento (cuotas más próximas primero), con la misma función
    -- que usan las órdenes de pago. p_op_id va con un id que no es de ninguna orden: así la cuota
    -- que queda cancelada se anota a nombre de la orden que de verdad pagó ese comprobante.
    IF v_mov IS NOT NULL AND (v_venc_nuevo OR v_enlazado) THEN
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
    'pagado_antes', v_pagado_antes,
    'vencimientos_enlazados', v_n_enl
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.comprobante_compra_validar(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.comprobante_compra_validar(uuid, uuid, jsonb) TO service_role;

-- ── 3. Cancelar / editar la orden: un borrador con conteos también frena ─────────────────
-- Iguales a las vigentes salvo la condición marcada (19/11).
CREATE OR REPLACE FUNCTION public.oc_cancelar(p_orden_id uuid, p_usuario_id uuid, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  o       record;
  v_comp  int;
BEGIN
  SELECT * INTO o FROM ordenes_compra WHERE id = p_orden_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La orden no existe (puede que la hayan eliminado).' USING ERRCODE = 'P0002', DETAIL = 'no_encontrada';
  END IF;
  IF o.estado = 'cancelada' THEN
    RETURN jsonb_build_object('success', true, 'ya_cancelada', true, 'orden_id', p_orden_id, 'numero_orden', o.numero_orden);
  END IF;
  IF o.estado NOT IN ('pendiente', 'enviada', 'confirmada', 'en_camino') THEN
    RAISE EXCEPTION 'La orden % está % : ya no se puede cancelar.', o.numero_orden, replace(o.estado, '_', ' ')
      USING ERRCODE = 'P0001', DETAIL = 'estado_no_cancelable';
  END IF;
  IF EXISTS (SELECT 1 FROM recepciones r WHERE r.orden_compra_id = p_orden_id
         AND (r.estado IN ('en_proceso', 'finalizada')
             -- (19/11) un borrador (lo crea la oficina al subir la factura) en el que el depósito ya contó algo
             OR (r.estado = 'borrador' AND EXISTS (
                   SELECT 1 FROM recepciones_items ri
                    WHERE ri.recepcion_id = r.id
                      AND (coalesce(ri.cantidad_fisica, 0) > 0 OR coalesce(ri.estado_linea, 'pendiente') <> 'pendiente'))))) THEN
    RAISE EXCEPTION 'La orden % ya tiene una recepción en depósito: no se puede cancelar.', o.numero_orden
      USING ERRCODE = 'P0001', DETAIL = 'con_recepcion';
  END IF;
  SELECT count(*) INTO v_comp FROM comprobantes_compra c WHERE c.orden_compra_id = p_orden_id AND c.estado <> 'esperada';
  IF v_comp > 0 THEN
    RAISE EXCEPTION 'La orden % tiene % comprobante(s) cargado(s). Eliminalos desde la verificación antes de cancelarla.', o.numero_orden, v_comp
      USING ERRCODE = 'P0001', DETAIL = 'con_comprobantes';
  END IF;

  UPDATE ordenes_compra SET
    estado = 'cancelada', cancelada_at = now(), cancelada_por = p_usuario_id,
    motivo_cancelacion = nullif(trim(coalesce(p_motivo, '')), ''), updated_at = now()
  WHERE id = p_orden_id;

  -- Recepciones en borrador (las crea la oficina al subir un documento): quedan canceladas
  UPDATE recepciones SET estado = 'cancelada', updated_at = now()
   WHERE orden_compra_id = p_orden_id AND estado = 'borrador';

  -- Con la orden ya cancelada, cada "sincronizar" solo limpia lo suyo
  PERFORM public.oc_provision_sincronizar(p_orden_id);
  PERFORM public.oc_vencimientos_estimados_sincronizar(p_orden_id, p_usuario_id);
  PERFORM public.oc_kardex_pendiente_sincronizar(p_orden_id, p_usuario_id);

  RETURN jsonb_build_object('success', true, 'ya_cancelada', false, 'orden_id', p_orden_id, 'numero_orden', o.numero_orden,
                            'estaba_enviada', o.enviada_at IS NOT NULL);
END;
$function$;

REVOKE ALL ON FUNCTION public.oc_cancelar(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.oc_cancelar(uuid, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.oc_guardar(p_orden_id uuid, p_usuario_id uuid, p_datos jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_items      jsonb := coalesce(p_datos -> 'items', '[]'::jsonb);
  v_prov       uuid  := nullif(p_datos ->> 'proveedor_id', '')::uuid;
  v_clave      uuid  := nullif(p_datos ->> 'clave', '')::uuid;
  v_fecha_est  date  := nullif(p_datos ->> 'fecha_estimada_recepcion', '')::date;
  v_acuerdo    jsonb := CASE WHEN jsonb_typeof(p_datos -> 'acuerdo_pago') = 'object' THEN p_datos -> 'acuerdo_pago' ELSE NULL END;
  v_mixto      numeric := CASE WHEN coalesce(p_datos ->> 'mixto_pct_factura', '') ~ '^[0-9]+(\.[0-9]+)?$'
                                AND (p_datos ->> 'mixto_pct_factura')::numeric <= 100
                               THEN (p_datos ->> 'mixto_pct_factura')::numeric ELSE NULL END;
  v_id         uuid;
  v_numero     text;
  v_nueva      boolean := false;
  o            record;
  v_n          int;
  v_malos      int;
  v_seq        bigint;
  t            record;
  v_venc       int;
  v_kardex     int;
BEGIN
  -- ── Controles de lo que llega ──
  IF jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'La orden no tiene artículos con cantidad.' USING ERRCODE = 'P0001', DETAIL = 'sin_items';
  END IF;

  SELECT count(*) INTO v_malos FROM jsonb_array_elements(v_items) e
   WHERE coalesce(e ->> 'articulo_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  IF v_malos > 0 THEN
    RAISE EXCEPTION 'Hay % renglón(es) sin artículo vinculado. Vinculalos a un artículo del catálogo o sacalos de la orden.', v_malos
      USING ERRCODE = 'P0001', DETAIL = 'items_sin_articulo';
  END IF;

  SELECT count(*) INTO v_malos FROM jsonb_array_elements(v_items) e
   WHERE NOT (coalesce(e ->> 'cantidad_pedida', '') ~ '^[0-9]+(\.[0-9]+)?$' AND (e ->> 'cantidad_pedida')::numeric > 0);
  IF v_malos > 0 THEN
    RAISE EXCEPTION 'Hay % renglón(es) con cantidad en cero o inválida.', v_malos USING ERRCODE = 'P0001', DETAIL = 'cantidad_invalida';
  END IF;

  SELECT count(*) INTO v_malos FROM jsonb_array_elements(v_items) e
   WHERE NOT (coalesce(e ->> 'precio_unitario', '0') ~ '^[0-9]+(\.[0-9]+)?$');
  IF v_malos > 0 THEN
    RAISE EXCEPTION 'Hay % renglón(es) con el precio inválido.', v_malos USING ERRCODE = 'P0001', DETAIL = 'precio_invalido';
  END IF;

  SELECT count(*) INTO v_malos FROM jsonb_array_elements(v_items) e, LATERAL (VALUES ('descuento1'), ('descuento2'), ('descuento3'), ('descuento4')) k(c)
   WHERE NOT (coalesce(nullif(e ->> k.c, ''), '0') ~ '^[0-9]+(\.[0-9]+)?$' AND coalesce(nullif(e ->> k.c, ''), '0')::numeric <= 100);
  IF v_malos > 0 THEN
    RAISE EXCEPTION 'Hay descuentos inválidos (tienen que estar entre 0 y 100).' USING ERRCODE = 'P0001', DETAIL = 'descuento_invalido';
  END IF;

  SELECT count(*) INTO v_malos FROM (
    SELECT lower(e ->> 'articulo_id') FROM jsonb_array_elements(v_items) e GROUP BY 1 HAVING count(*) > 1
  ) rep;
  IF v_malos > 0 THEN
    RAISE EXCEPTION 'Hay % artículo(s) repetido(s) en la orden. Dejá un solo renglón por artículo.', v_malos
      USING ERRCODE = 'P0001', DETAIL = 'articulo_repetido';
  END IF;

  SELECT count(*) INTO v_malos FROM jsonb_array_elements(v_items) e
   WHERE NOT EXISTS (SELECT 1 FROM articulos a WHERE a.id = (e ->> 'articulo_id')::uuid);
  IF v_malos > 0 THEN
    RAISE EXCEPTION 'Hay % artículo(s) de la orden que ya no existe(n) en el catálogo.', v_malos
      USING ERRCODE = 'P0001', DETAIL = 'articulo_inexistente';
  END IF;

  IF p_orden_id IS NULL THEN
    -- ── Crear ──
    IF v_prov IS NULL OR NOT EXISTS (SELECT 1 FROM proveedores WHERE id = v_prov) THEN
      RAISE EXCEPTION 'Elegí el proveedor de la orden.' USING ERRCODE = 'P0001', DETAIL = 'sin_proveedor';
    END IF;

    -- Doble click / reintento: la misma clave devuelve la misma orden
    IF v_clave IS NOT NULL THEN
      SELECT id, numero_orden INTO v_id, v_numero FROM ordenes_compra WHERE clave_creacion = v_clave;
      IF FOUND THEN
        RETURN jsonb_build_object('success', true, 'repetida', true, 'orden_id', v_id, 'numero_orden', v_numero);
      END IF;
    END IF;

    -- Número: secuencia (sin carreras). Si alguien cargó a mano un número más alto, se saltea.
    LOOP
      v_seq := nextval('public.ordenes_compra_numero_seq');
      v_numero := 'OC-' || lpad(v_seq::text, 6, '0');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM ordenes_compra WHERE numero_orden = v_numero);
    END LOOP;

    BEGIN
      INSERT INTO ordenes_compra (
        numero_orden, proveedor_id, fecha_orden, fecha_estimada_recepcion, estado,
        observaciones, condicion_pago, acuerdo_pago, mixto_pct_factura, usuario_creador, creado_por, clave_creacion
      ) VALUES (
        v_numero, v_prov, now(), v_fecha_est, 'pendiente',
        nullif(trim(coalesce(p_datos ->> 'observaciones', '')), ''),
        nullif(left(trim(coalesce(p_datos ->> 'condicion_pago', '')), 100), ''),
        v_acuerdo, v_mixto, p_usuario_id::text, p_usuario_id, v_clave
      ) RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
      -- otra llamada con la misma clave ganó la carrera
      SELECT id, numero_orden INTO v_id, v_numero FROM ordenes_compra WHERE clave_creacion = v_clave;
      IF FOUND THEN
        RETURN jsonb_build_object('success', true, 'repetida', true, 'orden_id', v_id, 'numero_orden', v_numero);
      END IF;
      RAISE;
    END;
    v_nueva := true;
  ELSE
    -- ── Editar ──
    SELECT * INTO o FROM ordenes_compra WHERE id = p_orden_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'La orden no existe (puede que la hayan eliminado).' USING ERRCODE = 'P0002', DETAIL = 'no_encontrada';
    END IF;
    IF o.estado NOT IN ('pendiente', 'enviada', 'confirmada', 'en_camino') THEN
      RAISE EXCEPTION 'La orden % está % y ya no se puede modificar.', o.numero_orden, replace(o.estado, '_', ' ')
        USING ERRCODE = 'P0001', DETAIL = 'estado_no_editable';
    END IF;
    IF v_prov IS NOT NULL AND v_prov <> o.proveedor_id THEN
      RAISE EXCEPTION 'No se puede cambiar el proveedor de una orden ya creada. Cancelala y hacé una nueva.'
        USING ERRCODE = 'P0001', DETAIL = 'proveedor_cambiado';
    END IF;
    IF EXISTS (SELECT 1 FROM recepciones r WHERE r.orden_compra_id = p_orden_id
           AND (r.estado IN ('en_proceso', 'finalizada')
             -- (19/11) un borrador (lo crea la oficina al subir la factura) en el que el depósito ya contó algo
             OR (r.estado = 'borrador' AND EXISTS (
                   SELECT 1 FROM recepciones_items ri
                    WHERE ri.recepcion_id = r.id
                      AND (coalesce(ri.cantidad_fisica, 0) > 0 OR coalesce(ri.estado_linea, 'pendiente') <> 'pendiente'))))) THEN
      RAISE EXCEPTION 'La orden % ya tiene una recepción en depósito: no se puede modificar.', o.numero_orden
        USING ERRCODE = 'P0001', DETAIL = 'con_recepcion';
    END IF;
    -- Con un comprobante cargado (aunque no esté validado) la orden no se toca: la factura que
    -- entra por mail ya convirtió la provisión en deuda y creó su vencimiento; rehacer la
    -- provisión y los estimados duplicaría las dos cosas. Misma regla que oc_cancelar.
    IF EXISTS (SELECT 1 FROM comprobantes_compra c WHERE c.orden_compra_id = p_orden_id AND c.estado <> 'esperada') THEN
      RAISE EXCEPTION 'La orden % ya tiene comprobantes cargados: no se puede modificar. Si hay que cambiarla, eliminá primero los comprobantes desde la verificación.', o.numero_orden
        USING ERRCODE = 'P0001', DETAIL = 'con_comprobantes';
    END IF;

    v_id := p_orden_id;
    v_numero := o.numero_orden;
    v_prov := o.proveedor_id;

    UPDATE ordenes_compra SET
      observaciones            = nullif(trim(coalesce(p_datos ->> 'observaciones', '')), ''),
      fecha_estimada_recepcion = coalesce(v_fecha_est, fecha_estimada_recepcion),
      condicion_pago           = CASE WHEN p_datos ? 'condicion_pago' THEN nullif(left(trim(coalesce(p_datos ->> 'condicion_pago', '')), 100), '') ELSE condicion_pago END,
      acuerdo_pago             = CASE WHEN p_datos ? 'acuerdo_pago' THEN v_acuerdo ELSE acuerdo_pago END,
      mixto_pct_factura        = CASE WHEN p_datos ? 'mixto_pct_factura' THEN v_mixto ELSE mixto_pct_factura END,
      editada_at               = now(),
      editada_por              = p_usuario_id,
      updated_at               = now()
    WHERE id = v_id;

    DELETE FROM ordenes_compra_detalle WHERE orden_compra_id = v_id;
  END IF;

  -- ── Detalle (con la foto del artículo al momento de guardar) ──
  INSERT INTO ordenes_compra_detalle (
    orden_compra_id, articulo_id, cantidad_pedida, tipo_cantidad, precio_unitario,
    descuento1, descuento2, descuento3, descuento4,
    orden, iva_compras, unidades_por_bulto, precio_ficha, precio_neto_ficha
  )
  SELECT
    v_id, a.id, (e.item ->> 'cantidad_pedida')::numeric,
    CASE WHEN e.item ->> 'tipo_cantidad' = 'unidad' THEN 'unidad' ELSE 'bulto' END,
    coalesce(nullif(e.item ->> 'precio_unitario', ''), '0')::numeric,
    coalesce(nullif(e.item ->> 'descuento1', ''), '0')::numeric,
    coalesce(nullif(e.item ->> 'descuento2', ''), '0')::numeric,
    coalesce(nullif(e.item ->> 'descuento3', ''), '0')::numeric,
    coalesce(nullif(e.item ->> 'descuento4', ''), '0')::numeric,
    e.pos::int,
    coalesce(nullif(a.iva_compras, ''), 'factura'),
    CASE WHEN coalesce(a.unidades_por_bulto, 1) > 1 THEN a.unidades_por_bulto ELSE 1 END,
    a.precio_compra,
    public.oc_neto_unitario(a.precio_compra, a.descuento1, a.descuento2, a.descuento3, a.descuento4,
                            (SELECT p.tipo_descuento FROM proveedores p WHERE p.id = v_prov))
  FROM jsonb_array_elements(v_items) WITH ORDINALITY AS e(item, pos)
  JOIN articulos a ON a.id = (e.item ->> 'articulo_id')::uuid;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- ── Totales en la cabecera ──
  SELECT * INTO t FROM oc_totales(v_id);
  UPDATE ordenes_compra SET
    total_neto         = t.neto_blanco + t.neto_negro,
    total_iva          = t.iva,
    total_percepciones = t.percepciones,
    total_blanco       = t.total_blanco,
    total_negro        = t.total_negro,
    total_estimado     = t.total,
    cantidad_renglones = t.renglones
  WHERE id = v_id;

  -- ── Cuenta corriente, vencimientos estimados y stock en camino ──
  PERFORM public.oc_provision_sincronizar(v_id);
  v_venc   := public.oc_vencimientos_estimados_sincronizar(v_id, p_usuario_id);
  v_kardex := public.oc_kardex_pendiente_sincronizar(v_id, p_usuario_id);

  RETURN jsonb_build_object(
    'success', true, 'repetida', false, 'nueva', v_nueva,
    'orden_id', v_id, 'numero_orden', v_numero, 'renglones', v_n,
    'total_neto', t.neto_blanco + t.neto_negro, 'total_iva', t.iva, 'total_percepciones', t.percepciones,
    'total_blanco', t.total_blanco, 'total_negro', t.total_negro, 'total_estimado', t.total,
    'vencimientos_estimados', v_venc, 'kardex_pendiente', v_kardex
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.oc_guardar(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.oc_guardar(uuid, uuid, jsonb) TO service_role;
