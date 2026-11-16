-- ─────────────────────────────────────────────────────────────────────────────
-- Recepción de mercadería: stock SIEMPRE en unidades base y suma atómica.
-- Prueba integral de entrada, E-30 y E-40 (16/11/2026).
--
-- Problema (dato real, OC-000010): la orden de compra se pide en bultos
-- (2 bultos × 24 u), el operario cuenta "2" y el stock subía 2 en vez de 48.
-- Además finalizarRecepcion leía el stock y lo volvía a escribir (dos equipos a la
-- vez, o un reintento, podían pisarse o sumar dos veces).
--
-- Qué agrega:
--   1. recepciones_items.unidad_conteo: en qué contó el operario ('bulto' | 'unidad').
--      NULL = la unidad de la línea de la OC (lo que mandan las APK viejas y la web).
--   2. Rastro de lo que se sumó al stock por línea: factor_conteo,
--      cantidad_fisica_base (unidades), stock_antes, stock_aplicado_at.
--   3. recepcion_aplicar_stock(recepcion): suma al stock en UNA transacción,
--      con la recepción bloqueada, y marca cada línea: llamarla dos veces suma una vez.
--
-- No toca datos: solo columnas nuevas (vacías) y una función. Se puede correr más
-- de una vez. El código funciona sin esta migración (convierte a unidades igual),
-- pero la suma atómica y contar "en otra unidad" desde la app nueva la necesitan.
-- NO corrige el stock ya mal cargado (OC-000010): es dato de prueba (decisión de Juan, 16/11).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.recepciones_items
  ADD COLUMN IF NOT EXISTS unidad_conteo text,
  ADD COLUMN IF NOT EXISTS factor_conteo numeric(18,6),
  ADD COLUMN IF NOT EXISTS cantidad_fisica_base numeric(18,6),
  ADD COLUMN IF NOT EXISTS stock_antes numeric(18,6),
  ADD COLUMN IF NOT EXISTS stock_aplicado_at timestamptz;

ALTER TABLE public.recepciones_items DROP CONSTRAINT IF EXISTS recepciones_items_unidad_conteo_check;
ALTER TABLE public.recepciones_items
  ADD CONSTRAINT recepciones_items_unidad_conteo_check
  CHECK (unidad_conteo IS NULL OR unidad_conteo IN ('bulto', 'unidad'));

COMMENT ON COLUMN public.recepciones_items.unidad_conteo IS
  'En qué contó el operario cantidad_fisica: bulto | unidad. NULL = la unidad de la línea de la OC (ordenes_compra_detalle.tipo_cantidad); fuera de OC = unidad.';
COMMENT ON COLUMN public.recepciones_items.factor_conteo IS
  'Unidades base por cada 1 de cantidad_fisica, tal como se aplicó al finalizar (unidades por bulto del artículo, o 1).';
COMMENT ON COLUMN public.recepciones_items.cantidad_fisica_base IS
  'Unidades base que esta línea sumó al stock al finalizar la recepción (cantidad_fisica × factor_conteo).';
COMMENT ON COLUMN public.recepciones_items.stock_antes IS
  'Stock del artículo justo antes de sumar esta línea.';
COMMENT ON COLUMN public.recepciones_items.stock_aplicado_at IS
  'Cuándo se sumó esta línea al stock. Con valor = ya sumada: no se vuelve a sumar.';

-- La función NO recibe factores: lee de la base en qué se contó cada línea y las unidades
-- por bulto del artículo, con la recepción y las líneas bloqueadas (nadie le puede pasar
-- un factor inventado ni uno viejo). Es la MISMA regla que lib/deposito/unidades.ts
-- (conversionLinea): si se cambia una, cambiar la otra.
--   unidad = unidad_conteo de la línea; si está vacía: la de la línea de la OC
--            (tipo_cantidad; vacío = bulto); artículo fuera de la OC = unidad.
--   factor = unidades_por_bulto del artículo si la unidad es bulto (y es mayor a 1); si no, 1.
-- Devuelve un arreglo JSON, una fila por línea con cantidad contada:
--   { item_id, articulo_id, cantidad_base, stock_antes, stock_despues, ya_aplicado }
-- cantidad_base = null ⇒ la línea la había sumado el código anterior a esta migración
-- (tiene su kardex de compra): no se toca.
DROP FUNCTION IF EXISTS public.recepcion_aplicar_stock(uuid, jsonb);

