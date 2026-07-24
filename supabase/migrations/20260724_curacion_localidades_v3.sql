-- ─────────────────────────────────────────────────────────────────────────────
-- Curación post-v2: acentos + typos de catálogo + localidades faltantes (v3)
-- Requiere haber aplicado 20260724_sync_texto_fk_v2.sql.
--
-- Diagnóstico de lo que quedó sin resolver tras la v2:
--  · El match por nombre no ignoraba TILDES: "BAHIA BLANCA" (186 clientes) no
--    matcheaba "Bahía Blanca" del catálogo; "PERFUMERIA" (17 artículos) no
--    matcheaba el rubro "Perfumería". → norm_txt() sin acentos en los triggers.
--  · Typos EN EL CATÁLOGO: "CHOEL CHOEL" (es Choele Choel) y "CHINCHINALES"
--    (es Chichinales) — los clientes lo escribían bien y no matcheaban.
--  · Variantes de grafía en clientes (ING.WHITE ×3, GONZALEZ CHAVEZ ×3...).
--  · Localidades que sí faltan en el catálogo → se agregan con provincia y
--    zona propuestas. ⚠ LAS ZONAS MARCADAS "REVISAR" SON PROPUESTAS POR
--    GEOGRAFÍA: revisalas contra tus rutas reales antes de correr el script.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ 1. Normalizador sin acentos (sin extensiones; ñ se conserva) ═══
CREATE OR REPLACE FUNCTION public.norm_txt(t text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT translate(lower(trim(coalesce(t, ''))),
                   'áéíóúàèìòùâêîôûäëïöü',
                   'aeiouaeiouaeiouaeiou')
$$;

-- ═══ 2. Triggers: mismo diseño v2, matching con norm_txt ═══
CREATE OR REPLACE FUNCTION articulos_sync_taxonomia_fk()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  fk_cambio boolean;
  txt_cambio boolean;
BEGIN
  -- ── RUBRO ──
  fk_cambio  := (TG_OP = 'INSERT' AND NEW.rubro_id IS NOT NULL)
             OR (TG_OP = 'UPDATE' AND NEW.rubro_id IS DISTINCT FROM OLD.rubro_id);
  txt_cambio := (TG_OP = 'INSERT' AND COALESCE(trim(NEW.rubro), '') <> '')
             OR (TG_OP = 'UPDATE' AND NEW.rubro IS DISTINCT FROM OLD.rubro);

  IF fk_cambio AND NEW.rubro_id IS NOT NULL THEN
    SELECT nombre INTO NEW.rubro FROM rubros WHERE id = NEW.rubro_id;
  ELSIF txt_cambio THEN
    IF COALESCE(trim(NEW.rubro), '') = '' THEN
      NEW.rubro_id := NULL;
    ELSE
      SELECT id INTO NEW.rubro_id FROM rubros WHERE norm_txt(nombre) = norm_txt(NEW.rubro);
    END IF;
  ELSIF NEW.rubro_id IS NOT NULL AND COALESCE(trim(NEW.rubro), '') = '' THEN
    SELECT nombre INTO NEW.rubro FROM rubros WHERE id = NEW.rubro_id;
  ELSIF NEW.rubro_id IS NULL AND COALESCE(trim(NEW.rubro), '') <> '' THEN
    SELECT id INTO NEW.rubro_id FROM rubros WHERE norm_txt(nombre) = norm_txt(NEW.rubro);
  END IF;

  -- ── CATEGORIA (desambigua por rubro) ──
  fk_cambio  := (TG_OP = 'INSERT' AND NEW.categoria_id IS NOT NULL)
             OR (TG_OP = 'UPDATE' AND NEW.categoria_id IS DISTINCT FROM OLD.categoria_id);
  txt_cambio := (TG_OP = 'INSERT' AND COALESCE(trim(NEW.categoria), '') <> '')
             OR (TG_OP = 'UPDATE' AND NEW.categoria IS DISTINCT FROM OLD.categoria);

  IF fk_cambio AND NEW.categoria_id IS NOT NULL THEN
    SELECT nombre INTO NEW.categoria FROM categorias WHERE id = NEW.categoria_id;
  ELSIF txt_cambio OR (NEW.categoria_id IS NULL AND COALESCE(trim(NEW.categoria), '') <> '')
     OR (NEW.categoria_id IS NOT NULL AND COALESCE(trim(NEW.categoria), '') = '') THEN
    IF COALESCE(trim(NEW.categoria), '') = '' AND NEW.categoria_id IS NOT NULL AND NOT txt_cambio THEN
      SELECT nombre INTO NEW.categoria FROM categorias WHERE id = NEW.categoria_id;
    ELSIF COALESCE(trim(NEW.categoria), '') = '' THEN
      NEW.categoria_id := NULL;
    ELSE
      NEW.categoria_id := NULL;
      IF NEW.rubro_id IS NOT NULL THEN
        SELECT id INTO NEW.categoria_id FROM categorias
        WHERE rubro_id = NEW.rubro_id AND norm_txt(nombre) = norm_txt(NEW.categoria);
      END IF;
      IF NEW.categoria_id IS NULL THEN
        SELECT min(id::text)::uuid INTO NEW.categoria_id FROM categorias
        WHERE norm_txt(nombre) = norm_txt(NEW.categoria)
        HAVING count(*) = 1;
      END IF;
    END IF;
  END IF;

  -- ── SUBCATEGORIA (desambigua por categoría) ──
  fk_cambio  := (TG_OP = 'INSERT' AND NEW.subcategoria_id IS NOT NULL)
             OR (TG_OP = 'UPDATE' AND NEW.subcategoria_id IS DISTINCT FROM OLD.subcategoria_id);
  txt_cambio := (TG_OP = 'INSERT' AND COALESCE(trim(NEW.subcategoria), '') <> '')
             OR (TG_OP = 'UPDATE' AND NEW.subcategoria IS DISTINCT FROM OLD.subcategoria);

  IF fk_cambio AND NEW.subcategoria_id IS NOT NULL THEN
    SELECT nombre INTO NEW.subcategoria FROM subcategorias WHERE id = NEW.subcategoria_id;
  ELSIF txt_cambio OR (NEW.subcategoria_id IS NULL AND COALESCE(trim(NEW.subcategoria), '') <> '')
     OR (NEW.subcategoria_id IS NOT NULL AND COALESCE(trim(NEW.subcategoria), '') = '') THEN
    IF COALESCE(trim(NEW.subcategoria), '') = '' AND NEW.subcategoria_id IS NOT NULL AND NOT txt_cambio THEN
      SELECT nombre INTO NEW.subcategoria FROM subcategorias WHERE id = NEW.subcategoria_id;
    ELSIF COALESCE(trim(NEW.subcategoria), '') = '' THEN
      NEW.subcategoria_id := NULL;
    ELSE
      NEW.subcategoria_id := NULL;
      IF NEW.categoria_id IS NOT NULL THEN
        SELECT id INTO NEW.subcategoria_id FROM subcategorias
        WHERE categoria_id = NEW.categoria_id AND norm_txt(nombre) = norm_txt(NEW.subcategoria);
      END IF;
      IF NEW.subcategoria_id IS NULL THEN
        SELECT min(id::text)::uuid INTO NEW.subcategoria_id FROM subcategorias
        WHERE norm_txt(nombre) = norm_txt(NEW.subcategoria)
        HAVING count(*) = 1;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION clientes_sync_localidad_fk()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  fk_cambio boolean;
  txt_cambio boolean;
  v_loc record;
BEGIN
  fk_cambio  := (TG_OP = 'INSERT' AND NEW.localidad_id IS NOT NULL)
             OR (TG_OP = 'UPDATE' AND NEW.localidad_id IS DISTINCT FROM OLD.localidad_id);
  txt_cambio := (TG_OP = 'INSERT' AND COALESCE(trim(NEW.localidad), '') <> '')
             OR (TG_OP = 'UPDATE' AND NEW.localidad IS DISTINCT FROM OLD.localidad);

  IF txt_cambio AND NOT fk_cambio THEN
    IF COALESCE(trim(NEW.localidad), '') = '' THEN
      NEW.localidad_id := NULL;
    ELSE
      SELECT id INTO NEW.localidad_id FROM localidades
      WHERE norm_txt(nombre) = norm_txt(NEW.localidad);
    END IF;
  ELSIF NOT fk_cambio AND NEW.localidad_id IS NULL AND COALESCE(trim(NEW.localidad), '') <> '' THEN
    SELECT id INTO NEW.localidad_id FROM localidades
    WHERE norm_txt(nombre) = norm_txt(NEW.localidad);
  END IF;

  IF NEW.localidad_id IS NOT NULL THEN
    SELECT l.nombre, l.provincia INTO v_loc FROM localidades l WHERE l.id = NEW.localidad_id;
    IF FOUND THEN
      NEW.localidad := v_loc.nombre;
      IF COALESCE(trim(v_loc.provincia), '') <> '' THEN NEW.provincia := v_loc.provincia; END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- El índice único de localidades pasa a ser sin acentos (evita cargar
-- "Bahía Blanca" y "BAHIA BLANCA" como dos localidades distintas)
DROP INDEX IF EXISTS uq_localidades_nombre;
CREATE UNIQUE INDEX uq_localidades_nombre ON localidades (norm_txt(nombre));

-- ═══ 3. Arreglos del CATÁLOGO ═══
-- Estilo canónico del catálogo: MAYÚSCULAS sin tildes (como la mayoría)
UPDATE localidades SET nombre = 'BAHIA BLANCA'  WHERE norm_txt(nombre) = 'bahia blanca';
UPDATE localidades SET nombre = 'CHOELE CHOEL'  WHERE norm_txt(nombre) = 'choel choel';   -- typo del catálogo
UPDATE localidades SET nombre = 'CHICHINALES'   WHERE norm_txt(nombre) = 'chinchinales';  -- typo del catálogo
UPDATE localidades SET provincia = upper(translate(provincia, 'áéíóú', 'aeiou'))
WHERE provincia IS NOT NULL AND provincia <> upper(translate(provincia, 'áéíóú', 'aeiou'));

-- Typo en artículos: "PERFUMERI" → rubro Perfumería (el trigger resuelve el FK)
UPDATE articulos SET rubro = 'Perfumería' WHERE norm_txt(rubro) = 'perfumeri';

-- ═══ 4. LOCALIDADES FALTANTES (provincia por geografía, zona propuesta) ═══
-- ⚠ Las marcadas "REVISAR" son mi propuesta según el mapa: confirmá que
--   coincidan con tus rutas de reparto reales (editá la columna zona si no).
INSERT INTO localidades (nombre, provincia, zona_id)
SELECT v.nombre, v.provincia, z.id
FROM (VALUES
  ('INGENIERO WHITE',     'BUENOS AIRES', 'BAHIA'),
  ('QUEQUEN',             'BUENOS AIRES', 'NECOCHEA'),
  ('GONZALES CHAVES',     'BUENOS AIRES', 'JUAREZ'),            -- REVISAR (¿o TRES ARROYOS?)
  ('TORNQUIST',           'BUENOS AIRES', 'CARHUE'),            -- REVISAR
  ('SIERRA DE LA VENTANA','BUENOS AIRES', 'CARHUE'),            -- REVISAR
  ('PIGUE',               'BUENOS AIRES', 'CARHUE'),            -- REVISAR
  ('SAAVEDRA',            'BUENOS AIRES', 'CARHUE'),            -- REVISAR
  ('VILLA IRIS',          'BUENOS AIRES', 'CARHUE'),            -- REVISAR
  ('PEDRO LURO',          'BUENOS AIRES', 'VILLARINO'),
  ('MEDANOS',             'BUENOS AIRES', 'VILLARINO'),
  ('VILLALONGA',          'BUENOS AIRES', 'VIEDMA-PATAGONES'),  -- REVISAR (partido de Patagones)
  ('HINOJO',              'BUENOS AIRES', 'OLAVARRIA'),
  ('TAPALQUE',            'BUENOS AIRES', 'OLAVARRIA'),         -- REVISAR
  ('LA MADRID',           'BUENOS AIRES', 'LA MADRID'),
  ('LOBERIA',             'BUENOS AIRES', 'NECOCHEA'),          -- REVISAR
  ('INGENIERO HUERGO',    'RIO NEGRO',    'ALTO VALLE'),
  ('RIO COLORADO',        'RIO NEGRO',    'VALLE MEDIO'),       -- REVISAR
  ('GUARDIA MITRE',       'RIO NEGRO',    'VIEDMA-PATAGONES'),  -- REVISAR
  ('MACACHIN',            'LA PAMPA',     'LA PAMPA'),
  ('ATALIVA ROCA',        'LA PAMPA',     'LA PAMPA'),
  ('GENERAL SAN MARTIN',  'LA PAMPA',     'LA PAMPA'),          -- REVISAR (¿es el de La Pampa?)
  ('NEUQUEN',             'NEUQUEN',      'ALTO VALLE'),        -- REVISAR
  ('PLOTTIER',            'NEUQUEN',      'ALTO VALLE'),        -- REVISAR
  ('PUERTO SAN JULIAN',   'SANTA CRUZ',   'SUR'),
  ('RAWSON',              'CHUBUT',       'SUR')                -- REVISAR (¿o Rawson de Bs.As.?)
) AS v(nombre, provincia, zona)
LEFT JOIN zonas z ON z.nombre = v.zona
WHERE NOT EXISTS (SELECT 1 FROM localidades l WHERE norm_txt(l.nombre) = norm_txt(v.nombre));

-- ═══ 5. Normalizar variantes de grafía en clientes ═══
-- (el trigger resuelve el FK al cambiar el texto)
UPDATE clientes SET localidad = 'INGENIERO WHITE'
WHERE norm_txt(localidad) IN ('ing.white', 'ing. white', 'ingeniero white');
UPDATE clientes SET localidad = 'GONZALES CHAVES'
WHERE norm_txt(localidad) IN ('gonzalez chavez', 'gonzales chavez', 'gonzalez chaves', 'gonzales chaves');
UPDATE clientes SET localidad = 'INGENIERO HUERGO'
WHERE norm_txt(localidad) IN ('ing.huergo', 'ing. huergo');
UPDATE clientes SET localidad = 'PLOTTIER'
WHERE norm_txt(localidad) LIKE 'plottier%';
UPDATE clientes SET localidad = 'GENERAL SAN MARTIN'
WHERE norm_txt(localidad) IN ('gral. san martin', 'gral san martin');

-- ═══ 6. RE-BACKFILL con matching sin acentos ═══

-- Articulos (resuelve PERFUMERIA→Perfumería y cualquier otro caso por tilde)
UPDATE articulos a SET rubro_id = r.id
FROM rubros r
WHERE a.rubro_id IS NULL AND norm_txt(a.rubro) <> '' AND norm_txt(a.rubro) = norm_txt(r.nombre);

UPDATE articulos a SET categoria_id = c.id
FROM categorias c
WHERE a.categoria_id IS NULL AND norm_txt(a.categoria) <> ''
  AND norm_txt(a.categoria) = norm_txt(c.nombre)
  AND (a.rubro_id = c.rubro_id
       OR (a.rubro_id IS NULL AND (SELECT count(*) FROM categorias c2 WHERE norm_txt(c2.nombre) = norm_txt(a.categoria)) = 1));

UPDATE articulos a SET subcategoria_id = s.id
FROM subcategorias s
WHERE a.subcategoria_id IS NULL AND norm_txt(a.subcategoria) <> ''
  AND norm_txt(a.subcategoria) = norm_txt(s.nombre)
  AND (a.categoria_id = s.categoria_id
       OR (a.categoria_id IS NULL AND (SELECT count(*) FROM subcategorias s2 WHERE norm_txt(s2.nombre) = norm_txt(a.subcategoria)) = 1));

-- Canonicalizar texto de artículos cuyo FK quedó resuelto
UPDATE articulos a SET rubro = r.nombre FROM rubros r
WHERE a.rubro_id = r.id AND a.rubro IS DISTINCT FROM r.nombre;
UPDATE articulos a SET categoria = c.nombre FROM categorias c
WHERE a.categoria_id = c.id AND a.categoria IS DISTINCT FROM c.nombre;
UPDATE articulos a SET subcategoria = s.nombre FROM subcategorias s
WHERE a.subcategoria_id = s.id AND a.subcategoria IS DISTINCT FROM s.nombre;

-- Clientes sin FK: resolver contra el catálogo ya curado (BAHIA BLANCA, etc.)
UPDATE clientes c
SET localidad_id = l.id,
    localidad = l.nombre,
    provincia = CASE WHEN COALESCE(trim(l.provincia), '') <> '' THEN l.provincia ELSE c.provincia END
FROM localidades l
WHERE c.localidad_id IS NULL AND norm_txt(c.localidad) <> ''
  AND norm_txt(c.localidad) = norm_txt(l.nombre);

-- Clientes con FK: canonicalizar texto/provincia tras los renombres del catálogo
UPDATE clientes c
SET localidad = l.nombre,
    provincia = CASE WHEN COALESCE(trim(l.provincia), '') <> '' THEN l.provincia ELSE c.provincia END
FROM localidades l
WHERE c.localidad_id = l.id
  AND (c.localidad IS DISTINCT FROM l.nombre
       OR (COALESCE(trim(l.provincia), '') <> '' AND c.provincia IS DISTINCT FROM l.provincia));

-- ═══ 7. CONTROL FINAL ═══
SELECT 'articulos' AS tabla,
  count(*) FILTER (WHERE categoria_id IS NULL AND COALESCE(trim(categoria), '') <> '') AS categorias_sin_fk,
  count(*) FILTER (WHERE subcategoria_id IS NULL AND COALESCE(trim(subcategoria), '') <> '') AS subcategorias_sin_fk,
  count(*) FILTER (WHERE rubro_id IS NULL AND COALESCE(trim(rubro), '') <> '') AS rubros_sin_fk
FROM articulos WHERE activo
UNION ALL
SELECT 'clientes',
  count(*) FILTER (WHERE localidad_id IS NULL AND COALESCE(trim(localidad), '') <> ''), NULL, NULL
FROM clientes WHERE activo;
