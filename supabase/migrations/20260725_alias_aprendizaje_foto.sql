-- ─────────────────────────────────────────────────────────────────────────────
-- Aprendizaje de búsqueda por foto vía articulos_alias (25/07/2026)
--
-- Cuando el vendedor confirma una sugerencia de la búsqueda por foto, la app
-- guarda la descripción detectada como alias del artículo (confianza='foto').
-- articulos_build_search_text YA indexa los alias — pero faltaban dos piezas:
--   1. articulos_alias.proveedor_id era NOT NULL (la tabla nació para listas
--      de proveedor); los alias de foto no tienen proveedor.
--   2. Insertar/borrar un alias NO refrescaba articulos.search_text (el
--      trigger vive en articulos, no en articulos_alias) → el alias quedaba
--      invisible para la búsqueda híbrida hasta la próxima edición del
--      artículo. Nuevo trigger que refresca el search_text del artículo padre.
-- Además: refresh masivo de search_text — los existentes se generaron ANTES
-- del saneo de marca_id/taxonomía, así que muchas marcas no estaban indexadas.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Alias sin proveedor (aliases de foto)
ALTER TABLE articulos_alias ALTER COLUMN proveedor_id DROP NOT NULL;

-- 2. Refrescar search_text del artículo al tocar sus alias
CREATE OR REPLACE FUNCTION articulos_alias_refresh_search()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  aid uuid;
BEGIN
  aid := COALESCE(NEW.articulo_id, OLD.articulo_id);
  UPDATE articulos a
  SET search_text = public.articulos_build_search_text(a)
  WHERE a.id = aid;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_articulos_alias_refresh ON articulos_alias;
CREATE TRIGGER trg_articulos_alias_refresh
AFTER INSERT OR UPDATE OR DELETE ON articulos_alias
FOR EACH ROW
EXECUTE FUNCTION articulos_alias_refresh_search();

-- 3. Refresh masivo: re-indexa marca/categoría ya saneadas y alias existentes
UPDATE articulos a SET search_text = public.articulos_build_search_text(a);

-- 4. Control: artículos activos SIN marca asignada (invisibles a búsquedas
--    por marca hasta que se les cargue marca_id en /articulos)
SELECT count(*) AS articulos_sin_marca
FROM articulos WHERE activo AND marca_id IS NULL;
