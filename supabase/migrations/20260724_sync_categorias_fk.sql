-- ─────────────────────────────────────────────────────────────────────────────
-- Sincronización texto → FK de taxonomía en articulos (24/07/2026)
--
-- Problema: articulos tiene la taxonomía duplicada como texto legado
-- (categoria/subcategoria/rubro) y como FK (categoria_id/subcategoria_id/
-- rubro_id). El backfill de la migración 20260423 fue de una sola vez: los
-- artículos cargados después traen solo el texto y el FK queda null, por lo
-- que el catálogo del vendedor (que agrupa por FK) los muestra como "Otros"
-- y los conteos del árbol de catálogo no los cuentan.
--
-- Fix: (1) backfill de los FK faltantes resolviendo por nombre, y (2) trigger
-- que mantiene los FK sincronizados en cada INSERT/UPDATE. No se crean
-- columnas nuevas. Nombres ambiguos (duplicados en la tabla de destino) o
-- inexistentes quedan con FK null, igual que hoy.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Función de resolución + trigger
CREATE OR REPLACE FUNCTION articulos_sync_taxonomia_fk()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Rubro: resolver solo si falta el FK y hay texto
  IF NEW.rubro_id IS NULL AND COALESCE(trim(NEW.rubro), '') <> '' THEN
    SELECT r.id INTO NEW.rubro_id
    FROM rubros r
    WHERE lower(trim(r.nombre)) = lower(trim(NEW.rubro))
    GROUP BY r.id
    HAVING count(*) = 1
    LIMIT 1;
  END IF;

  IF NEW.categoria_id IS NULL AND COALESCE(trim(NEW.categoria), '') <> '' THEN
    -- Si el nombre existe una sola vez en categorias, usarlo; si está duplicado
    -- pero se puede desambiguar por rubro, usar esa.
    SELECT min(c.id::text)::uuid INTO NEW.categoria_id
    FROM categorias c
    WHERE lower(trim(c.nombre)) = lower(trim(NEW.categoria))
    HAVING count(*) = 1;

    IF NEW.categoria_id IS NULL AND NEW.rubro_id IS NOT NULL THEN
      SELECT min(c.id::text)::uuid INTO NEW.categoria_id
      FROM categorias c
      WHERE lower(trim(c.nombre)) = lower(trim(NEW.categoria))
        AND c.rubro_id = NEW.rubro_id
      HAVING count(*) = 1;
    END IF;
  END IF;

  IF NEW.subcategoria_id IS NULL AND COALESCE(trim(NEW.subcategoria), '') <> '' THEN
    SELECT min(s.id::text)::uuid INTO NEW.subcategoria_id
    FROM subcategorias s
    WHERE lower(trim(s.nombre)) = lower(trim(NEW.subcategoria))
    HAVING count(*) = 1;

    IF NEW.subcategoria_id IS NULL AND NEW.categoria_id IS NOT NULL THEN
      SELECT min(s.id::text)::uuid INTO NEW.subcategoria_id
      FROM subcategorias s
      WHERE lower(trim(s.nombre)) = lower(trim(NEW.subcategoria))
        AND s.categoria_id = NEW.categoria_id
      HAVING count(*) = 1;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_articulos_sync_taxonomia_fk ON articulos;
CREATE TRIGGER trg_articulos_sync_taxonomia_fk
BEFORE INSERT OR UPDATE OF categoria, subcategoria, rubro ON articulos
FOR EACH ROW
EXECUTE FUNCTION articulos_sync_taxonomia_fk();

-- 2. Backfill de los FK faltantes (dispara la misma lógica vía UPDATE no-op)
UPDATE articulos
SET categoria = categoria
WHERE (categoria_id IS NULL AND COALESCE(trim(categoria), '') <> '')
   OR (subcategoria_id IS NULL AND COALESCE(trim(subcategoria), '') <> '')
   OR (rubro_id IS NULL AND COALESCE(trim(rubro), '') <> '');

-- 3. Control: cuántos siguen sin resolver (nombres ambiguos o inexistentes)
SELECT
  count(*) FILTER (WHERE categoria_id IS NULL AND COALESCE(trim(categoria), '') <> '') AS categorias_sin_fk,
  count(*) FILTER (WHERE subcategoria_id IS NULL AND COALESCE(trim(subcategoria), '') <> '') AS subcategorias_sin_fk,
  count(*) FILTER (WHERE rubro_id IS NULL AND COALESCE(trim(rubro), '') <> '') AS rubros_sin_fk
FROM articulos
WHERE activo = true;
