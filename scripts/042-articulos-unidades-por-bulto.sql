-- Migration 042: Ensure articulos.unidades_por_bulto exists
-- This is used as fallback when unidad_factura != UNIDAD

ALTER TABLE articulos
ADD COLUMN IF NOT EXISTS unidades_por_bulto INTEGER;

COMMENT ON COLUMN articulos.unidades_por_bulto IS
'Cantidad de unidades por bulto/caja estándar del artículo. 
Se usa como fallback cuando proveedor factura en BULTO/CAJA/PACK/DOCENA 
y no hay factor_conversion específico en articulos_proveedores.';

-- Index for quick lookups during OCR processing
CREATE INDEX IF NOT EXISTS idx_articulos_unidades_bulto 
ON articulos(unidades_por_bulto) 
WHERE unidades_por_bulto IS NOT NULL;
