-- ─────────────────────────────────────────────────────────────────────────────
-- Documentos de una recepción: varias hojas = UN documento, y cola sin señal (E-38).
-- Tanda 1-C (app Depósito), 18/11/2026.
--
-- Qué pasaba: la app subía una foto por vez y el servidor la leía en el momento; una factura
-- de 3 hojas eran 3 comprobantes (o 2 rechazados por duplicados) y sin señal no se podía sacar
-- ninguna foto.
--
-- Qué agrega (solo columnas y funciones nuevas; NO modifica ningún documento existente):
--   · recepciones_documentos.hojas               las hojas del documento, en orden:
--        [{ "path": ruta en el bucket comprobantes, "nombre", "mime", "parte", "orden" }]
--        NULL en los documentos de una sola hoja de antes (siguen usando storage_path).
--   · recepciones_documentos.documento_local_id  id que le puso el equipo (único): un reintento
--        del outbox nunca crea un segundo documento.
--   · recepciones_documentos.partes_esperadas    en cuántos envíos viene el documento (si las
--        hojas no entran en uno solo); se lee recién cuando llegaron todos.
--   · recepciones_documentos.lectura_estado      pendiente | leyendo | leido | no_leido | duplicado.
--        NULL en los documentos de antes (se leían al subirlos).
--   · recepcion_documento_guardar_hojas(...)     guarda / agrega las hojas de un envío (idempotente).
--   · recepcion_documento_tomar_lectura(doc)     compuerta: una sola lectura por documento a la vez
--        y ninguna si ya quedó leído. Dos llamadas a "leer" no crean dos comprobantes. Una lectura
--        que se cortó a medias (quedó "leyendo" más de 6 minutos, o volvió a "pendiente" con un
--        comprobante a medio armar) se puede retomar: el servidor limpia lo anterior y relee.
--
-- Se puede correr más de una vez. ORDEN: primero esta migración y el servidor, después la APK
-- nueva (v0.5.6). Sin esta migración la app nueva no puede subir documentos: el servidor lo
-- revisa ANTES de guardar nada y rechaza el envío con "Falta actualizar el sistema: avisá a la
-- oficina" (no reintenta subiendo las hojas cada vez). La app vieja no cambia.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.recepciones_documentos
  ADD COLUMN IF NOT EXISTS hojas               jsonb,
  ADD COLUMN IF NOT EXISTS documento_local_id  uuid,
  ADD COLUMN IF NOT EXISTS partes_esperadas    int,
  ADD COLUMN IF NOT EXISTS lectura_estado      varchar(20),
  ADD COLUMN IF NOT EXISTS lectura_iniciada_at timestamptz;

COMMENT ON COLUMN public.recepciones_documentos.hojas IS
  'Hojas del documento en orden: [{path, nombre, mime, parte, orden}]. NULL = documento de una sola hoja (storage_path).';
COMMENT ON COLUMN public.recepciones_documentos.documento_local_id IS
  'Id del documento generado por el equipo que lo subió (app Depósito). Único: un reintento no duplica.';
COMMENT ON COLUMN public.recepciones_documentos.lectura_estado IS
  'pendiente (subido, falta leer) | leyendo | leido (tiene comprobante) | no_leido | duplicado. NULL = documento anterior, leído al subirlo.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_recepciones_documentos_local_id
  ON public.recepciones_documentos (documento_local_id) WHERE documento_local_id IS NOT NULL;

