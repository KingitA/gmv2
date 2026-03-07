-- Sistema completo de precios con costos, márgenes y precios de venta
-- Ejecutar este script para agregar los campos necesarios al sistema

-- 1. Agregar campos a la tabla proveedores
ALTER TABLE proveedores
ADD COLUMN IF NOT EXISTS tipo_descuento VARCHAR(20) DEFAULT 'cascada' CHECK (tipo_descuento IN ('cascada', 'sobre_lista'));

COMMENT ON COLUMN proveedores.tipo_descuento IS 'Indica si los descuentos se aplican en cascada o sobre el precio de lista';

-- 2. Agregar campos a la tabla articulos
ALTER TABLE articulos
ADD COLUMN IF NOT EXISTS porcentaje_ganancia NUMERIC(5,2) DEFAULT 20.00,
ADD COLUMN IF NOT EXISTS iva_compras VARCHAR(20) DEFAULT 'factura' CHECK (iva_compras IN ('factura', 'adquisicion_stock', 'mixto')),
ADD COLUMN IF NOT EXISTS iva_ventas VARCHAR(20) DEFAULT 'factura' CHECK (iva_ventas IN ('factura', 'presupuesto'));

COMMENT ON COLUMN articulos.porcentaje_ganancia IS 'Porcentaje de ganancia deseado sobre el costo bruto';
COMMENT ON COLUMN articulos.iva_compras IS 'Tipo de IVA en compras: factura (21%), adquisicion_stock (21%), mixto (10.5%)';
COMMENT ON COLUMN articulos.iva_ventas IS 'Tipo de IVA en ventas: factura (discriminado) o presupuesto (incluido)';

-- 3. Agregar campo retira_en_deposito a la tabla clientes
ALTER TABLE clientes
ADD COLUMN IF NOT EXISTS retira_en_deposito BOOLEAN DEFAULT false;

COMMENT ON COLUMN clientes.retira_en_deposito IS 'Indica si el cliente retira en depósito (flete = 0%)';

-- 4. Crear tabla de configuración de gastos operativos
CREATE TABLE IF NOT EXISTS configuracion_precios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  porcentaje_gastos_operativos NUMERIC(5,2) DEFAULT 3.00,
  iva_compras_porcentaje NUMERIC(5,2) DEFAULT 21.00,
  iva_ventas_porcentaje NUMERIC(5,2) DEFAULT 21.00,
  iva_mixto_porcentaje NUMERIC(5,2) DEFAULT 10.50,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE configuracion_precios IS 'Configuración global del sistema de precios';

-- Insertar configuración por defecto
INSERT INTO configuracion_precios (porcentaje_gastos_operativos, iva_compras_porcentaje, iva_ventas_porcentaje, iva_mixto_porcentaje)
VALUES (3.00, 21.00, 21.00, 10.50)
ON CONFLICT (id) DO NOTHING;

-- 5. Crear tabla de precios calculados (caché)
CREATE TABLE IF NOT EXISTS precios_calculados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  articulo_id UUID REFERENCES articulos(id) ON DELETE CASCADE,
  cliente_id UUID REFERENCES clientes(id) ON DELETE CASCADE,
  
  -- Costos
  costo_bruto NUMERIC(12,2),
  costo_final NUMERIC(12,2),
  
  -- Precios
  precio_base NUMERIC(12,2),
  precio_venta_neto NUMERIC(12,2),
  precio_final NUMERIC(12,2),
  
  -- Componentes del precio
  ganancia_monto NUMERIC(12,2),
  gastos_operativos_monto NUMERIC(12,2),
  flete_compra_monto NUMERIC(12,2),
  flete_venta_monto NUMERIC(12,2),
  recargo_puntaje_monto NUMERIC(12,2),
  comision_vendedor_monto NUMERIC(12,2),
  impuestos_monto NUMERIC(12,2),
  
  -- Metadata
  fecha_calculo TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(articulo_id, cliente_id)
);

COMMENT ON TABLE precios_calculados IS 'Caché de precios calculados por artículo y cliente';

CREATE INDEX IF NOT EXISTS idx_precios_calculados_articulo ON precios_calculados(articulo_id);
CREATE INDEX IF NOT EXISTS idx_precios_calculados_cliente ON precios_calculados(cliente_id);
CREATE INDEX IF NOT EXISTS idx_precios_calculados_fecha ON precios_calculados(fecha_calculo);

-- 6. Crear función para limpiar caché de precios antiguos
CREATE OR REPLACE FUNCTION limpiar_cache_precios_antiguos()
RETURNS void AS $$
BEGIN
  DELETE FROM precios_calculados
  WHERE fecha_calculo < NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION limpiar_cache_precios_antiguos IS 'Elimina precios calculados con más de 24 horas';
