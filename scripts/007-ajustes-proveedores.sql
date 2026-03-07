-- Ajustar campos de proveedores según especificaciones de DJ GESTION

-- Eliminar campos duplicados y agregar nuevos
ALTER TABLE proveedores
DROP COLUMN IF EXISTS codigo_provincia,
DROP COLUMN IF EXISTS plazo_pago,
DROP COLUMN IF EXISTS categoria_iva,
ADD COLUMN IF NOT EXISTS provincia VARCHAR(100),
ADD COLUMN IF NOT EXISTS codigo_provincia_dj INTEGER,
ADD COLUMN IF NOT EXISTS condicion_pago_tipo VARCHAR(20) DEFAULT 'cuenta_corriente',
ADD COLUMN IF NOT EXISTS plazo_dias INTEGER DEFAULT 30,
ADD COLUMN IF NOT EXISTS plazo_desde VARCHAR(20) DEFAULT 'fecha_factura';

-- Comentarios para claridad
COMMENT ON COLUMN proveedores.provincia IS 'Nombre de la provincia (ej: Buenos Aires, Jujuy, Santa Cruz)';
COMMENT ON COLUMN proveedores.codigo_provincia_dj IS 'Código numérico de provincia para DJ GESTION (1-24)';
COMMENT ON COLUMN proveedores.condicion_pago_tipo IS 'Tipo: cuenta_corriente, contado, anticipado';
COMMENT ON COLUMN proveedores.plazo_dias IS 'Cantidad de días del plazo de pago';
COMMENT ON COLUMN proveedores.plazo_desde IS 'Desde: fecha_factura o fecha_recepcion';
COMMENT ON COLUMN proveedores.tipo_iva IS 'Código de tipo IVA para DJ GESTION (1-9)';
