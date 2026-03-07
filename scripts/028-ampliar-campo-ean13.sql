-- Script 028: Ampliar campo ean13 en tabla articulos para soportar cualquier tipo de código
-- Fecha: 2025-01-26
-- Descripción: Cambia el campo ean13 de varchar(13) a varchar(100) para soportar:
--              - EAN8 (8 dígitos)
--              - EAN13 (13 dígitos)
--              - SKUs alfanuméricos (ej: FB13009)
--              - Códigos internos de cualquier formato
--              - Permite campos vacíos/NULL

-- Ampliar el campo ean13 a 100 caracteres
ALTER TABLE articulos 
ALTER COLUMN ean13 TYPE VARCHAR(100);

-- Verificar el cambio
SELECT column_name, data_type, character_maximum_length
FROM information_schema.columns
WHERE table_name = 'articulos' AND column_name = 'ean13';

-- Comentario explicativo
COMMENT ON COLUMN articulos.ean13 IS 'Código de barras o SKU del artículo. Soporta EAN8, EAN13, códigos alfanuméricos y cualquier formato interno. Puede estar vacío.';
