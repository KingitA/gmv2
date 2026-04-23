-- Agrega columna imagen_url a articulos
ALTER TABLE articulos ADD COLUMN IF NOT EXISTS imagen_url TEXT;
