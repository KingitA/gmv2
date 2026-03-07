-- Tabla de proveedores
CREATE TABLE IF NOT EXISTS proveedores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  telefono VARCHAR(50),
  direccion TEXT,
  cuit VARCHAR(20),
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabla de artículos
CREATE TABLE IF NOT EXISTS articulos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku VARCHAR(6) UNIQUE NOT NULL,
  ean13 VARCHAR(13),
  descripcion TEXT NOT NULL,
  unidad_medida VARCHAR(20) DEFAULT 'unidad' CHECK (unidad_medida IN ('unidad', 'bulto')),
  stock_actual DECIMAL(10, 2) DEFAULT 0,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabla de historial de precios de compra
CREATE TABLE IF NOT EXISTS precios_compra_historial (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  articulo_id UUID REFERENCES articulos(id) ON DELETE CASCADE,
  proveedor_id UUID REFERENCES proveedores(id) ON DELETE CASCADE,
  precio_compra DECIMAL(10, 2) NOT NULL,
  descuento1 DECIMAL(5, 2) DEFAULT 0,
  descuento2 DECIMAL(5, 2) DEFAULT 0,
  descuento3 DECIMAL(5, 2) DEFAULT 0,
  descuento4 DECIMAL(5, 2) DEFAULT 0,
  fecha_desde TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  fecha_hasta TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabla de órdenes de compra
CREATE TABLE IF NOT EXISTS ordenes_compra (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_orden VARCHAR(50) UNIQUE NOT NULL,
  proveedor_id UUID REFERENCES proveedores(id) ON DELETE RESTRICT,
  fecha_orden TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  estado VARCHAR(50) DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'recibida_parcial', 'recibida_completa', 'cancelada')),
  observaciones TEXT,
  usuario_creador VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabla de detalle de órdenes de compra
CREATE TABLE IF NOT EXISTS ordenes_compra_detalle (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_compra_id UUID REFERENCES ordenes_compra(id) ON DELETE CASCADE,
  articulo_id UUID REFERENCES articulos(id) ON DELETE RESTRICT,
  cantidad_pedida DECIMAL(10, 2) NOT NULL,
  precio_unitario DECIMAL(10, 2) NOT NULL,
  descuento1 DECIMAL(5, 2) DEFAULT 0,
  descuento2 DECIMAL(5, 2) DEFAULT 0,
  descuento3 DECIMAL(5, 2) DEFAULT 0,
  descuento4 DECIMAL(5, 2) DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabla de comprobantes de compra
CREATE TABLE IF NOT EXISTS comprobantes_compra (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_compra_id UUID REFERENCES ordenes_compra(id) ON DELETE SET NULL,
  tipo_comprobante VARCHAR(20) NOT NULL CHECK (tipo_comprobante IN ('FA', 'FB', 'FC', 'NCA', 'NCB', 'NCC', 'NDA', 'NDB', 'NDC', 'Adquisicion', 'Reversa')),
  numero_comprobante VARCHAR(50) NOT NULL,
  fecha_comprobante DATE NOT NULL,
  proveedor_id UUID REFERENCES proveedores(id) ON DELETE RESTRICT,
  total_factura_declarado DECIMAL(10, 2) NOT NULL,
  total_calculado DECIMAL(10, 2) DEFAULT 0,
  descuento_fuera_factura DECIMAL(5, 2) DEFAULT 0,
  diferencia_centavos DECIMAL(10, 2) DEFAULT 0,
  foto_url TEXT,
  estado VARCHAR(50) DEFAULT 'pendiente_recepcion' CHECK (estado IN ('pendiente_recepcion', 'recibido', 'validado', 'cerrado')),
  fecha_validacion TIMESTAMP WITH TIME ZONE,
  usuario_validador VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabla de detalle de comprobantes de compra
CREATE TABLE IF NOT EXISTS comprobantes_compra_detalle (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comprobante_id UUID REFERENCES comprobantes_compra(id) ON DELETE CASCADE,
  articulo_id UUID REFERENCES articulos(id) ON DELETE RESTRICT,
  cantidad_facturada DECIMAL(10, 2) NOT NULL,
  cantidad_recibida DECIMAL(10, 2) DEFAULT 0,
  precio_unitario DECIMAL(10, 2) NOT NULL,
  descuento1 DECIMAL(5, 2) DEFAULT 0,
  descuento2 DECIMAL(5, 2) DEFAULT 0,
  descuento3 DECIMAL(5, 2) DEFAULT 0,
  descuento4 DECIMAL(5, 2) DEFAULT 0,
  iva_porcentaje DECIMAL(5, 2) NOT NULL,
  sector VARCHAR(50),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabla de movimientos de stock
CREATE TABLE IF NOT EXISTS movimientos_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  articulo_id UUID REFERENCES articulos(id) ON DELETE RESTRICT,
  comprobante_detalle_id UUID REFERENCES comprobantes_compra_detalle(id) ON DELETE SET NULL,
  tipo_movimiento VARCHAR(20) NOT NULL CHECK (tipo_movimiento IN ('entrada', 'salida', 'ajuste')),
  cantidad DECIMAL(10, 2) NOT NULL,
  precio_unitario DECIMAL(10, 2),
  fecha_movimiento TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  usuario VARCHAR(255),
  observaciones TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices para mejorar el rendimiento
CREATE INDEX IF NOT EXISTS idx_articulos_sku ON articulos(sku);
CREATE INDEX IF NOT EXISTS idx_articulos_ean13 ON articulos(ean13);
CREATE INDEX IF NOT EXISTS idx_ordenes_compra_proveedor ON ordenes_compra(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_comprobantes_compra_proveedor ON comprobantes_compra(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_stock_articulo ON movimientos_stock(articulo_id);
CREATE INDEX IF NOT EXISTS idx_precios_historial_articulo ON precios_compra_historial(articulo_id);

-- Función para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers para actualizar updated_at
CREATE TRIGGER update_proveedores_updated_at BEFORE UPDATE ON proveedores
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_articulos_updated_at BEFORE UPDATE ON articulos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_ordenes_compra_updated_at BEFORE UPDATE ON ordenes_compra
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_comprobantes_compra_updated_at BEFORE UPDATE ON comprobantes_compra
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_comprobantes_detalle_updated_at BEFORE UPDATE ON comprobantes_compra_detalle
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
