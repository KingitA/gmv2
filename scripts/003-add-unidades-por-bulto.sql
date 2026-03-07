-- Agregar campo unidades_por_bulto a la tabla articulos
ALTER TABLE articulos 
ADD COLUMN IF NOT EXISTS unidades_por_bulto INTEGER DEFAULT 1;

-- Actualizar artículos existentes para que tengan al menos 1 unidad por bulto
UPDATE articulos 
SET unidades_por_bulto = 1 
WHERE unidades_por_bulto IS NULL OR unidades_por_bulto = 0;

-- Agregar campo tipo_cantidad a ordenes_compra_detalle
ALTER TABLE ordenes_compra_detalle
ADD COLUMN IF NOT EXISTS tipo_cantidad VARCHAR(10) DEFAULT 'bulto' CHECK (tipo_cantidad IN ('bulto', 'unidad'));

-- Agregar campo tipo_cantidad a comprobantes_compra_detalle
ALTER TABLE comprobantes_compra_detalle
ADD COLUMN IF NOT EXISTS tipo_cantidad VARCHAR(10) DEFAULT 'bulto' CHECK (tipo_cantidad IN ('bulto', 'unidad'));

-- Comentarios para documentación
COMMENT ON COLUMN articulos.unidades_por_bulto IS 'Cantidad de unidades que contiene cada bulto';
COMMENT ON COLUMN ordenes_compra_detalle.tipo_cantidad IS 'Indica si la cantidad pedida es por bulto o unidad';
COMMENT ON COLUMN comprobantes_compra_detalle.tipo_cantidad IS 'Indica si la cantidad recibida es por bulto o unidad';
