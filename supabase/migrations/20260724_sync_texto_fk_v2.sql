-- ─────────────────────────────────────────────────────────────────────────────
-- Sincronización texto ↔ FK en TODO el sistema (v2, 24/07/2026)
-- REEMPLAZA a 20260724_sync_categorias_fk.sql (si no la aplicaste, aplicá solo esta).
--
-- Auditoría completa DB + código:
--  · articulos.categoria/subcategoria/rubro (texto) vs *_id: las ALTAS las
--    cubría el trigger v1, pero las EDICIONES desde /articulos mandan solo el
--    texto y el FK viejo quedaba pegado (v1 solo rellenaba FKs null).
--  · clientes.localidad (texto) vs localidad_id: SIN ninguna red — 257/582
--    clientes activos con texto sin FK, 16 con texto distinto al FK y 38 con
--    provincia contradiciendo la de su localidad. Los caminos de escritura son
--    incoherentes: las APIs oficiales escriben solo FK, import-bulk y el PATCH
--    del vendedor escriben solo texto.
--  · Los "duplicados" de categorias/subcategorias son legítimos (mismo nombre
--    bajo distinto padre) → unicidad POR PADRE, y la resolución por nombre
--    desambigua por contexto (rubro para categoría, categoría para subcategoría).
--
-- Diseño v2 — triggers BIDIRECCIONALES con regla única:
--    1. Si cambió el FK → el texto se reescribe desde el catálogo (FK manda).
--    2. Si cambió el texto → se re-resuelve el FK desde el texto (aunque ya
--       tuviera uno). Sin match → FK null (no se auto-crean catálogos).
--    3. Si solo falta uno de los dos → se completa desde el otro.
-- Así da igual qué escriba cada pantalla: la fila queda siempre consistente.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ 1. Unicidad de catálogos (previene ambigüedades futuras) ═══
-- Verificado contra los datos actuales: ninguno de estos índices falla hoy.
CREATE UNIQUE INDEX IF NOT EXISTS uq_rubros_nombre ON rubros (lower(trim(nombre)));
CREATE UNIQUE INDEX IF NOT EXISTS uq_categorias_rubro_nombre ON categorias (rubro_id, lower(trim(nombre)));
CREATE UNIQUE INDEX IF NOT EXISTS uq_subcategorias_cat_nombre ON subcategorias (categoria_id, lower(trim(nombre)));
CREATE UNIQUE INDEX IF NOT EXISTS uq_marcas_descripcion ON marcas (lower(trim(descripcion)));
CREATE UNIQUE INDEX IF NOT EXISTS uq_localidades_nombre ON localidades (lower(trim(nombre)));
CREATE UNIQUE INDEX IF NOT EXISTS uq_transportes_nombre ON transportes (lower(trim(nombre)));
CREATE UNIQUE INDEX IF NOT EXISTS uq_zonas_nombre ON zonas (lower(trim(nombre)));
CREATE UNIQUE INDEX IF NOT EXISTS uq_tipos_canal_nombre ON tipos_canal (lower(trim(nombre)));
CREATE UNIQUE INDEX IF NOT EXISTS uq_condiciones_pago_nombre ON condiciones_pago (lower(trim(nombre)));
CREATE UNIQUE INDEX IF NOT EXISTS uq_condiciones_entrega_codigo ON condiciones_entrega (lower(trim(codigo)));

