-- ─────────────────────────────────────────────────────────────────────────────
-- Listas de precios de proveedor: aplicar con vigencia, sin errores escondidos y con
-- historial de costo (Tanda 2-C, 19/11/2026). Prueba integral de entrada: E-20, E-21, E-22.
--
-- Qué pasaba:
--   · aplicar una lista ignoraba la fecha de vigencia: regía ya aunque dijera "desde el lunes";
--   · la lista quedaba "aplicada" aunque fallaran renglones, y no decía cuáles;
--   · un descuento 0 en el archivo se tomaba como "no tocar";
--   · el historial de costo se insertaba con columnas que no existen: nunca guardó nada (E-21);
--   · las listas que llegan por mail iban a otro circuito (importaciones_articulos, E-22);
--   · el precio del archivo se escribía tal cual como costo POR UNIDAD: una caja de 12 a $12.000
--     quedaba como $12.000 por unidad.
--
-- Qué agrega:
--   1. Columnas nuevas (todas vacías; no modifica datos):
--        proveedores: lista_precio_por ('unidad' | 'bulto')  en qué manda los precios ese proveedor
--        listas_proveedores: precio_por, tope_pct, storage_path, archivos, origen ('manual' | 'mail'),
--                            email_id, programada_at / programada_por, aplicada_at / aplicada_por, errores
--        listas_proveedores_items: error, aplicado_at, articulo_sugerido_id, confirmado_tope, los
--                            valores que tenía el artículo antes (descuentoN_anterior)
--        precios_compra_historial: precio_compra_anterior, descuentoN_anterior, lista_proveedor_id, detalle
--      y los descuentos de los renglones pasan a numeric(7,4) (con numeric(6,4) un 100 % no entraba).
--   2. lista_proveedor_aplicar(lista, usuario, forzar_hoy, limite)   todo en una transacción:
--        · vigencia FUTURA (y sin forzar) → la lista queda 'programada' y no toca ningún artículo;
--        · si no, por cada renglón pendiente con artículo:
--            - el precio se lleva a UNIDAD (si la lista viene por bulto, se divide por las unidades por
--              bulto del artículo; si el artículo no las tiene, el renglón queda "para revisar");
--            - si ya hay una lista POSTERIOR aplicada del mismo proveedor para ese artículo, no se pisa;
--            - si el costo neto cambia más que el TOPE (50 % por defecto) y nadie lo confirmó, queda
--              "para revisar" y no se aplica;
--            - si no, actualiza el costo del artículo (vacío = no tocar, 0 = cero), deja el cambio en
--              precios_compra_historial (antes y después, origen 'lista', quién) y lo marca 'aplicado';
--        · un renglón que falla queda 'error' con el motivo y NO frena a los demás;
--        · `limite`: cuántos renglones procesar en esta llamada (la pantalla llama de a 200 y muestra
--          el avance); devuelve cuántos quedan;
--        · la lista pasa a 'aplicada' SOLO si no quedó ningún renglón pendiente, con error ni por revisar.
--   3. listas_proveedores_aplicar_programadas()   aplica las listas programadas cuya vigencia llegó,
--      con los MISMOS controles (lo que supera el tope queda "para revisar", no se aplica).
--      La corre pg_cron cada 15 minutos (el mismo mecanismo que aplicar_precios_programados), si la
--      extensión está instalada. No usa la tabla precios_programados porque ahí no entran los
--      descuentos de compra ni queda el historial de costo ni el estado de la lista.
--
-- El código de la Tanda 2-C NECESITA esta migración para aplicar o programar una lista (sin ella la
-- pantalla avisa que falta y no cambia ningún precio). VA DESPUÉS de 20261117n (usa oc_neto_unitario;
-- corta con mensaje si falta). Se puede correr más de una vez.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF to_regprocedure('public.oc_neto_unitario(numeric, numeric, numeric, numeric, numeric, text)') IS NULL THEN
    RAISE EXCEPTION 'Falta aplicar ANTES la migración 20261117n_oc_guardar.sql (función oc_neto_unitario). No se cambió nada.';
  END IF;
