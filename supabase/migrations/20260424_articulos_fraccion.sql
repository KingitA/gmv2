-- Soporte de fracción/pack por artículo
-- tipo_fraccion: "pack", "blister", "docena", "caja", etc. (texto libre)
-- cantidad_fraccion: cuántas unidades contiene esa fracción

ALTER TABLE articulos ADD COLUMN IF NOT EXISTS tipo_fraccion TEXT;
ALTER TABLE articulos ADD COLUMN IF NOT EXISTS cantidad_fraccion INTEGER;
