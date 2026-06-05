-- Agrega columna codigo_bulto a articulos
-- Nota: en PostgreSQL las columnas siempre se agregan al final físicamente.
-- El orden visual en Supabase no afecta el funcionamiento.

ALTER TABLE articulos ADD COLUMN IF NOT EXISTS codigo_bulto text;

COMMENT ON COLUMN articulos.codigo_bulto IS 'Código de barras del bulto/caja (distinto al EAN13 de la unidad)';