END $$;

-- ═══ 1. Columnas ═══
ALTER TABLE public.proveedores
  ADD COLUMN IF NOT EXISTS lista_precio_por varchar(10);
COMMENT ON COLUMN public.proveedores.lista_precio_por IS
  'En qué manda este proveedor los precios de sus listas: unidad | bulto. Valor por defecto al cargar una lista suya; vacío = unidad.';

ALTER TABLE public.listas_proveedores
  ADD COLUMN IF NOT EXISTS precio_por     varchar(10),
  ADD COLUMN IF NOT EXISTS tope_pct       numeric,
  ADD COLUMN IF NOT EXISTS storage_path   text,
  ADD COLUMN IF NOT EXISTS archivos       jsonb,
  ADD COLUMN IF NOT EXISTS origen         varchar(20),
  ADD COLUMN IF NOT EXISTS email_id       uuid,
  ADD COLUMN IF NOT EXISTS programada_at  timestamptz,
  ADD COLUMN IF NOT EXISTS programada_por uuid,
  ADD COLUMN IF NOT EXISTS aplicada_at    timestamptz,
  ADD COLUMN IF NOT EXISTS aplicada_por   uuid,
  ADD COLUMN IF NOT EXISTS errores        int NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.listas_proveedores.estado IS
  'pendiente (cargada, sin aplicar o con renglones por resolver) | programada (rige desde fecha_vigencia, se aplica sola ese día) | aplicada | vencida';
COMMENT ON COLUMN public.listas_proveedores.precio_por IS
  'En qué viene el precio de ESTA lista: unidad | bulto. Por bulto, se divide por las unidades por bulto de cada artículo. Vacío = unidad.';
COMMENT ON COLUMN public.listas_proveedores.tope_pct IS
  'Una suba o baja del costo neto mayor a este % no se aplica sin confirmar el renglón. Vacío = 50.';
COMMENT ON COLUMN public.listas_proveedores.storage_path IS
  'Ruta del archivo en el almacenamiento (bucket privado): el enlace se firma al mostrarlo. Con prefijo "attachments:" si está en el bucket de adjuntos de mail.';
COMMENT ON COLUMN public.listas_proveedores.archivos IS
  'Todos los archivos de la lista (un mail puede traer varios): [{ "nombre": "...", "ruta": "..." }].';

ALTER TABLE public.listas_proveedores_items
  ADD COLUMN IF NOT EXISTS error                text,
  ADD COLUMN IF NOT EXISTS aplicado_at          timestamptz,
  ADD COLUMN IF NOT EXISTS articulo_sugerido_id uuid,
  ADD COLUMN IF NOT EXISTS confirmado_tope      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS descuento1_anterior  numeric,
  ADD COLUMN IF NOT EXISTS descuento2_anterior  numeric,
  ADD COLUMN IF NOT EXISTS descuento3_anterior  numeric,
  ADD COLUMN IF NOT EXISTS descuento4_anterior  numeric;

-- numeric(6,4) llega hasta 99,9999: un descuento de 100 % (mercadería bonificada) no entraba
ALTER TABLE public.listas_proveedores_items
  ALTER COLUMN descuento1 TYPE numeric(7,4),
  ALTER COLUMN descuento2 TYPE numeric(7,4),
  ALTER COLUMN descuento3 TYPE numeric(7,4),
  ALTER COLUMN descuento4 TYPE numeric(7,4);

COMMENT ON COLUMN public.listas_proveedores_items.estado_item IS
  'pendiente (se aplica) | revisar (falta confirmar: artículo sugerido, cambio mayor al tope, o lista por bulto sin unidades por bulto; el motivo está en "error") | ignorado (sin artículo, descartado, o hay una lista posterior aplicada) | aplicado | error';

