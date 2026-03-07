-- Eliminar restricciones de clave foránea para permitir polimorfismo
ALTER TABLE imputaciones DROP CONSTRAINT IF EXISTS imputaciones_pago_id_fkey;
ALTER TABLE imputaciones DROP CONSTRAINT IF EXISTS imputaciones_comprobante_id_fkey;

-- Opcional: Agregar índices para mejorar búsquedas si no existen
CREATE INDEX IF NOT EXISTS idx_imputaciones_pago_id ON imputaciones(pago_id);
CREATE INDEX IF NOT EXISTS idx_imputaciones_comprobante_id ON imputaciones(comprobante_id);
