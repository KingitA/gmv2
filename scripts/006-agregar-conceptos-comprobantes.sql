-- Agregar columnas para guardar los conceptos de cada comprobante
ALTER TABLE comprobantes_compra
ADD COLUMN IF NOT EXISTS total_neto DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS total_iva DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS percepcion_iva_monto DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS percepcion_iibb_monto DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS retencion_ganancias_monto DECIMAL(10,2);

-- Comentarios
COMMENT ON COLUMN comprobantes_compra.total_neto IS 'Total neto sin impuestos (editable manualmente)';
COMMENT ON COLUMN comprobantes_compra.total_iva IS 'IVA 21% (editable manualmente)';
COMMENT ON COLUMN comprobantes_compra.percepcion_iva_monto IS 'Percepción de IVA en pesos (editable manualmente)';
COMMENT ON COLUMN comprobantes_compra.percepcion_iibb_monto IS 'Percepción de IIBB en pesos (editable manualmente)';
COMMENT ON COLUMN comprobantes_compra.retencion_ganancias_monto IS 'Retención de Ganancias en pesos (editable manualmente)';