ALTER TABLE public.precios_compra_historial
  ADD COLUMN IF NOT EXISTS ultimo_costo           numeric,
  ADD COLUMN IF NOT EXISTS origen                 text,
  ADD COLUMN IF NOT EXISTS usuario_id             uuid,
  ADD COLUMN IF NOT EXISTS precio_compra_anterior numeric,
  ADD COLUMN IF NOT EXISTS descuento1_anterior    numeric,
  ADD COLUMN IF NOT EXISTS descuento2_anterior    numeric,
  ADD COLUMN IF NOT EXISTS descuento3_anterior    numeric,
  ADD COLUMN IF NOT EXISTS descuento4_anterior    numeric,
  ADD COLUMN IF NOT EXISTS lista_proveedor_id     uuid,
  ADD COLUMN IF NOT EXISTS detalle                text;

CREATE INDEX IF NOT EXISTS idx_precios_compra_historial_articulo_fecha
  ON public.precios_compra_historial (articulo_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_precios_compra_historial_lista
  ON public.precios_compra_historial (lista_proveedor_id) WHERE lista_proveedor_id IS NOT NULL;

-- ═══ 2. Aplicar una lista ═══
DROP FUNCTION IF EXISTS public.lista_proveedor_aplicar(uuid, uuid, boolean);

CREATE OR REPLACE FUNCTION public.lista_proveedor_aplicar(
  p_lista_id    uuid,
  p_usuario_id  uuid,
  p_forzar_hoy  boolean DEFAULT false,
  p_limite      int     DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  l            record;
  it           record;
  a            record;
  v_tipo       text;
  v_tope       numeric;
  v_factor     numeric;
  v_precio     numeric;
  v_d1         numeric;
  v_d2         numeric;
  v_d3         numeric;
  v_d4         numeric;
  v_neto_ant   numeric;
  v_neto_nuevo numeric;
  v_var        numeric;
  v_frena      text;
  v_posterior  text;
  v_proc       int := 0;
  v_aplicados  int := 0;
  v_sin_cambio int := 0;
  v_revisar    int := 0;
  v_salteados  int := 0;
  v_errores    jsonb := '[]'::jsonb;
  v_pendientes int;
  v_quedan     int;
BEGIN
  SELECT * INTO l FROM listas_proveedores WHERE id = p_lista_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La lista no existe (puede que la hayan eliminado).' USING ERRCODE = 'P0002', DETAIL = 'no_encontrada';
  END IF;
  IF l.estado = 'aplicada' THEN
    RETURN jsonb_build_object('success', true, 'ya_aplicada', true, 'aplicada', true, 'aplicados', 0, 'errores', '[]'::jsonb, 'quedan', 0);
  END IF;

  -- Vigencia futura: queda programada. No se toca ningún artículo hasta ese día.
  IF l.fecha_vigencia > public.hoy_ar() AND NOT coalesce(p_forzar_hoy, false) THEN
    UPDATE listas_proveedores
       SET estado = 'programada', programada_at = now(), programada_por = p_usuario_id
     WHERE id = p_lista_id;
    RETURN jsonb_build_object('success', true, 'programada', true, 'fecha_vigencia', l.fecha_vigencia, 'quedan', 0,
                              'renglones', (SELECT count(*) FROM listas_proveedores_items WHERE lista_id = p_lista_id AND estado_item = 'pendiente' AND articulo_id IS NOT NULL));
  END IF;

  SELECT coalesce(p.tipo_descuento, 'cascada') INTO v_tipo FROM proveedores p WHERE p.id = l.proveedor_id;
  v_tipo := coalesce(v_tipo, 'cascada');
  v_tope := CASE WHEN coalesce(l.tope_pct, 0) > 0 THEN l.tope_pct ELSE 50 END;

  FOR it IN
    SELECT * FROM listas_proveedores_items
     WHERE lista_id = p_lista_id AND estado_item = 'pendiente' AND articulo_id IS NOT NULL
     ORDER BY created_at, id
  LOOP
    EXIT WHEN p_limite IS NOT NULL AND v_proc >= p_limite;
    v_proc := v_proc + 1;
    -- Cada renglón es todo o nada: si falla, queda con su motivo y no frena a los demás
    BEGIN
      SELECT id, precio_compra, descuento1, descuento2, descuento3, descuento4, unidades_por_bulto INTO a
        FROM articulos WHERE id = it.articulo_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'el artículo ya no existe';
      END IF;

      v_frena := NULL;
      -- El costo del artículo es SIEMPRE por unidad: si la lista viene por bulto, se divide
      v_factor := CASE WHEN l.precio_por = 'bulto' AND coalesce(a.unidades_por_bulto, 1) > 1 THEN a.unidades_por_bulto ELSE 1 END;
      IF l.precio_por = 'bulto' AND coalesce(it.precio_compra, 0) > 0 AND NOT (coalesce(a.unidades_por_bulto, 1) > 1) THEN
        v_frena := 'La lista viene por bulto y el artículo no tiene unidades por bulto cargadas: no se puede saber el precio por unidad.';
      END IF;

      -- precio vacío o 0 = no tocar; descuento vacío = no tocar; descuento 0 = pasa a 0
      v_precio := CASE WHEN coalesce(it.precio_compra, 0) > 0 THEN round(it.precio_compra / v_factor, 4) ELSE coalesce(a.precio_compra, 0) END;
      -- A 2 decimales, que es como los guarda el artículo (articulos.descuentoN es numeric(5,2)) y el
      -- historial: si no, un 12,3456 de la lista se guarda 12,35 y en cada reaplicación daría "distinto".
      v_d1 := round(coalesce(it.descuento1, a.descuento1, 0), 2);
      v_d2 := round(coalesce(it.descuento2, a.descuento2, 0), 2);
      v_d3 := round(coalesce(it.descuento3, a.descuento3, 0), 2);
      v_d4 := round(coalesce(it.descuento4, a.descuento4, 0), 2);
      IF v_d1 < 0 OR v_d1 > 100 OR v_d2 < 0 OR v_d2 > 100 OR v_d3 < 0 OR v_d3 > 100 OR v_d4 < 0 OR v_d4 > 100 THEN
        RAISE EXCEPTION 'un descuento está fuera de 0 a 100 %%';
      END IF;

      -- Una lista con vigencia ANTERIOR no pisa lo que dejó una POSTERIOR ya aplicada del mismo proveedor
      SELECT coalesce(lp.nombre, 'lista') || ' (rige desde ' || to_char(lp.fecha_vigencia, 'DD/MM/YYYY') || ')' INTO v_posterior
        FROM precios_compra_historial h
        JOIN listas_proveedores lp ON lp.id = h.lista_proveedor_id
       WHERE h.articulo_id = it.articulo_id
         AND lp.id <> p_lista_id
         AND lp.proveedor_id IS NOT DISTINCT FROM l.proveedor_id
         AND lp.fecha_vigencia > l.fecha_vigencia
       ORDER BY lp.fecha_vigencia DESC
       LIMIT 1;

      -- Tope de cambio del costo neto (con los descuentos como los aplica el proveedor)
      v_neto_ant   := public.oc_neto_unitario(coalesce(a.precio_compra, 0), a.descuento1, a.descuento2, a.descuento3, a.descuento4, v_tipo);
      v_neto_nuevo := public.oc_neto_unitario(v_precio, v_d1, v_d2, v_d3, v_d4, v_tipo);
      v_var := CASE WHEN v_neto_ant > 0 THEN round((v_neto_nuevo - v_neto_ant) / v_neto_ant * 100, 1) ELSE NULL END;
      IF v_frena IS NULL AND v_var IS NOT NULL AND abs(v_var) > v_tope AND NOT coalesce(it.confirmado_tope, false) THEN
        v_frena := 'El costo ' || CASE WHEN v_var > 0 THEN 'sube ' ELSE 'baja ' END || replace(abs(v_var)::text, '.', ',')
                   || ' %: supera el tope de ' || replace(v_tope::text, '.', ',') || ' %. No se aplica sin confirmarlo.';
      END IF;

      IF v_posterior IS NOT NULL THEN
        UPDATE listas_proveedores_items
           SET estado_item = 'ignorado', error = 'No se aplicó: ya hay una lista posterior aplicada para este artículo — ' || v_posterior
         WHERE id = it.id;
        v_salteados := v_salteados + 1;
      ELSIF v_frena IS NOT NULL THEN
        UPDATE listas_proveedores_items SET estado_item = 'revisar', error = v_frena WHERE id = it.id;
        v_revisar := v_revisar + 1;
      ELSE
        IF v_precio IS DISTINCT FROM coalesce(a.precio_compra, 0)
           OR v_d1 IS DISTINCT FROM coalesce(a.descuento1, 0) OR v_d2 IS DISTINCT FROM coalesce(a.descuento2, 0)
           OR v_d3 IS DISTINCT FROM coalesce(a.descuento3, 0) OR v_d4 IS DISTINCT FROM coalesce(a.descuento4, 0) THEN
          UPDATE articulos
             SET precio_compra = v_precio, descuento1 = v_d1, descuento2 = v_d2, descuento3 = v_d3, descuento4 = v_d4,
                 actualizado_por = coalesce(p_usuario_id, actualizado_por)
           WHERE id = it.articulo_id;

          INSERT INTO precios_compra_historial (
            articulo_id, proveedor_id, precio_compra, descuento1, descuento2, descuento3, descuento4,
            precio_compra_anterior, descuento1_anterior, descuento2_anterior, descuento3_anterior, descuento4_anterior,
            origen, lista_proveedor_id, usuario_id, detalle
          ) VALUES (
            it.articulo_id, l.proveedor_id, round(v_precio, 2), v_d1, v_d2, v_d3, v_d4,
            coalesce(a.precio_compra, 0), coalesce(a.descuento1, 0), coalesce(a.descuento2, 0), coalesce(a.descuento3, 0), coalesce(a.descuento4, 0),
            'lista', p_lista_id, p_usuario_id,
            'Lista ' || coalesce(l.nombre, to_char(l.fecha_vigencia, 'DD/MM/YYYY')) || ' — rige desde ' || to_char(l.fecha_vigencia, 'DD/MM/YYYY')
              || CASE WHEN v_factor > 1 THEN ' — precio por bulto de ' || v_factor::text || ' u' ELSE '' END
          );
          v_aplicados := v_aplicados + 1;
        ELSE
          v_sin_cambio := v_sin_cambio + 1;
        END IF;

        UPDATE listas_proveedores_items
           SET estado_item = 'aplicado', error = NULL, aplicado_at = now(),
               precio_anterior = coalesce(a.precio_compra, 0),
               descuento1_anterior = coalesce(a.descuento1, 0), descuento2_anterior = coalesce(a.descuento2, 0),
               descuento3_anterior = coalesce(a.descuento3, 0), descuento4_anterior = coalesce(a.descuento4, 0)
         WHERE id = it.id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      UPDATE listas_proveedores_items SET estado_item = 'error', error = SQLERRM WHERE id = it.id;
      v_errores := v_errores || jsonb_build_object('item_id', it.id, 'codigo', it.codigo_proveedor, 'descripcion', it.descripcion_proveedor, 'error', SQLERRM);
    END;
  END LOOP;

  -- Renglones que todavía faltan procesar (se llamó con límite) y los que quedaron por resolver
  SELECT count(*) INTO v_pendientes FROM listas_proveedores_items
   WHERE lista_id = p_lista_id AND estado_item = 'pendiente' AND articulo_id IS NOT NULL;
  SELECT count(*) INTO v_quedan FROM listas_proveedores_items
   WHERE lista_id = p_lista_id AND estado_item IN ('error', 'revisar');

  -- Aplicada SOLO si no quedó nada pendiente, con error ni por revisar
  UPDATE listas_proveedores
     SET estado = CASE WHEN v_pendientes = 0 AND v_quedan = 0 THEN 'aplicada'
                       WHEN v_pendientes > 0 THEN estado
                       ELSE 'pendiente' END,
         errores = (SELECT count(*) FROM listas_proveedores_items WHERE lista_id = p_lista_id AND estado_item = 'error'),
         aplicada_at = CASE WHEN v_pendientes = 0 AND v_quedan = 0 THEN now() ELSE aplicada_at END,
         aplicada_por = CASE WHEN v_pendientes = 0 AND v_quedan = 0 THEN p_usuario_id ELSE aplicada_por END
   WHERE id = p_lista_id;

  RETURN jsonb_build_object('success', true, 'programada', false,
                            'aplicada', v_pendientes = 0 AND v_quedan = 0,
                            'procesados', v_proc, 'aplicados', v_aplicados, 'sin_cambio', v_sin_cambio,
                            'para_revisar', v_revisar, 'salteados_por_lista_posterior', v_salteados,
                            'errores', v_errores, 'quedan', v_pendientes, 'quedan_por_resolver', v_quedan);
END;
$$;

COMMENT ON FUNCTION public.lista_proveedor_aplicar(uuid, uuid, boolean, int) IS
  'Aplica una lista de precios de proveedor: con vigencia futura la deja programada; si no, lleva el precio a unidad, controla el tope de cambio y las listas posteriores, actualiza el costo de cada artículo, deja el historial y marca cada renglón. La lista queda aplicada solo si no quedó nada por resolver.';

-- ═══ 3. Las programadas se aplican solas el día que rigen ═══
CREATE OR REPLACE FUNCTION public.listas_proveedores_aplicar_programadas()
RETURNS int
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  l record;
  n int := 0;
BEGIN
  FOR l IN
    SELECT id, programada_por FROM listas_proveedores
     WHERE estado = 'programada' AND fecha_vigencia <= public.hoy_ar()
     ORDER BY fecha_vigencia, created_at
  LOOP
    BEGIN
      -- Mismos controles que al aplicar a mano: lo que supera el tope queda "para revisar" (y la
      -- lista vuelve a "pendiente" para que alguien lo mire), no se aplica solo.
      PERFORM public.lista_proveedor_aplicar(l.id, l.programada_por, true, NULL);
      n := n + 1;
    EXCEPTION WHEN OTHERS THEN
      -- no se pudo ni empezar: vuelve a pendiente para que alguien la mire
      UPDATE listas_proveedores SET estado = 'pendiente', observaciones = left(coalesce(observaciones || ' · ', '') || 'No se pudo aplicar sola: ' || SQLERRM, 1000) WHERE id = l.id;
    END;
  END LOOP;
  RETURN n;
END;
$$;

COMMENT ON FUNCTION public.listas_proveedores_aplicar_programadas() IS
  'Aplica las listas de proveedor programadas cuya fecha de vigencia ya llegó, con los mismos controles. La corre pg_cron cada 15 minutos.';

-- Solo el servidor
REVOKE ALL ON FUNCTION public.lista_proveedor_aplicar(uuid, uuid, boolean, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lista_proveedor_aplicar(uuid, uuid, boolean, int) TO service_role;
REVOKE ALL ON FUNCTION public.listas_proveedores_aplicar_programadas() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.listas_proveedores_aplicar_programadas() TO service_role;

-- pg_cron (si está instalado: es el que ya corre aplicar_precios_programados)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'gm_listas_proveedores_programadas';
    PERFORM cron.schedule('gm_listas_proveedores_programadas', '*/15 * * * *', 'SELECT public.listas_proveedores_aplicar_programadas()');
  ELSE
    RAISE NOTICE 'pg_cron no está instalado: las listas programadas se aplican al abrir la pantalla de listas.';
  END IF;
END $$;