-- ═══ 2. ARTICULOS — trigger bidireccional taxonomía ═══
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
      SELECT id INTO NEW.rubro_id FROM rubros
      WHERE lower(trim(nombre)) = lower(trim(NEW.rubro));
    END IF;
  ELSIF NEW.rubro_id IS NOT NULL AND COALESCE(trim(NEW.rubro), '') = '' THEN
    SELECT nombre INTO NEW.rubro FROM rubros WHERE id = NEW.rubro_id;
  ELSIF NEW.rubro_id IS NULL AND COALESCE(trim(NEW.rubro), '') <> '' THEN
    SELECT id INTO NEW.rubro_id FROM rubros
    WHERE lower(trim(nombre)) = lower(trim(NEW.rubro));
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
      -- 1º intento: dentro del rubro; 2º: match global único
      NEW.categoria_id := NULL;
      IF NEW.rubro_id IS NOT NULL THEN
        SELECT id INTO NEW.categoria_id FROM categorias
        WHERE rubro_id = NEW.rubro_id AND lower(trim(nombre)) = lower(trim(NEW.categoria));
      END IF;
      IF NEW.categoria_id IS NULL THEN
        SELECT min(id::text)::uuid INTO NEW.categoria_id FROM categorias
        WHERE lower(trim(nombre)) = lower(trim(NEW.categoria))
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
        WHERE categoria_id = NEW.categoria_id AND lower(trim(nombre)) = lower(trim(NEW.subcategoria));
      END IF;
      IF NEW.subcategoria_id IS NULL THEN
        SELECT min(id::text)::uuid INTO NEW.subcategoria_id FROM subcategorias
        WHERE lower(trim(nombre)) = lower(trim(NEW.subcategoria))
        HAVING count(*) = 1;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_articulos_sync_taxonomia_fk ON articulos;
CREATE TRIGGER trg_articulos_sync_taxonomia_fk
BEFORE INSERT OR UPDATE OF categoria, subcategoria, rubro, categoria_id, subcategoria_id, rubro_id ON articulos
FOR EACH ROW
EXECUTE FUNCTION articulos_sync_taxonomia_fk();

-- ═══ 3. CLIENTES — trigger bidireccional localidad ═══
-- localidad_id manda sobre localidad/provincia (que se derivan del catálogo;
-- la zona NO es columna de clientes: se deriva por join localidades→zonas).
-- Si cambia el texto, se re-resuelve el FK por nombre.
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
      WHERE lower(trim(nombre)) = lower(trim(NEW.localidad));
    END IF;
  ELSIF NOT fk_cambio AND NEW.localidad_id IS NULL AND COALESCE(trim(NEW.localidad), '') <> '' THEN
    SELECT id INTO NEW.localidad_id FROM localidades
    WHERE lower(trim(nombre)) = lower(trim(NEW.localidad));
  END IF;

  -- Con FK resuelto: texto y provincia se canonicalizan desde el catálogo
  IF NEW.localidad_id IS NOT NULL THEN
    SELECT l.nombre, l.provincia
    INTO v_loc
    FROM localidades l
    WHERE l.id = NEW.localidad_id;
    IF FOUND THEN
      NEW.localidad := v_loc.nombre;
      IF COALESCE(trim(v_loc.provincia), '') <> '' THEN NEW.provincia := v_loc.provincia; END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clientes_sync_localidad_fk ON clientes;
CREATE TRIGGER trg_clientes_sync_localidad_fk
BEFORE INSERT OR UPDATE OF localidad, localidad_id ON clientes
FOR EACH ROW
EXECUTE FUNCTION clientes_sync_localidad_fk();

-- ═══ 4. BACKFILL ═══

-- 4a. Articulos: FKs faltantes desde el texto (con contexto), texto faltante desde FKs
UPDATE articulos a SET rubro_id = r.id
FROM rubros r
WHERE a.rubro_id IS NULL AND lower(trim(a.rubro)) = lower(trim(r.nombre));

UPDATE articulos a SET categoria_id = c.id
FROM categorias c
WHERE a.categoria_id IS NULL
  AND lower(trim(a.categoria)) = lower(trim(c.nombre))
  AND (a.rubro_id = c.rubro_id
       OR (a.rubro_id IS NULL AND (SELECT count(*) FROM categorias c2 WHERE lower(trim(c2.nombre)) = lower(trim(a.categoria))) = 1));

UPDATE articulos a SET subcategoria_id = s.id
FROM subcategorias s
WHERE a.subcategoria_id IS NULL
  AND lower(trim(a.subcategoria)) = lower(trim(s.nombre))
  AND (a.categoria_id = s.categoria_id
       OR (a.categoria_id IS NULL AND (SELECT count(*) FROM subcategorias s2 WHERE lower(trim(s2.nombre)) = lower(trim(a.subcategoria))) = 1));

