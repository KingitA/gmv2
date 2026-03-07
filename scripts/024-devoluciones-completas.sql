-- Script 024: Completar estructura de devoluciones para integración con app de choferes

-- 1. Agregar campos faltantes en devoluciones
ALTER TABLE devoluciones
ADD COLUMN IF NOT EXISTS numero_devolucion VARCHAR(50) UNIQUE,
ADD COLUMN IF NOT EXISTS viaje_id UUID REFERENCES viajes(id);

-- 2. Agregar campos faltantes en devoluciones_detalle
ALTER TABLE devoluciones_detalle
ADD COLUMN IF NOT EXISTS motivo TEXT,
ADD COLUMN IF NOT EXISTS es_vendible BOOLEAN DEFAULT true;

-- 3. Crear índices para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_devoluciones_vendedor ON devoluciones(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_devoluciones_estado ON devoluciones(estado);
CREATE INDEX IF NOT EXISTS idx_devoluciones_numero ON devoluciones(numero_devolucion);
CREATE INDEX IF NOT EXISTS idx_devoluciones_viaje ON devoluciones(viaje_id);

-- 4. Comentarios en las columnas para documentación
COMMENT ON COLUMN devoluciones.numero_devolucion IS 'Número único de devolución, formato: DEV-00001. Generado automáticamente por la API';
COMMENT ON COLUMN devoluciones.viaje_id IS 'Viaje en el que se registró la devolución (opcional)';
COMMENT ON COLUMN devoluciones_detalle.motivo IS 'Motivo de la devolución del artículo (ej: No le gustó, Producto dañado, etc.)';
COMMENT ON COLUMN devoluciones_detalle.es_vendible IS 'Indica si el producto devuelto es vendible (true) o debe desecharse/no vendible (false)';
