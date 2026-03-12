-- =====================================================
-- Tablas de configuración para clientes
-- tipos_canal, condiciones_pago, condiciones_entrega
-- =====================================================

-- Tipos de Canal (Mayorista, Minorista, etc)
CREATE TABLE IF NOT EXISTS tipos_canal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre VARCHAR(100) NOT NULL UNIQUE,
  descripcion TEXT,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO tipos_canal (nombre) VALUES
  ('Mayorista'),
  ('Minorista'),
  ('Consumidor Final')
ON CONFLICT (nombre) DO NOTHING;

-- Condiciones de Pago
CREATE TABLE IF NOT EXISTS condiciones_pago (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre VARCHAR(100) NOT NULL UNIQUE,
  dias_plazo INTEGER DEFAULT 0,
  descripcion TEXT,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO condiciones_pago (nombre, dias_plazo) VALUES
  ('Efectivo', 0),
  ('Transferencia', 0),
  ('Cheque al día', 0),
  ('Cheque 30 días', 30),
  ('Cheque 30/60/90', 60)
ON CONFLICT (nombre) DO NOTHING;

-- Condiciones de Entrega
CREATE TABLE IF NOT EXISTS condiciones_entrega (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre VARCHAR(100) NOT NULL UNIQUE,
  codigo VARCHAR(50) NOT NULL UNIQUE,
  descripcion TEXT,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO condiciones_entrega (nombre, codigo) VALUES
  ('Retira en Mostrador', 'retira_mostrador'),
  ('Envío por Transporte', 'transporte'),
  ('Entregamos Nosotros', 'entregamos_nosotros')
ON CONFLICT (nombre) DO NOTHING;
