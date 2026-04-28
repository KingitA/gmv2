ALTER TABLE articulos
  ADD COLUMN IF NOT EXISTS segmento_precio TEXT DEFAULT NULL
  CHECK (segmento_precio IN ('limpieza_bazar', 'perfumeria'));
