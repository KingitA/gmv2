-- Migration 043: Add granular conversion config to articulos_proveedores
-- This provides maximum priority override for specific articulo-proveedor combinations

ALTER TABLE articulos_proveedores
ADD COLUMN IF NOT EXISTS unidad_factura VARCHAR(20)
CHECK (unidad_factura IN ('UNIDAD','BULTO','CAJA','PACK','DOCENA'));

ALTER TABLE articulos_proveedores
ADD COLUMN IF NOT EXISTS factor_conversion NUMERIC(18,6);

COMMENT ON COLUMN articulos_proveedores.unidad_factura IS
'Override de unidad en la que el proveedor factura este artículo específico.
Tiene prioridad sobre proveedores.default_unidad_factura.
Si se completa, se usa junto con factor_conversion o articulos.unidades_por_bulto.';

COMMENT ON COLUMN articulos_proveedores.factor_conversion IS
'Override del multiplicador para convertir cantidad facturada a UNIDAD base.
Ejemplos: BULTO x240 => 240, CAJA x24 => 24, DOCENA => 12.
Si se completa, tiene MÁXIMA PRIORIDAD sobre todo lo demás.';

-- Validation: if factor_conversion is set, it must be positive
ALTER TABLE articulos_proveedores
ADD CONSTRAINT chk_factor_conversion_positive 
CHECK (factor_conversion IS NULL OR factor_conversion > 0);

-- Index for OCR processing performance
CREATE INDEX IF NOT EXISTS idx_art_prov_conversion 
ON articulos_proveedores(proveedor_id, articulo_id, factor_conversion) 
WHERE factor_conversion IS NOT NULL;
