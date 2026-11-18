-- ─────────────────────────────────────────────────────────────────────────────
-- Listas de precios de proveedor: aplicar con vigencia, sin errores escondidos y con
-- historial de costo (Tanda 2-C, 19/11/2026). Prueba integral de entrada: E-20, E-21, E-22.
--
-- Qué pasaba:
--   · aplicar una lista ignoraba la fecha de vigencia: regía ya aunque dijera "desde el lunes";
--   · la lista quedaba "aplicada" aunque fallaran renglones, y no decía cuáles;
--   · un descuento 0 en el archivo se tomaba como "no tocar";
--   · el historial de costo se insertaba con columnas que no existen: nunca guardó nada (E-21);
--   · las listas que llegan por mail iban a otro circuito (importaciones_articulos, E-22).
--
-- Qué agrega:
--   1. Columnas nuevas (todas vacías; no modifica datos):
--        listas_proveedores: storage_path, origen ('manual' | 'mail'), email_id,
--                            programada_at / programada_por, aplicada_at / aplicada_por, errores
--        listas_proveedores_items: error, aplicado_at, articulo_sugerido_id, los valores que tenía
--                            el artículo antes (descuentoN_anterior)
--        precios_compra_historial: precio_compra_anterior, descuentoN_anterior, lista_proveedor_id, detalle
--   2. lista_proveedor_aplicar(lista, usuario, forzar_hoy)   todo en una transacción:
--        · vigencia FUTURA (y sin forzar) → la lista queda 'programada' y no toca ningún artículo;
--        · si no, por cada renglón pendiente con artículo: actualiza el costo del artículo (precio de
--          lista y descuentos; vacío = no tocar, 0 = cero), deja el cambio en precios_compra_historial
--          (antes y después, origen 'lista', quién) y marca el renglón 'aplicado';
--        · un renglón que falla queda 'error' con el motivo y NO frena a los demás;
--        · la lista pasa a 'aplicada' SOLO si no quedó ningún renglón con error ni pendiente.
--   3. listas_proveedores_aplicar_programadas()   aplica las listas programadas cuya vigencia llegó.
--      La corre pg_cron cada 15 minutos (el mismo mecanismo que aplicar_precios_programados), si la
--      extensión está instalada. No usa la tabla precios_programados porque ahí no entran los
--      descuentos de compra ni queda el historial de costo ni el estado de la lista.
--
-- El código de la Tanda 2-C NECESITA esta migración para aplicar o programar una lista (sin ella la
-- pantalla avisa que falta). Se puede correr más de una vez. No depende de ninguna otra de la tanda.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ 1. Columnas ═══
ALTER TABLE public.listas_proveedores
  ADD COLUMN IF NOT EXISTS storage_path   text,
  ADD COLUMN IF NOT EXISTS origen         varchar(20),
  ADD COLUMN IF NOT EXISTS email_id       uuid,
  ADD COLUMN IF NOT EXISTS programada_at  timestamptz,
  ADD COLUMN IF NOT EXISTS programada_por uuid,
  ADD COLUMN IF NOT EXISTS aplicada_at    timestamptz,
  ADD COLUMN IF NOT EXISTS aplicada_por   uuid,
  ADD COLUMN IF NOT EXISTS errores        int NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.listas_proveedores.estado IS
  'pendiente (cargada, sin aplicar o con renglones por resolver) | programada (rige desde fecha_vigencia, se aplica sola ese día) | aplicada | vencida';
COMMENT ON COLUMN public.listas_proveedores.storage_path IS
  'Ruta del archivo en el almacenamiento (bucket privado): el enlace se firma al mostrarlo. Con prefijo "attachments:" si está en el bucket de adjuntos de mail.';

ALTER TABLE public.listas_proveedores_items
  ADD COLUMN IF NOT EXISTS error                text,
  ADD COLUMN IF NOT EXISTS aplicado_at          timestamptz,
  ADD COLUMN IF NOT EXISTS articulo_sugerido_id uuid,
  ADD COLUMN IF NOT EXISTS descuento1_anterior  numeric,
  ADD COLUMN IF NOT EXISTS descuento2_anterior  numeric,
  ADD COLUMN IF NOT EXISTS descuento3_anterior  numeric,
  ADD COLUMN IF NOT EXISTS descuento4_anterior  numeric;

COMMENT ON COLUMN public.listas_proveedores_items.estado_item IS
  'pendiente (se aplica) | revisar (artículo sugerido, falta confirmarlo) | ignorado (sin artículo o descartado) | aplicado | error';

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

