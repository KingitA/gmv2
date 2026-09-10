-- ============================================================================
-- Catálogos: tipos_bulto y tipos_fraccion
--
-- Hasta hoy las opciones de "Unid. Medida" (articulos.unidad_de_medida) y
-- "Tipo de fracción" (articulos.tipo_fraccion) eran arrays hardcodeados en
-- app/articulos/page.tsx, y otras pantallas de depósito permitían texto libre
-- (por eso hay PACKS/PACL/BLIS/CAJ/CAJITA/U/UN3 cargados).
--
-- Esta migración:
--   1. crea las dos tablas catálogo (ABM en /tablas/tipos-bulto y /tablas/tipos-fraccion)
--   2. normaliza los valores ya cargados en articulos para que coincidan
--   3. agrega cualquier valor restante al catálogo (nunca se pierde un dato)
--   4. enlaza articulos → catálogo por FK sobre `nombre`:
--        ON UPDATE CASCADE  → renombrar un tipo en /tablas actualiza todos los artículos
--        ON DELETE RESTRICT → no se puede borrar un tipo que esté en uso
--
-- NO se agregan columnas nuevas a articulos: se reutilizan las existentes
-- unidad_de_medida y tipo_fraccion (texto), que pasan a estar restringidas.
-- ============================================================================

-- ── 1. Tablas catálogo ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tipos_bulto (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      text        UNIQUE NOT NULL,   -- valor guardado en articulos.unidad_de_medida
  descripcion text,
  orden       int         NOT NULL DEFAULT 0,
  activo      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE  public.tipos_bulto IS 'Catálogo de tipos de bulto / unidad de medida del artículo (select "Tipo de bulto" de la ficha). Referenciado por articulos.unidad_de_medida.';
COMMENT ON COLUMN public.tipos_bulto.nombre IS 'Nombre en MAYÚSCULAS. Es la clave que se guarda en articulos.unidad_de_medida (FK ON UPDATE CASCADE).';

CREATE TABLE IF NOT EXISTS public.tipos_fraccion (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      text        UNIQUE NOT NULL,   -- valor guardado en articulos.tipo_fraccion
  descripcion text,
  orden       int         NOT NULL DEFAULT 0,
  activo      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE  public.tipos_fraccion IS 'Catálogo de tipos de fracción (pack, blister, docena…) del artículo. Referenciado por articulos.tipo_fraccion.';
COMMENT ON COLUMN public.tipos_fraccion.nombre IS 'Nombre en MAYÚSCULAS. Es la clave que se guarda en articulos.tipo_fraccion (FK ON UPDATE CASCADE).';

-- ── 2. Seed (las listas que estaban hardcodeadas + BULTO) ──────────────────
INSERT INTO public.tipos_bulto (nombre, descripcion, orden) VALUES
  ('UN',      'Unidad',                 10),
  ('BULTO',   'Bulto',                  20),
  ('CAJA',    'Caja',                   30),
  ('PACK',    'Pack',                   40),
  ('BLISTER', 'Blister',                50),
  ('SET',     'Set',                    60),
  ('KG',      'Kilogramo',              70),
  ('LT',      'Litro',                  80),
  ('MT',      'Metro',                  90)
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO public.tipos_fraccion (nombre, descripcion, orden) VALUES
  ('UN',      'Unidad',                 10),
  ('BULTO',   'Bulto',                  20),
  ('PACK',    'Pack',                   30),
  ('BLISTER', 'Blister',                40),
  ('CAJA',    'Caja',                   50),
  ('DOCENA',  'Docena',                 60),
  ('SET',     'Set',                    70),
  ('DISPLAY', 'Display / exhibidor',    80)
ON CONFLICT (nombre) DO NOTHING;

-- ── 3. Normalizar lo ya cargado en articulos ───────────────────────────────
-- Vacíos → NULL, todo a MAYÚSCULAS sin espacios
UPDATE public.articulos SET unidad_de_medida = NULLIF(upper(trim(unidad_de_medida)), '')
  WHERE unidad_de_medida IS DISTINCT FROM NULLIF(upper(trim(unidad_de_medida)), '');
UPDATE public.articulos SET tipo_fraccion = NULLIF(upper(trim(tipo_fraccion)), '')
  WHERE tipo_fraccion IS DISTINCT FROM NULLIF(upper(trim(tipo_fraccion)), '');

-- Sinónimos / typos detectados en la DB al 2026-09-10
UPDATE public.articulos SET unidad_de_medida = CASE unidad_de_medida
    WHEN 'U'      THEN 'UN'
    WHEN 'UNIDAD' THEN 'UN'
    WHEN 'BLIS'   THEN 'BLISTER'
    WHEN 'PACKS'  THEN 'PACK'
    WHEN 'CAJ'    THEN 'CAJA'
    WHEN 'CAJAS'  THEN 'CAJA'
    WHEN 'CAJITA' THEN 'CAJA'
    ELSE unidad_de_medida END
  WHERE unidad_de_medida IN ('U','UNIDAD','BLIS','PACKS','CAJ','CAJAS','CAJITA');

UPDATE public.articulos SET tipo_fraccion = CASE tipo_fraccion
    WHEN 'UNIDAD'   THEN 'UN'
    WHEN 'UNIDADES' THEN 'UN'
    WHEN 'UN3'      THEN 'UN'      -- sku 181: "x3" quedó pegado al tipo; cantidad_fraccion ya es 3
    WHEN 'BLIS'     THEN 'BLISTER'
    WHEN 'PACKS'    THEN 'PACK'
    WHEN 'PACL'     THEN 'PACK'
    WHEN 'CAJITA'   THEN 'CAJA'
    WHEN 'CAJAS'    THEN 'CAJA'
    ELSE tipo_fraccion END
  WHERE tipo_fraccion IN ('UNIDAD','UNIDADES','UN3','BLIS','PACKS','PACL','CAJITA','CAJAS');

-- Cualquier otro valor que siga existiendo se incorpora al catálogo tal cual
-- (queda visible en /tablas para renombrarlo o fusionarlo a mano). Así la FK
-- nunca falla y no se pierde información.
INSERT INTO public.tipos_bulto (nombre, orden)
  SELECT DISTINCT unidad_de_medida, 900 FROM public.articulos
  WHERE unidad_de_medida IS NOT NULL
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO public.tipos_fraccion (nombre, orden)
  SELECT DISTINCT tipo_fraccion, 900 FROM public.articulos
  WHERE tipo_fraccion IS NOT NULL
ON CONFLICT (nombre) DO NOTHING;

-- ── 4. Integridad referencial ──────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE public.articulos
    ADD CONSTRAINT articulos_unidad_de_medida_fkey
    FOREIGN KEY (unidad_de_medida) REFERENCES public.tipos_bulto (nombre)
    ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.articulos
    ADD CONSTRAINT articulos_tipo_fraccion_fkey
    FOREIGN KEY (tipo_fraccion) REFERENCES public.tipos_fraccion (nombre)
    ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_articulos_unidad_de_medida ON public.articulos (unidad_de_medida);
CREATE INDEX IF NOT EXISTS idx_articulos_tipo_fraccion    ON public.articulos (tipo_fraccion);

-- Sin RLS: mismo criterio que marcas / tipos_canal / condiciones_entrega
-- (los ABM de /tablas escriben con el cliente browser autenticado).
