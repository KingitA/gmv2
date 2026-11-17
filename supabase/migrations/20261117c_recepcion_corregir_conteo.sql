-- ─────────────────────────────────────────────────────────────────────────────
-- Corregir desde la oficina lo que contó el depósito, con registro de quién.
-- Tanda 1-B de la entrada de mercadería (E-44), 17/11/2026.
--
-- Hoy, si el depósito contó mal y la recepción ya se finalizó, no hay forma de
-- corregirlo: el stock quedó sumado y la verificación muestra una diferencia que no
-- existe. Esta función cambia lo recibido de UNA línea, en unidades, y en la misma
-- transacción ajusta el stock por la diferencia (solo si esa línea ya había sumado
-- stock) y deja el registro: quién, cuándo, de cuánto a cuánto y por qué.
--
-- No toca datos al instalarse. Se puede correr más de una vez. El resto del sistema
-- funciona sin ella; lo único que la necesita es el botón "Corregir lo recibido" de
-- la verificación (sin la migración avisa que falta y no cambia nada).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.recepciones_correcciones (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recepcion_item_id  uuid NOT NULL REFERENCES public.recepciones_items(id) ON DELETE CASCADE,
  recepcion_id       uuid NOT NULL REFERENCES public.recepciones(id) ON DELETE CASCADE,
  articulo_id        uuid,
  unidades_antes     numeric(18,4) NOT NULL,
  unidades_despues   numeric(18,4) NOT NULL,
  -- lo que se movió el stock (0 si la recepción todavía no había sumado stock)
  ajuste_stock       numeric(18,4) NOT NULL DEFAULT 0,
  stock_antes        numeric(18,4),
  motivo             text NOT NULL,
  usuario_id         uuid,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recepciones_correcciones_recepcion ON public.recepciones_correcciones (recepcion_id);

COMMENT ON TABLE public.recepciones_correcciones IS
  'Correcciones hechas desde la oficina a lo que contó el depósito en una recepción: quién, cuándo, de cuánto a cuánto, por qué y cuánto se ajustó el stock.';

-- Tabla de compras: la lee y la escribe SOLO el servidor (cliente de servicio); ni las apps ni
-- el navegador la tocan directo.
ALTER TABLE public.recepciones_correcciones ALTER COLUMN articulo_id DROP NOT NULL;
ALTER TABLE public.recepciones_correcciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recepciones_correcciones_lectura ON public.recepciones_correcciones;
REVOKE ALL ON public.recepciones_correcciones FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.recepciones_correcciones TO service_role;

-- p_unidades_antes: lo que valía la línea en unidades según el servidor (se usa solo si la
-- línea es anterior a la migración 20261116a y no guardó sus unidades).
CREATE OR REPLACE FUNCTION public.recepcion_corregir_conteo(
  p_item_id        uuid,
  p_unidades       numeric,
  p_unidades_antes numeric,
  p_usuario_id     uuid,
  p_motivo         text
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_it      record;
  v_estado  text;
  v_antes   numeric;
  v_sumo    boolean;
  v_delta   numeric := 0;
  v_stock   numeric;
BEGIN
  IF p_unidades IS NULL OR p_unidades < 0 THEN
    RAISE EXCEPTION 'La cantidad recibida no puede ser negativa.' USING ERRCODE = 'P0001', DETAIL = 'cantidad_invalida';
  END IF;
  IF coalesce(btrim(p_motivo), '') = '' THEN
    RAISE EXCEPTION 'Hay que escribir el motivo de la corrección.' USING ERRCODE = 'P0001', DETAIL = 'sin_motivo';
  END IF;

  SELECT * INTO v_it FROM recepciones_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La línea de la recepción ya no existe.' USING ERRCODE = 'P0002', DETAIL = 'no_encontrado';
  END IF;
  SELECT estado INTO v_estado FROM recepciones WHERE id = v_it.recepcion_id;
  IF v_estado = 'cancelada' THEN
    RAISE EXCEPTION 'La recepción está cancelada.' USING ERRCODE = 'P0001', DETAIL = 'recepcion_cancelada';
  END IF;

  v_antes := coalesce(v_it.cantidad_fisica_base, p_unidades_antes, 0);
  -- ¿Esta línea ya sumó stock? (marca de 20261116a, o recepción finalizada con el código anterior)
  v_sumo := v_it.stock_aplicado_at IS NOT NULL OR v_estado = 'finalizada';

  IF v_sumo THEN
    v_delta := round(p_unidades - v_antes, 4);
    IF v_delta <> 0 THEN
      UPDATE articulos
         SET stock_actual = coalesce(stock_actual, 0) + v_delta
       WHERE id = v_it.articulo_id
       RETURNING stock_actual - v_delta INTO v_stock;
    END IF;
  END IF;

  -- La línea queda contada en unidades
  UPDATE recepciones_items
     SET cantidad_fisica      = p_unidades,
         unidad_conteo        = 'unidad',
         factor_conteo        = CASE WHEN v_sumo THEN 1 ELSE factor_conteo END,
         cantidad_fisica_base = CASE WHEN v_sumo THEN p_unidades ELSE cantidad_fisica_base END,
         stock_aplicado_at    = CASE WHEN v_sumo THEN coalesce(stock_aplicado_at, now()) ELSE stock_aplicado_at END,
         estado_linea         = CASE WHEN p_unidades > 0 THEN 'ok' ELSE 'faltante' END
   WHERE id = p_item_id;

  INSERT INTO recepciones_correcciones (recepcion_item_id, recepcion_id, articulo_id, unidades_antes, unidades_despues, ajuste_stock, stock_antes, motivo, usuario_id)
  VALUES (p_item_id, v_it.recepcion_id, v_it.articulo_id, v_antes, p_unidades, v_delta, v_stock, btrim(p_motivo), p_usuario_id);

  RETURN jsonb_build_object('success', true, 'unidades_antes', v_antes, 'unidades_despues', p_unidades,
                            'ajuste_stock', v_delta, 'stock_antes', v_stock, 'ya_habia_sumado_stock', v_sumo);
END;
$$;

COMMENT ON FUNCTION public.recepcion_corregir_conteo(uuid, numeric, numeric, uuid, text) IS
  'Corrige lo recibido de una línea (en unidades), ajusta el stock por la diferencia si ya había sumado y deja el registro de quién y por qué (E-44).';

REVOKE ALL ON FUNCTION public.recepcion_corregir_conteo(uuid, numeric, numeric, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recepcion_corregir_conteo(uuid, numeric, numeric, uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
