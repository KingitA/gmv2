-- Sistema completo de comprobantes de venta
-- Fecha: 2024

-- 1. Agregar campos faltantes a comprobantes_venta
ALTER TABLE comprobantes_venta 
ADD COLUMN IF NOT EXISTS punto_venta VARCHAR(4) DEFAULT '0001',
ADD COLUMN IF NOT EXISTS cae VARCHAR(50),
ADD COLUMN IF NOT EXISTS vencimiento_cae DATE,
ADD COLUMN IF NOT EXISTS motivo_ajuste TEXT,
ADD COLUMN IF NOT EXISTS comprobante_relacionado_id UUID REFERENCES comprobantes_venta(id);

-- 2. Crear tabla de remitos vinculada a comprobantes
CREATE TABLE IF NOT EXISTS remitos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    comprobante_id UUID REFERENCES comprobantes_venta(id) ON DELETE CASCADE,
    numero_remito VARCHAR(20) UNIQUE NOT NULL,
    punto_venta VARCHAR(4) DEFAULT '0001',
    fecha DATE NOT NULL,
    cliente_id UUID REFERENCES clientes(id),
    pedido_id UUID REFERENCES pedidos(id),
    valor_declarado NUMERIC(12,2) DEFAULT 0,
    bultos INTEGER,
    transporte VARCHAR(255),
    observaciones TEXT,
    estado VARCHAR(50) DEFAULT 'activo',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 3. Crear tabla de remitos detalle
CREATE TABLE IF NOT EXISTS remitos_detalle (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    remito_id UUID REFERENCES remitos(id) ON DELETE CASCADE,
    articulo_id UUID REFERENCES articulos(id),
    descripcion TEXT,
    cantidad NUMERIC(10,2) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 4. Crear tabla de numeración de comprobantes
CREATE TABLE IF NOT EXISTS numeracion_comprobantes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo_comprobante VARCHAR(10) NOT NULL,
    punto_venta VARCHAR(4) NOT NULL,
    ultimo_numero INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(tipo_comprobante, punto_venta)
);

-- 5. Insertar numeración inicial para todos los tipos de comprobantes
INSERT INTO numeracion_comprobantes (tipo_comprobante, punto_venta, ultimo_numero) 
VALUES 
    ('FA', '0001', 0),
    ('FB', '0001', 0),
    ('FC', '0001', 0),
    ('NCA', '0001', 0),
    ('NCB', '0001', 0),
    ('NCC', '0001', 0),
    ('NDA', '0001', 0),
    ('NDB', '0001', 0),
    ('NDC', '0001', 0),
    ('REM', '0001', 0),
    ('PRES', '0001', 0),
    ('REV', '0001', 0)
ON CONFLICT (tipo_comprobante, punto_venta) DO NOTHING;

-- 6. Crear tabla de configuración de empresa
CREATE TABLE IF NOT EXISTS configuracion_empresa (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    razon_social VARCHAR(255) NOT NULL DEFAULT 'CIA DE HIGIENE TOTAL S.R.L',
    cuit VARCHAR(13) NOT NULL DEFAULT '30-71234567-8',
    direccion TEXT,
    telefono VARCHAR(50),
    email VARCHAR(255),
    condicion_iva VARCHAR(50) DEFAULT 'Responsable Inscripto',
    numero_iibb VARCHAR(50),
    inicio_actividades DATE,
    logo_url TEXT,
    punto_venta_default VARCHAR(4) DEFAULT '0001',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 7. Insertar datos iniciales de la empresa
INSERT INTO configuracion_empresa (
    razon_social, 
    cuit, 
    condicion_iva,
    punto_venta_default
) 
VALUES (
    'CIA DE HIGIENE TOTAL S.R.L',
    '30-71234567-8',
    'Responsable Inscripto',
    '0001'
)
ON CONFLICT DO NOTHING;

-- 8. Crear índices para mejorar performance
CREATE INDEX IF NOT EXISTS idx_comprobantes_venta_tipo ON comprobantes_venta(tipo_comprobante);
CREATE INDEX IF NOT EXISTS idx_comprobantes_venta_cliente ON comprobantes_venta(cliente_id);
CREATE INDEX IF NOT EXISTS idx_comprobantes_venta_pedido ON comprobantes_venta(pedido_id);
CREATE INDEX IF NOT EXISTS idx_comprobantes_venta_fecha ON comprobantes_venta(fecha);
CREATE INDEX IF NOT EXISTS idx_remitos_comprobante ON remitos(comprobante_id);
CREATE INDEX IF NOT EXISTS idx_remitos_cliente ON remitos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_remitos_pedido ON remitos(pedido_id);

-- 9. Agregar trigger para actualizar updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_remitos_updated_at BEFORE UPDATE ON remitos
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_numeracion_comprobantes_updated_at BEFORE UPDATE ON numeracion_comprobantes
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_configuracion_empresa_updated_at BEFORE UPDATE ON configuracion_empresa
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
