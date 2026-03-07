-- Modificar tabla imputaciones para soportar tanto compras como ventas
ALTER TABLE imputaciones 
ADD COLUMN IF NOT EXISTS tipo_comprobante VARCHAR(20) DEFAULT 'compra';

-- Agregar índice para tipo_comprobante
CREATE INDEX IF NOT EXISTS idx_imputaciones_tipo ON imputaciones(tipo_comprobante);

COMMENT ON COLUMN imputaciones.tipo_comprobante IS 'Tipo de comprobante: compra o venta';

-- La columna comprobante_id puede referirse tanto a comprobantes_compra como comprobantes_venta
-- dependiendo del valor de tipo_comprobante
