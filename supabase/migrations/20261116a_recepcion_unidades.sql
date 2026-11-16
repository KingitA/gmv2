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
--   3. recepcion_aplicar_stock(recepcion, factores): suma al stock en UNA transacción,
--      con la recepción bloqueada, y marca cada línea: llamarla dos veces suma una vez.
--
-- No toca datos: solo columnas nuevas (vacías) y una función. Se puede correr más
-- de una vez. El código funciona sin esta migración (convierte a unidades igual),
-- pero la suma atómica y contar "en otra unidad" desde la app nueva la necesitan.
-- NO corrige el stock ya mal cargado (OC-000010): eso lo decide Juan aparte.
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

-- p_factores: { "<id de recepciones_items>": { "unidad": "bulto", "factor": 24 }, ... }
-- (los calcula lib/deposito/recepciones.ts con la regla de lib/deposito/unidades.ts).
-- Devuelve un arreglo JSON, una fila por línea con cantidad contada:
--   { item_id, articulo_id, cantidad_base, stock_antes, stock_despues, ya_aplicado }
-- cantidad_base = null ⇒ la línea la había sumado el código anterior a esta migración
-- (tiene su kardex de compra): no se toca.
CREATE OR REPLACE FUNCTION public.recepcion_aplicar_stock(p_recepcion_id uuid, p_factores jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_estado  text;
  v_it      record;
  v_factor  numeric;
  v_unidad  text;
  v_base    numeric;
  v_despues numeric;
  v_out     jsonb := '[]'::jsonb;
BEGIN
  -- Un solo finalizador a la vez: la fila de la recepción queda bloqueada hasta el final
  SELECT estado INTO v_estado FROM recepciones WHERE id = p_recepcion_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recepción % no encontrada', p_recepcion_id USING ERRCODE = 'P0002';
  END IF;
  IF v_estado = 'cancelada' THEN
    RAISE EXCEPTION 'La recepción % está cancelada', p_recepcion_id USING ERRCODE = 'P0001';
  END IF;

  FOR v_it IN
    SELECT id, articulo_id, cantidad_fisica, cantidad_fisica_base, stock_antes, stock_aplicado_at
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

    v_factor := coalesce(nullif(p_factores -> v_it.id::text ->> 'factor', '')::numeric, 1);
    IF v_factor <= 0 THEN v_factor := 1; END IF;
    v_unidad := p_factores -> v_it.id::text ->> 'unidad';
    IF v_unidad IS NULL OR v_unidad NOT IN ('bulto', 'unidad') THEN
      v_unidad := CASE WHEN v_factor = 1 THEN 'unidad' ELSE 'bulto' END;
    END IF;
    v_base := round(v_it.cantidad_fisica * v_factor, 4);

    -- Suma atómica: no se lee el stock para volver a escribirlo
    UPDATE articulos
       SET stock_actual = coalesce(stock_actual, 0) + v_base
     WHERE id = v_it.articulo_id
     RETURNING stock_actual INTO v_despues;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El artículo % de la recepción ya no existe', v_it.articulo_id USING ERRCODE = 'P0002';
    END IF;

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

COMMENT ON FUNCTION public.recepcion_aplicar_stock(uuid, jsonb) IS
  'Suma al stock lo contado en una recepción, en unidades base, una sola vez por línea (E-30/E-40). La llama finalizarRecepcion.';

REVOKE ALL ON FUNCTION public.recepcion_aplicar_stock(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recepcion_aplicar_stock(uuid, jsonb) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
