-- Script 029: Ampliar campos en tabla articulos
-- Fecha: 2025-11-20
-- Descripción: Ampliar SKU, SIGLA, DESCRIPCION y EAN13 para permitir importaciones flexibles

-- Ampliar SKU, SIGLA, DESCRIPCION y EAN13 a 200 caracteres para máxima flexibilidad
ALTER TABLE articulos
ALTER COLUMN sku TYPE varchar(200);

ALTER TABLE articulos
ALTER COLUMN sigla TYPE varchar(200);

ALTER TABLE articulos
ALTER COLUMN descripcion TYPE varchar(500);

ALTER TABLE articulos
ALTER COLUMN ean13 TYPE varchar(200);

-- Verificar los cambios
SELECT 
  column_name,
  data_type,
  character_maximum_length
FROM information_schema.columns
WHERE table_name = 'articulos' 
  AND column_name IN ('sku', 'sigla', 'descripcion', 'ean13')
ORDER BY column_name;
