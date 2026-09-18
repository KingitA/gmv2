-- =====================================================================
-- Fundación móvil (apps vendedor / chofer / deposito) — ver MOBILE.md
-- =====================================================================
-- 100% ADITIVA: solo crea tablas/funciones/triggers nuevos. No modifica
-- columnas ni datos existentes. Idempotente (se puede correr dos veces).
--
--  1. mobile_cambios            log de cambios para sync delta (triggers)
--  2. precio_insumos_historial  versiones de insumos de precio (precio "a fecha X")
--  3. precios_programados       cambios de precio con vigencia futura
--  4. mobile_idempotencia       claves de idempotencia del outbox
--  5. mobile_dispositivos       registro/revocación de dispositivos
--  6. mobile_alertas_integridad diferencias de precio servidor ≠ dispositivo
--  7. mobile_pruebas_sync       escritura inocua del APK esqueleto
--
-- Todas con RLS activo y SIN policies (solo service role), salvo
-- precios_programados que se puede LEER autenticado (lo replica el vendedor).
-- =====================================================================

-- ─── 1. Log de cambios ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mobile_cambios (
  seq          BIGSERIAL PRIMARY KEY,
  tabla        TEXT        NOT NULL,
  registro_id  TEXT,
  -- id de la fila del DATASET afectado (ej. articulos_descuentos → articulo_id)
  ref_id       TEXT,
  op           CHAR(1)     NOT NULL CHECK (op IN ('I','U','D')),
  at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mobile_cambios_tabla_seq ON public.mobile_cambios (tabla, seq);
CREATE INDEX IF NOT EXISTS idx_mobile_cambios_at ON public.mobile_cambios (at);
ALTER TABLE public.mobile_cambios ENABLE ROW LEVEL SECURITY;

-- TG_ARGV[0] = columna que da el ref_id (default 'id')
CREATE OR REPLACE FUNCTION public.mobile_registrar_cambio() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ref_col TEXT := COALESCE(TG_ARGV[0], 'id');
  n JSONB := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  o JSONB := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
BEGIN
  IF TG_OP = 'UPDATE' AND n = o THEN RETURN NULL; END IF;
  BEGIN
  INSERT INTO public.mobile_cambios (tabla, registro_id, ref_id, op)
  VALUES (TG_TABLE_NAME, COALESCE(n, o)->>'id', COALESCE(n, o)->>ref_col, left(TG_OP, 1));
  -- Si cambió la referencia (ej. cliente reasignado a otro vendedor), el dataset
  -- viejo también se entera (le llega como borrado al recargar).
  IF TG_OP = 'UPDATE' AND (o->>ref_col) IS DISTINCT FROM (n->>ref_col) THEN
    INSERT INTO public.mobile_cambios (tabla, registro_id, ref_id, op)
    VALUES (TG_TABLE_NAME, o->>'id', o->>ref_col, 'U');
  END IF;
  EXCEPTION WHEN OTHERS THEN
    -- El log es un accesorio del sync móvil: jamás debe romper una escritura del ERP.
    -- Sin la fila de log, los dispositivos lo corrigen en su próximo snapshot.
    RAISE WARNING 'mobile_registrar_cambio(%): %', TG_TABLE_NAME, SQLERRM;
  END;
  RETURN NULL;
END $$;

-- ─── 2. Historial de insumos de precio ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.precio_insumos_historial (
  id             BIGSERIAL PRIMARY KEY,
  tabla          TEXT        NOT NULL,
  registro_id    TEXT        NOT NULL,
  ref_id         TEXT,
  datos          JSONB,               -- columnas de precio de la fila en esa versión
  vigente_desde  TIMESTAMPTZ NOT NULL,
  vigente_hasta  TIMESTAMPTZ          -- NULL = versión vigente
);
CREATE INDEX IF NOT EXISTS idx_pih_tabla_ref ON public.precio_insumos_historial (tabla, ref_id, vigente_hasta);
CREATE INDEX IF NOT EXISTS idx_pih_tabla_reg ON public.precio_insumos_historial (tabla, registro_id) WHERE vigente_hasta IS NULL;
ALTER TABLE public.precio_insumos_historial ENABLE ROW LEVEL SECURITY;

-- TG_ARGV[0] = columna ref (default 'id'); TG_ARGV[1] = columnas versionadas
-- separadas por coma (default: fila completa). Si ninguna columna versionada
-- cambió, no registra nada (ej. un UPDATE de stock en articulos).
-- La vigencia la da gm.vigencia_desde (la setea aplicar_precios_programados)
-- o now() para cambios que "rigen ya".
CREATE OR REPLACE FUNCTION public.precio_historial_registrar() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ref_col TEXT := COALESCE(TG_ARGV[0], 'id');
  cols    TEXT[] := CASE WHEN TG_NARGS > 1 THEN string_to_array(replace(TG_ARGV[1], ' ', ''), ',') END;
  n JSONB := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  o JSONB := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  dn JSONB; do_ JSONB;
  ts TIMESTAMPTZ := COALESCE(NULLIF(current_setting('gm.vigencia_desde', true), '')::timestamptz, now());
  rid TEXT := COALESCE(n, o)->>'id';
BEGIN
  IF cols IS NOT NULL THEN
    SELECT jsonb_object_agg(k, n->k) INTO dn FROM unnest(cols || ARRAY['id', ref_col]) k WHERE n ? k;
    SELECT jsonb_object_agg(k, o->k) INTO do_ FROM unnest(cols || ARRAY['id', ref_col]) k WHERE o ? k;
  ELSE
    dn := n; do_ := o;
  END IF;
  IF TG_OP = 'UPDATE' AND dn = do_ THEN RETURN NULL; END IF;
  IF rid IS NULL THEN RETURN NULL; END IF;

  BEGIN
  UPDATE public.precio_insumos_historial
     SET vigente_hasta = ts
   WHERE tabla = TG_TABLE_NAME AND registro_id = rid AND vigente_hasta IS NULL;
  IF TG_OP <> 'DELETE' THEN
    INSERT INTO public.precio_insumos_historial (tabla, registro_id, ref_id, datos, vigente_desde)
    VALUES (TG_TABLE_NAME, rid, n->>ref_col, dn, ts);
  END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Nunca bloquear la escritura de negocio. Una versión faltante solo afecta la
    -- re-verificación de un pedido offline justo en ese instante (queda como alerta).
    RAISE WARNING 'precio_historial_registrar(%): %', TG_TABLE_NAME, SQLERRM;
  END;
  RETURN NULL;
END $$;

-- ─── 3. Precios programados ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.precios_programados (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tabla           TEXT        NOT NULL CHECK (tabla IN ('articulos', 'listas_precio', 'listas_precio_reglas')),
  registro_id     UUID        NOT NULL,
  cambios         JSONB       NOT NULL CHECK (jsonb_typeof(cambios) = 'object'),
  vigencia_desde  TIMESTAMPTZ NOT NULL,
  estado          TEXT        NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aplicado', 'cancelado', 'error')),
  error           TEXT,
  nota            TEXT,
  creado_por      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  aplicado_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_precios_programados_pend ON public.precios_programados (vigencia_desde) WHERE estado = 'pendiente';
ALTER TABLE public.precios_programados ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS precios_programados_select ON public.precios_programados;
CREATE POLICY precios_programados_select ON public.precios_programados FOR SELECT TO authenticated USING (true);

-- Columnas que un cambio programado puede tocar (lo que usa el motor de precios)
CREATE OR REPLACE FUNCTION public.precios_programados_columnas(p_tabla TEXT) RETURNS TEXT[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_tabla
    WHEN 'articulos' THEN ARRAY['precio_compra','precio_base','precio_base_contado','precio_lista_especial',
                                'oferta_lista_especial','porcentaje_ganancia','bonif_recargo','descuento_propio',
                                'iva_compras','iva_ventas','segmento_precio','categoria']
    WHEN 'listas_precio' THEN ARRAY['recargo_limpieza_bazar','recargo_perfumeria_negro','recargo_perfumeria_blanco']
    WHEN 'listas_precio_reglas' THEN ARRAY['formulas']
  END
$$;

-- Materializa los programados vencidos. La llaman pg_cron (cada minuto) y
-- /api/mobile/sync/estado (oportunista). Registra el historial con
-- vigente_desde = la vigencia programada (no la hora del job).
CREATE OR REPLACE FUNCTION public.aplicar_precios_programados() RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p RECORD; claves TEXT[]; permitidas TEXT[]; n INTEGER := 0;
BEGIN
  FOR p IN
    SELECT * FROM public.precios_programados
     WHERE estado = 'pendiente' AND vigencia_desde <= now()
     ORDER BY vigencia_desde, id
     FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      permitidas := public.precios_programados_columnas(p.tabla);
      SELECT array_agg(k) INTO claves FROM jsonb_object_keys(p.cambios) k;
      IF claves IS NULL OR NOT claves <@ permitidas THEN
        RAISE EXCEPTION 'Columnas no permitidas: %', array_to_string(claves, ',');
      END IF;
      PERFORM set_config('gm.vigencia_desde', p.vigencia_desde::text, true);
      EXECUTE format(
        'UPDATE public.%I t SET (%s) = (SELECT %s FROM jsonb_populate_record(NULL::public.%I, $1)) WHERE t.id = $2',
        p.tabla,
        (SELECT string_agg(quote_ident(k), ',') FROM unnest(claves) k),
        (SELECT string_agg(quote_ident(k), ',') FROM unnest(claves) k),
        p.tabla
      ) USING p.cambios, p.registro_id;
      PERFORM set_config('gm.vigencia_desde', '', true);
      UPDATE public.precios_programados SET estado = 'aplicado', aplicado_at = now(), error = NULL WHERE id = p.id;
      n := n + 1;
    EXCEPTION WHEN OTHERS THEN
      PERFORM set_config('gm.vigencia_desde', '', true);
      UPDATE public.precios_programados SET estado = 'error', error = SQLERRM WHERE id = p.id;
    END;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.aplicar_precios_programados() FROM PUBLIC, anon, authenticated;

-- ─── 4-7. Tablas del outbox / dispositivos ───────────────────────────
CREATE TABLE IF NOT EXISTS public.mobile_idempotencia (
  idempotency_key UUID        PRIMARY KEY,
  usuario_id      UUID        NOT NULL,
  tipo            TEXT        NOT NULL,
  payload_hash    TEXT        NOT NULL,
  device_id       TEXT,
  capturado_at    TIMESTAMPTZ,
  estado          TEXT        NOT NULL CHECK (estado IN ('procesando', 'aplicado', 'rechazado')),
  resultado       JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mobile_idem_created ON public.mobile_idempotencia (created_at);
ALTER TABLE public.mobile_idempotencia ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.mobile_dispositivos (
  device_id           TEXT        NOT NULL,
  app                 TEXT        NOT NULL,
  usuario_id          UUID,
  app_version         TEXT,
  ultimo_contacto_at  TIMESTAMPTZ,
  revocado            BOOLEAN     NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, app)
);
ALTER TABLE public.mobile_dispositivos ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.mobile_alertas_integridad (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo             TEXT        NOT NULL,
  operacion        TEXT,
  idempotency_key  UUID,
  usuario_id       UUID,
  device_id        TEXT,
  cliente_id       UUID,
  capturado_at     TIMESTAMPTZ,
  detalle          JSONB,
  resuelta         BOOLEAN     NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mobile_alertas_pend ON public.mobile_alertas_integridad (created_at) WHERE NOT resuelta;
ALTER TABLE public.mobile_alertas_integridad ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.mobile_pruebas_sync (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key  UUID        NOT NULL UNIQUE,
  usuario_id       UUID        NOT NULL,
  device_id        TEXT,
  app              TEXT,
  texto            TEXT        NOT NULL,
  capturado_at     TIMESTAMPTZ,
  recibido_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.mobile_pruebas_sync ENABLE ROW LEVEL SECURITY;

-- ─── Triggers ────────────────────────────────────────────────────────
-- Log de cambios (sync delta). ref = id de la fila del dataset.
DO $$
DECLARE t RECORD;
BEGIN
  FOR t IN SELECT * FROM (VALUES
      ('articulos', 'id'),
      ('articulos_descuentos', 'articulo_id'),
      ('listas_precio', 'id'),
      ('listas_precio_reglas', 'id'),
      ('clientes', 'id'),
      ('bonificaciones', 'cliente_id'),
      ('cliente_proveedor_condicion', 'cliente_id'),
      ('cliente_marca_condicion', 'cliente_id'),
      ('precios_programados', 'id')
    ) AS v(tabla, ref)
  LOOP
    IF to_regclass('public.' || t.tabla) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_mobile_cambios ON public.%I', t.tabla);
      EXECUTE format(
        'CREATE TRIGGER trg_mobile_cambios AFTER INSERT OR UPDATE OR DELETE ON public.%I
           FOR EACH ROW EXECUTE FUNCTION public.mobile_registrar_cambio(%L)', t.tabla, t.ref);
    END IF;
  END LOOP;
END $$;

-- Historial de insumos de precio (solo columnas que afectan el precio).
DO $$
DECLARE t RECORD;
BEGIN
  FOR t IN SELECT * FROM (VALUES
      ('articulos', 'id', 'precio_compra,precio_base,precio_base_contado,precio_lista_especial,oferta_lista_especial,porcentaje_ganancia,bonif_recargo,descuento_propio,iva_compras,iva_ventas,segmento_precio,categoria,proveedor_id,marca_id,rubro_id'),
      ('articulos_descuentos', 'articulo_id', 'articulo_id,tipo,porcentaje,orden'),
      ('listas_precio', 'id', 'codigo,recargo_limpieza_bazar,recargo_perfumeria_negro,recargo_perfumeria_blanco'),
      ('listas_precio_reglas', 'id', 'grupo_precio,iva_compras,iva_ventas,formulas'),
      ('clientes', 'id', 'metodo_facturacion,lista_precio_id,lista_limpieza_id,metodo_limpieza,lista_perf0_id,metodo_perf0,lista_perf_plus_id,metodo_perf_plus,vendedor_id'),
      ('bonificaciones', 'cliente_id', 'cliente_id,tipo,segmento,porcentaje,activo'),
      ('cliente_proveedor_condicion', 'cliente_id', 'cliente_id,proveedor_id,lista_precio_id,metodo_facturacion,dto_general_pct,dto_viajante_pct,dto_mercaderia_pct'),
      ('cliente_marca_condicion', 'cliente_id', 'cliente_id,marca_id,lista_precio_id,metodo_facturacion,dto_general_pct,dto_viajante_pct,dto_mercaderia_pct')
    ) AS v(tabla, ref, cols)
  LOOP
    IF to_regclass('public.' || t.tabla) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_precio_historial ON public.%I', t.tabla);
      EXECUTE format(
        'CREATE TRIGGER trg_precio_historial AFTER INSERT OR UPDATE OR DELETE ON public.%I
           FOR EACH ROW EXECUTE FUNCTION public.precio_historial_registrar(%L, %L)', t.tabla, t.ref, t.cols);
      -- Versión base: el estado actual rige "desde siempre" (2000-01-01).
      EXECUTE format(
        'INSERT INTO public.precio_insumos_historial (tabla, registro_id, ref_id, datos, vigente_desde)
         SELECT %L, r->>''id'', r->>%L,
                (SELECT jsonb_object_agg(k, r->k) FROM unnest(string_to_array(%L, '','') || ARRAY[''id'', %L]) k WHERE r ? k),
                ''2000-01-01''::timestamptz
           FROM (SELECT to_jsonb(x) r FROM public.%I x) s
          WHERE NOT EXISTS (SELECT 1 FROM public.precio_insumos_historial h
                             WHERE h.tabla = %L AND h.registro_id = s.r->>''id'')',
        t.tabla, t.ref, t.cols, t.ref, t.tabla, t.tabla);
    END IF;
  END LOOP;
END $$;

-- ─── Jobs (pg_cron, si está habilitado en el proyecto) ───────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('gm_aplicar_precios_programados', 'gm_purgar_mobile');
    PERFORM cron.schedule('gm_aplicar_precios_programados', '* * * * *', 'SELECT public.aplicar_precios_programados()');
    PERFORM cron.schedule('gm_purgar_mobile', '17 4 * * *', $job$
      DELETE FROM public.mobile_cambios WHERE at < now() - interval '30 days';
      DELETE FROM public.mobile_idempotencia WHERE created_at < now() - interval '90 days' AND estado <> 'procesando';
    $job$);
  END IF;
END $$;