UPDATE articulos a SET rubro = r.nombre FROM rubros r
WHERE a.rubro_id = r.id AND COALESCE(trim(a.rubro), '') = '';
UPDATE articulos a SET categoria = c.nombre FROM categorias c
WHERE a.categoria_id = c.id AND COALESCE(trim(a.categoria), '') = '';
UPDATE articulos a SET subcategoria = s.nombre FROM subcategorias s
WHERE a.subcategoria_id = s.id AND COALESCE(trim(a.subcategoria), '') = '';

-- 4b. Clientes con FK: canonicalizar texto + provincia desde el catálogo
--     (arregla los 16 con texto distinto y los 38 con provincia contradictoria)
UPDATE clientes c
SET localidad = l.nombre,
    provincia = CASE WHEN COALESCE(trim(l.provincia), '') <> '' THEN l.provincia ELSE c.provincia END
FROM localidades l
WHERE c.localidad_id = l.id
  AND (lower(trim(COALESCE(c.localidad, ''))) IS DISTINCT FROM lower(trim(l.nombre))
       OR (COALESCE(trim(l.provincia), '') <> '' AND lower(trim(COALESCE(c.provincia, ''))) IS DISTINCT FROM lower(trim(l.provincia))));

-- 4c. Clientes sin FK cuyo texto matchea el catálogo: resolver + canonicalizar
UPDATE clientes c
SET localidad_id = l.id,
    localidad = l.nombre,
    provincia = CASE WHEN COALESCE(trim(l.provincia), '') <> '' THEN l.provincia ELSE c.provincia END
FROM localidades l
WHERE c.localidad_id IS NULL
  AND lower(trim(COALESCE(c.localidad, ''))) = lower(trim(l.nombre));

-- ═══ 5. CONTROL — qué quedó sin resolver (curar a mano, no se auto-crea) ═══

-- 5a. Resumen
SELECT 'articulos' AS tabla,
  count(*) FILTER (WHERE categoria_id IS NULL AND COALESCE(trim(categoria), '') <> '') AS categorias_sin_fk,
  count(*) FILTER (WHERE subcategoria_id IS NULL AND COALESCE(trim(subcategoria), '') <> '') AS subcategorias_sin_fk,
  count(*) FILTER (WHERE rubro_id IS NULL AND COALESCE(trim(rubro), '') <> '') AS rubros_sin_fk
FROM articulos WHERE activo
UNION ALL
SELECT 'clientes',
  count(*) FILTER (WHERE localidad_id IS NULL AND COALESCE(trim(localidad), '') <> ''), NULL, NULL
FROM clientes WHERE activo;

-- 5b. Localidades de clientes que NO existen en el catálogo (cargarlas en
--     /tablas o corregir el typo en el cliente; al tocar la fila el trigger
--     resuelve solo)
SELECT trim(c.localidad) AS localidad_texto, count(*) AS clientes
FROM clientes c
WHERE c.activo AND c.localidad_id IS NULL AND COALESCE(trim(c.localidad), '') <> ''
GROUP BY 1 ORDER BY 2 DESC;

-- 5c. Categorías/subcategorías de artículos sin match (ídem: crear en el
--     catálogo o corregir el texto)
SELECT 'categoria' AS tipo, trim(a.categoria) AS texto, count(*) AS articulos
FROM articulos a
WHERE a.activo AND a.categoria_id IS NULL AND COALESCE(trim(a.categoria), '') <> ''
GROUP BY 1, 2
UNION ALL
SELECT 'subcategoria', trim(a.subcategoria), count(*)
FROM articulos a
WHERE a.activo AND a.subcategoria_id IS NULL AND COALESCE(trim(a.subcategoria), '') <> ''
GROUP BY 1, 2
ORDER BY 1, 3 DESC;