-- ═══ 2. Aplicar una lista ═══
CREATE OR REPLACE FUNCTION public.lista_proveedor_aplicar(
  p_lista_id    uuid,
  p_usuario_id  uuid,
  p_forzar_hoy  boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  l            record;
  it           record;
  a            record;
  v_precio     numeric;
  v_d1         numeric;
  v_d2         numeric;
  v_d3         numeric;
  v_d4         numeric;
  v_aplicados  int := 0;
  v_sin_cambio int := 0;
  v_errores    jsonb := '[]'::jsonb;
  v_quedan     int;
BEGIN
  SELECT * INTO l FROM listas_proveedores WHERE id = p_lista_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La lista no existe (puede que la hayan eliminado).' USING ERRCODE = 'P0002', DETAIL = 'no_encontrada';
  END IF;
  IF l.estado = 'aplicada' THEN
    RETURN jsonb_build_object('success', true, 'ya_aplicada', true, 'aplicados', 0, 'errores', '[]'::jsonb);
  END IF;

  -- Vigencia futura: queda programada. No se toca ningún artículo hasta ese día.
  IF l.fecha_vigencia > public.hoy_ar() AND NOT coalesce(p_forzar_hoy, false) THEN
    UPDATE listas_proveedores
       SET estado = 'programada', programada_at = now(), programada_por = p_usuario_id
     WHERE id = p_lista_id;
    RETURN jsonb_build_object('success', true, 'programada', true, 'fecha_vigencia', l.fecha_vigencia,
                              'renglones', (SELECT count(*) FROM listas_proveedores_items WHERE lista_id = p_lista_id AND estado_item = 'pendiente' AND articulo_id IS NOT NULL));
  END IF;

  FOR it IN
    SELECT * FROM listas_proveedores_items
     WHERE lista_id = p_lista_id AND estado_item IN ('pendiente', 'error') AND articulo_id IS NOT NULL
     ORDER BY created_at, id
  LOOP
    -- Cada renglón es todo o nada: si falla, queda con su motivo y no frena a los demás
    BEGIN
      SELECT id, precio_compra, descuento1, descuento2, descuento3, descuento4 INTO a
        FROM articulos WHERE id = it.articulo_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'el artículo ya no existe';
      END IF;

      -- precio vacío o 0 = no tocar; descuento vacío = no tocar; descuento 0 = pasa a 0
      v_precio := CASE WHEN coalesce(it.precio_compra, 0) > 0 THEN it.precio_compra ELSE coalesce(a.precio_compra, 0) END;
      v_d1 := coalesce(it.descuento1, a.descuento1, 0);
      v_d2 := coalesce(it.descuento2, a.descuento2, 0);
      v_d3 := coalesce(it.descuento3, a.descuento3, 0);
      v_d4 := coalesce(it.descuento4, a.descuento4, 0);
      IF v_d1 < 0 OR v_d1 > 100 OR v_d2 < 0 OR v_d2 > 100 OR v_d3 < 0 OR v_d3 > 100 OR v_d4 < 0 OR v_d4 > 100 THEN
        RAISE EXCEPTION 'un descuento está fuera de 0 a 100 %%';
      END IF;

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
    EXCEPTION WHEN OTHERS THEN
      UPDATE listas_proveedores_items SET estado_item = 'error', error = SQLERRM WHERE id = it.id;
      v_errores := v_errores || jsonb_build_object('item_id', it.id, 'codigo', it.codigo_proveedor, 'descripcion', it.descripcion_proveedor, 'error', SQLERRM);
    END;
  END LOOP;

  -- Aplicada SOLO si no quedó nada con error ni por revisar
  SELECT count(*) INTO v_quedan FROM listas_proveedores_items
   WHERE lista_id = p_lista_id AND estado_item IN ('error', 'revisar');
  UPDATE listas_proveedores
     SET estado = CASE WHEN v_quedan = 0 THEN 'aplicada' ELSE 'pendiente' END,
         errores = jsonb_array_length(v_errores),
         aplicada_at = CASE WHEN v_quedan = 0 THEN now() ELSE aplicada_at END,
         aplicada_por = CASE WHEN v_quedan = 0 THEN p_usuario_id ELSE aplicada_por END
   WHERE id = p_lista_id;

  RETURN jsonb_build_object('success', true, 'programada', false, 'aplicada', v_quedan = 0,
                            'aplicados', v_aplicados, 'sin_cambio', v_sin_cambio,
                            'errores', v_errores, 'quedan_por_resolver', v_quedan);
END;
$$;

COMMENT ON FUNCTION public.lista_proveedor_aplicar(uuid, uuid, boolean) IS
  'Aplica una lista de precios de proveedor: con vigencia futura la deja programada; si no, actualiza el costo de cada artículo, deja el historial y marca cada renglón (aplicado o error). La lista queda aplicada solo si no hubo errores.';

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
      PERFORM public.lista_proveedor_aplicar(l.id, l.programada_por, true);
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
  'Aplica las listas de proveedor programadas cuya fecha de vigencia ya llegó. La corre pg_cron cada 15 minutos.';

-- Solo el servidor
REVOKE ALL ON FUNCTION public.lista_proveedor_aplicar(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lista_proveedor_aplicar(uuid, uuid, boolean) TO service_role;
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