DO $$
BEGIN
  ALTER TABLE public.recepciones_documentos ADD CONSTRAINT recepciones_documentos_lectura_estado_check
    CHECK (lectura_estado IS NULL OR lectura_estado IN ('pendiente', 'leyendo', 'leido', 'no_leido', 'duplicado'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Guarda las hojas de UN envío de un documento. El primer envío crea el documento; los
-- siguientes (mismas hojas partidas por tamaño) agregan las suyas. Repetir un envío no
-- duplica hojas: las de esa "parte" se reemplazan por las que llegan.
-- p_hojas: [{ "path", "nombre", "mime", "orden" }] de esta parte, ya subidas al bucket.
CREATE OR REPLACE FUNCTION public.recepcion_documento_guardar_hojas(
  p_recepcion_id       uuid,
  p_documento_local_id uuid,
  p_tipo_documento     text,
  p_parte              int,
  p_partes             int,
  p_hojas              jsonb,
  p_url_primera        text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  d        recepciones_documentos%ROWTYPE;
  v_nuevas jsonb;
  v_todas  jsonb;
  v_partes int;
BEGIN
  IF p_recepcion_id IS NULL OR p_documento_local_id IS NULL OR jsonb_typeof(p_hojas) <> 'array' OR jsonb_array_length(p_hojas) = 0 THEN
    RAISE EXCEPTION 'Faltan datos del documento.' USING ERRCODE = 'P0001', DETAIL = 'datos_invalidos';
  END IF;

  -- las hojas de esta parte, marcadas con su número de parte
  SELECT jsonb_agg(h || jsonb_build_object('parte', coalesce(p_parte, 0)) ORDER BY (h ->> 'orden')::int)
    INTO v_nuevas FROM jsonb_array_elements(p_hojas) h;

  SELECT * INTO d FROM recepciones_documentos WHERE documento_local_id = p_documento_local_id FOR UPDATE;

  IF NOT FOUND THEN
    BEGIN
      INSERT INTO recepciones_documentos (
        recepcion_id, tipo_documento, url_imagen, storage_path, nombre_archivo, tipo_mime,
        procesado, hojas, documento_local_id, partes_esperadas, lectura_estado
      ) VALUES (
        p_recepcion_id, p_tipo_documento, coalesce(p_url_primera, ''),
        v_nuevas -> 0 ->> 'path', v_nuevas -> 0 ->> 'nombre', v_nuevas -> 0 ->> 'mime',
        false, v_nuevas, p_documento_local_id, greatest(coalesce(p_partes, 1), 1), 'pendiente'
      ) RETURNING * INTO d;
    EXCEPTION WHEN unique_violation THEN
      -- otro envío del mismo documento ganó la carrera: se sigue como "ya existe"
      SELECT * INTO d FROM recepciones_documentos WHERE documento_local_id = p_documento_local_id FOR UPDATE;
    END;
  END IF;

  IF d.recepcion_id IS DISTINCT FROM p_recepcion_id THEN
    RAISE EXCEPTION 'Ese documento ya se subió en otra recepción.' USING ERRCODE = 'P0001', DETAIL = 'otra_recepcion';
  END IF;

  -- Ya leído (tiene comprobante): no se le agregan hojas, pero el envío repetido no es un error
  IF d.comprobante_id IS NULL AND coalesce(d.lectura_estado, 'pendiente') IN ('pendiente', 'no_leido', 'duplicado') THEN
    SELECT jsonb_agg(h ORDER BY (h ->> 'parte')::int, (h ->> 'orden')::int) INTO v_todas
      FROM (
        SELECT h FROM jsonb_array_elements(coalesce(d.hojas, '[]'::jsonb)) h WHERE (h ->> 'parte')::int <> coalesce(p_parte, 0)
        UNION ALL
        SELECT h FROM jsonb_array_elements(v_nuevas) h
      ) x;
    UPDATE recepciones_documentos SET
      hojas            = v_todas,
      storage_path     = v_todas -> 0 ->> 'path',
      nombre_archivo   = v_todas -> 0 ->> 'nombre',
      tipo_mime        = v_todas -> 0 ->> 'mime',
      url_imagen       = CASE WHEN coalesce(p_parte, 0) = 0 AND p_url_primera IS NOT NULL THEN p_url_primera ELSE url_imagen END,
      partes_esperadas = greatest(coalesce(partes_esperadas, 1), coalesce(p_partes, 1), 1),
      lectura_estado   = 'pendiente'
    WHERE id = d.id
    RETURNING * INTO d;
  END IF;

  SELECT count(DISTINCT (h ->> 'parte')::int) INTO v_partes FROM jsonb_array_elements(coalesce(d.hojas, '[]'::jsonb)) h;
  RETURN jsonb_build_object(
    'documento_id', d.id, 'recepcion_id', d.recepcion_id,
    'hojas', jsonb_array_length(coalesce(d.hojas, '[]'::jsonb)),
    'partes_recibidas', v_partes, 'partes_esperadas', coalesce(d.partes_esperadas, 1),
    'completo', v_partes >= coalesce(d.partes_esperadas, 1),
    'lectura_estado', d.lectura_estado
  );
END;
$$;

-- Compuerta de la lectura: true = esta llamada es la que lee. false = no hay que leer (ya quedó
-- leído, o hay otra lectura en curso hace menos de 6 minutos: la lectura puede tardar hasta 5).
--   · Documento de antes (lectura_estado NULL): solo si no tiene comprobante.
--   · Documento de la app nueva: también si quedó A MEDIAS (tiene comprobante vinculado pero no
--     llegó a "leido"): quien toma la lectura limpia ese comprobante antes de leer de nuevo.
CREATE OR REPLACE FUNCTION public.recepcion_documento_tomar_lectura(p_documento_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE recepciones_documentos SET lectura_estado = 'leyendo', lectura_iniciada_at = now()
   WHERE id = p_documento_id
     AND coalesce(procesado, false) = false
     AND (   (lectura_estado IS NULL AND comprobante_id IS NULL)
          OR lectura_estado IN ('pendiente', 'no_leido', 'duplicado')
          OR (lectura_estado = 'leyendo' AND lectura_iniciada_at < now() - interval '6 minutes'));
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.recepcion_documento_guardar_hojas(uuid, uuid, text, int, int, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recepcion_documento_tomar_lectura(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recepcion_documento_guardar_hojas(uuid, uuid, text, int, int, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.recepcion_documento_tomar_lectura(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
