-- Agregar campos para guardar la descripción y código del proveedor en el detalle
ALTER TABLE comprobantes_compra_detalle
ADD COLUMN IF NOT EXISTS descripcion_proveedor TEXT,
ADD COLUMN IF NOT EXISTS codigo_proveedor VARCHAR(100);

-- Crear índice para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_detalle_codigo_proveedor 
ON comprobantes_compra_detalle(codigo_proveedor);

COMMENT ON COLUMN comprobantes_compra_detalle.descripcion_proveedor IS 'Descripción del artículo tal como aparece en la factura del proveedor';
COMMENT ON COLUMN comprobantes_compra_detalle.codigo_proveedor IS 'Código/SKU del artículo según el proveedor';
