-- Agregar columnas de percepciones a proveedores
ALTER TABLE proveedores
ADD COLUMN IF NOT EXISTS percepcion_iva DECIMAL(5,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS percepcion_iibb DECIMAL(5,2) DEFAULT 0;

-- Comentarios para claridad
COMMENT ON COLUMN proveedores.retencion_ganancias IS 'Porcentaje de retención de ganancias (solo aplica a comprobantes con IVA)';
COMMENT ON COLUMN proveedores.percepcion_iva IS 'Porcentaje de percepción de IVA (solo aplica a comprobantes con IVA)';
COMMENT ON COLUMN proveedores.percepcion_iibb IS 'Porcentaje de percepción de Ingresos Brutos (solo aplica a comprobantes con IVA)';