CREATE OR REPLACE FUNCTION public.recepcion_aplicar_stock(p_recepcion_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_estado  text;
  v_oc      uuid;
  v_it      record;
  v_tipo_oc text;
  v_en_oc   boolean;
  v_upb     numeric;
  v_factor  numeric;
  v_unidad  text;
  v_base    numeric;
  v_despues numeric;
  v_out     jsonb := '[]'::jsonb;
BEGIN
  -- Un solo finalizador a la vez: la fila de la recepción queda bloqueada hasta el final
  SELECT estado, orden_compra_id INTO v_estado, v_oc FROM recepciones WHERE id = p_recepcion_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recepción % no encontrada', p_recepcion_id USING ERRCODE = 'P0002';
  END IF;
  IF v_estado = 'cancelada' THEN
    RAISE EXCEPTION 'La recepción % está cancelada', p_recepcion_id USING ERRCODE = 'P0001';
  END IF;

  FOR v_it IN
    SELECT id, articulo_id, cantidad_fisica, unidad_conteo, fuera_de_oc,
           cantidad_fisica_base, stock_antes, stock_aplicado_at
      FROM recepciones_items
     WHERE recepcion_id = p_recepcion_id
       AND coalesce(cantidad_fisica, 0) > 0
     ORDER BY id
       FOR UPDATE
  LOOP
    -- Ya sumada por esta misma función (reintento, doble finalizar): se informa, no se suma
    IF v_it.stock_aplicado_at IS NOT NULL THEN
      v_out := v_out || jsonb_build_object(
        'item_id', v_it.id, 'articulo_id', v_it.articulo_id,
        'cantidad_base', v_it.cantidad_fisica_base,
        'stock_antes', v_it.stock_antes,
        'stock_despues', v_it.stock_antes + v_it.cantidad_fisica_base,
        'ya_aplicado', true);
      CONTINUE;
    END IF;

    -- Sumada por una finalización interrumpida del código anterior (dejó su kardex)
    IF EXISTS (
      SELECT 1 FROM kardex k
       WHERE k.recepcion_id = p_recepcion_id
         AND k.articulo_id = v_it.articulo_id
         AND k.tipo_movimiento = 'compra'
    ) THEN
      UPDATE recepciones_items SET stock_aplicado_at = now() WHERE id = v_it.id;
      v_out := v_out || jsonb_build_object(
        'item_id', v_it.id, 'articulo_id', v_it.articulo_id,
        'cantidad_base', NULL, 'stock_antes', NULL, 'stock_despues', NULL,
        'ya_aplicado', true);
      CONTINUE;
    END IF;

    -- En qué se contó (misma regla que conversionLinea)
    v_en_oc := false;
    v_tipo_oc := NULL;
    IF v_oc IS NOT NULL AND NOT coalesce(v_it.fuera_de_oc, false) THEN
      SELECT true, d.tipo_cantidad INTO v_en_oc, v_tipo_oc
        FROM ordenes_compra_detalle d
       WHERE d.orden_compra_id = v_oc AND d.articulo_id = v_it.articulo_id
       LIMIT 1;
      v_en_oc := coalesce(v_en_oc, false);
    END IF;
    v_unidad := CASE
      WHEN v_it.unidad_conteo IN ('bulto', 'unidad') THEN v_it.unidad_conteo
      WHEN v_en_oc THEN (CASE WHEN v_tipo_oc = 'unidad' THEN 'unidad' ELSE 'bulto' END)
      ELSE 'unidad' END;

    -- El artículo queda bloqueado: sus unidades por bulto y su stock se leen y se usan juntos
    SELECT a.unidades_por_bulto::numeric INTO v_upb FROM articulos a WHERE a.id = v_it.articulo_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El artículo % de la recepción ya no existe', v_it.articulo_id USING ERRCODE = 'P0002';
    END IF;
    v_factor := CASE WHEN v_unidad = 'bulto' AND coalesce(v_upb, 0) > 1 THEN v_upb ELSE 1 END;
    v_base := round(v_it.cantidad_fisica * v_factor, 4);

    -- Suma atómica: no se lee el stock para volver a escribirlo
    UPDATE articulos
       SET stock_actual = coalesce(stock_actual, 0) + v_base
     WHERE id = v_it.articulo_id
     RETURNING stock_actual INTO v_despues;

    UPDATE recepciones_items
       SET unidad_conteo        = v_unidad,
           factor_conteo        = v_factor,
           cantidad_fisica_base = v_base,
           stock_antes          = v_despues - v_base,
           stock_aplicado_at    = now()
     WHERE id = v_it.id;

    v_out := v_out || jsonb_build_object(
      'item_id', v_it.id, 'articulo_id', v_it.articulo_id,
      'cantidad_base', v_base,
      'stock_antes', v_despues - v_base,
      'stock_despues', v_despues,
      'ya_aplicado', false);
  END LOOP;

  RETURN v_out;
END;
$$;

COMMENT ON FUNCTION public.recepcion_aplicar_stock(uuid) IS
  'Suma al stock lo contado en una recepción, en unidades base, una sola vez por línea (E-30/E-40). La llama finalizarRecepcion con el cliente de servicio.';

-- Solo la llama el servidor (lib/deposito/recepciones.ts, cliente de servicio), después de
-- comprobar con la sesión del usuario que puede ver la recepción y de tomar el candado.
REVOKE ALL ON FUNCTION public.recepcion_aplicar_stock(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recepcion_aplicar_stock(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
