-- Tablas relacionales para clasificación de artículos

CREATE TABLE IF NOT EXISTS rubros (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS categorias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rubro_id UUID REFERENCES rubros(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  UNIQUE(rubro_id, nombre)
);

CREATE TABLE IF NOT EXISTS subcategorias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria_id UUID REFERENCES categorias(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  UNIQUE(categoria_id, nombre)
);

-- Rubros base
INSERT INTO rubros (nombre, slug) VALUES
  ('Limpieza', 'limpieza'),
  ('Bazar', 'bazar'),
  ('Perfumería', 'perfumeria')
ON CONFLICT (slug) DO NOTHING;

-- Columnas FK en articulos (las columnas texto antiguas se mantienen durante la transición)
ALTER TABLE articulos ADD COLUMN IF NOT EXISTS rubro_id UUID REFERENCES rubros(id);
ALTER TABLE articulos ADD COLUMN IF NOT EXISTS categoria_id UUID REFERENCES categorias(id);
ALTER TABLE articulos ADD COLUMN IF NOT EXISTS subcategoria_id UUID REFERENCES subcategorias(id);

-- Backfill: mapear texto rubro existente → rubro_id
UPDATE articulos a
SET rubro_id = r.id
FROM rubros r
WHERE lower(trim(a.rubro)) = r.slug
  AND a.rubro IS NOT NULL
  AND a.rubro_id IS NULL;
