-- Cambiar ean13 de TEXT a TEXT[] para soportar múltiples códigos de barras por artículo

ALTER TABLE articulos
  ALTER COLUMN ean13 TYPE TEXT[]
  USING CASE
    WHEN ean13 IS NULL OR trim(ean13) = '' THEN NULL
    ELSE ARRAY[ean13]
  END;

-- Reemplazar índice simple por GIN (necesario para búsqueda en arrays)
DROP INDEX IF EXISTS idx_articulos_ean13;
CREATE INDEX idx_articulos_ean13 ON articulos USING GIN(ean13);
