-- Agregar columnas de precios y descuentos a la tabla de artículos
ALTER TABLE articulos
ADD COLUMN IF NOT EXISTS precio_compra DECIMAL(10, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS descuento1 DECIMAL(5, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS descuento2 DECIMAL(5, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS descuento3 DECIMAL(5, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS descuento4 DECIMAL(5, 2) DEFAULT 0;

-- Crear índice para búsquedas por proveedor
CREATE INDEX IF NOT EXISTS idx_articulos_proveedor ON articulos(proveedor_id);

-- Comentarios para documentación
COMMENT ON COLUMN articulos.precio_compra IS 'Precio de compra base del artículo';
COMMENT ON COLUMN articulos.descuento1 IS 'Primer descuento en porcentaje (0-100)';
COMMENT ON COLUMN articulos.descuento2 IS 'Segundo descuento en porcentaje (0-100)';
COMMENT ON COLUMN articulos.descuento3 IS 'Tercer descuento en porcentaje (0-100)';
COMMENT ON COLUMN articulos.descuento4 IS 'Cuarto descuento en porcentaje (0-100)';
