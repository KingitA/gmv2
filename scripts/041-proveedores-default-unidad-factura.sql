-- Migration 041: Add default_unidad_factura to proveedores
-- This serves as the fallback when no articulo-proveedor override exists

ALTER TABLE proveedores
ADD COLUMN IF NOT EXISTS default_unidad_factura VARCHAR(20) DEFAULT 'UNIDAD'
CHECK (default_unidad_factura IN ('UNIDAD','BULTO','CAJA','PACK','DOCENA'));

COMMENT ON COLUMN proveedores.default_unidad_factura IS
'Unidad por defecto en la que el proveedor factura cantidades. 
Se usa como fallback si no hay override por articulo-proveedor.
UNIDAD = cantidad literal, BULTO/CAJA/PACK/DOCENA = requiere multiplicador.';

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_proveedores_default_unidad 
ON proveedores(default_unidad_factura) 
WHERE default_unidad_factura != 'UNIDAD';
