-- Agregar campo para verificación de CUIT en comprobantes
ALTER TABLE comprobantes_compra 
ADD COLUMN IF NOT EXISTS cuit_verificado BOOLEAN DEFAULT NULL;

COMMENT ON COLUMN comprobantes_compra.cuit_verificado IS 'Indica si el CUIT de la factura coincide con el CUIT del proveedor registrado';
