-- Actualizar tabla proveedores con todos los campos necesarios
ALTER TABLE proveedores
ADD COLUMN IF NOT EXISTS sigla VARCHAR(10),
ADD COLUMN IF NOT EXISTS codigo_proveedor VARCHAR(50),
ADD COLUMN IF NOT EXISTS codigo_postal VARCHAR(10),
ADD COLUMN IF NOT EXISTS localidad VARCHAR(100),
ADD COLUMN IF NOT EXISTS codigo_provincia VARCHAR(10),
ADD COLUMN IF NOT EXISTS telefono_oficina VARCHAR(50),
ADD COLUMN IF NOT EXISTS telefono_vendedor VARCHAR(50),
ADD COLUMN IF NOT EXISTS mail_vendedor VARCHAR(255),
ADD COLUMN IF NOT EXISTS mail_oficina VARCHAR(255),
ADD COLUMN IF NOT EXISTS categoria_iva VARCHAR(50),
ADD COLUMN IF NOT EXISTS numero_cuit VARCHAR(20),
ADD COLUMN IF NOT EXISTS tipo_proveedor VARCHAR(50) DEFAULT 'mercaderia_general',
ADD COLUMN IF NOT EXISTS banco_nombre VARCHAR(100),
ADD COLUMN IF NOT EXISTS banco_cuenta VARCHAR(100),
ADD COLUMN IF NOT EXISTS banco_numero_cuenta VARCHAR(50),
ADD COLUMN IF NOT EXISTS banco_tipo_cuenta VARCHAR(50),
ADD COLUMN IF NOT EXISTS tipo_pago TEXT[], -- Array de tipos de pago
ADD COLUMN IF NOT EXISTS plazo_pago VARCHAR(50),
ADD COLUMN IF NOT EXISTS retencion_iibb DECIMAL(5,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS retencion_ganancias DECIMAL(5,2) DEFAULT 0;

-- Actualizar tabla articulos con campos de clasificación
ALTER TABLE articulos
ADD COLUMN IF NOT EXISTS proveedor_id UUID REFERENCES proveedores(id),
ADD COLUMN IF NOT EXISTS rubro VARCHAR(50),
ADD COLUMN IF NOT EXISTS categoria VARCHAR(100),
ADD COLUMN IF NOT EXISTS subcategoria VARCHAR(100);

-- Crear índices para mejorar búsquedas
CREATE INDEX IF NOT EXISTS idx_articulos_proveedor ON articulos(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_articulos_rubro ON articulos(rubro);
CREATE INDEX IF NOT EXISTS idx_articulos_categoria ON articulos(categoria);

-- Actualizar tabla ordenes_compra para número consecutivo
ALTER TABLE ordenes_compra
ADD COLUMN IF NOT EXISTS condicion_pago VARCHAR(100),
ADD COLUMN IF NOT EXISTS plazo_pago VARCHAR(50),
ADD COLUMN IF NOT EXISTS pdf_url TEXT;

-- Crear secuencia para números de OC si no existe
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_sequences WHERE schemaname = 'public' AND sequencename = 'ordenes_compra_numero_seq') THEN
    CREATE SEQUENCE ordenes_compra_numero_seq START 1;
  END IF;
END $$;

COMMENT ON TABLE proveedores IS 'Tabla de proveedores con información completa para órdenes de compra';
COMMENT ON TABLE articulos IS 'Tabla de artículos con clasificación por proveedor, rubro y categorías';
