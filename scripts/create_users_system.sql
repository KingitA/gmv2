-- Tabla de usuarios del sistema (vendedores y clientes que se registran desde el CRM)
CREATE TABLE IF NOT EXISTS usuarios_crm (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  nombre VARCHAR(255) NOT NULL,
  telefono VARCHAR(50),
  cuit VARCHAR(20),
  direccion TEXT,
  
  -- Rol del usuario
  rol VARCHAR(50) CHECK (rol IN ('pendiente', 'vendedor', 'cliente')) DEFAULT 'pendiente',
  
  -- Estado del usuario
  estado VARCHAR(50) CHECK (estado IN ('pendiente_aprobacion', 'activo', 'rechazado', 'suspendido')) DEFAULT 'pendiente_aprobacion',
  
  -- Relaciones con tablas existentes
  vendedor_id UUID REFERENCES vendedores(id) ON DELETE SET NULL,
  cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL,
  
  -- Información adicional
  motivo_rechazo TEXT,
  observaciones TEXT,
  
  -- Auditoría
  fecha_registro TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  fecha_aprobacion TIMESTAMP WITH TIME ZONE,
  usuario_aprobador VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices para mejorar performance
CREATE INDEX IF NOT EXISTS idx_usuarios_crm_email ON usuarios_crm(email);
CREATE INDEX IF NOT EXISTS idx_usuarios_crm_rol ON usuarios_crm(rol);
CREATE INDEX IF NOT EXISTS idx_usuarios_crm_estado ON usuarios_crm(estado);
CREATE INDEX IF NOT EXISTS idx_usuarios_crm_vendedor_id ON usuarios_crm(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_usuarios_crm_cliente_id ON usuarios_crm(cliente_id);

-- Trigger para actualizar updated_at
CREATE OR REPLACE FUNCTION update_usuarios_crm_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_usuarios_crm_updated_at
  BEFORE UPDATE ON usuarios_crm
  FOR EACH ROW
  EXECUTE FUNCTION update_usuarios_crm_updated_at();

-- Tabla de historial de cambios de estado
CREATE TABLE IF NOT EXISTS usuarios_crm_historial (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID REFERENCES usuarios_crm(id) ON DELETE CASCADE,
  estado_anterior VARCHAR(50),
  estado_nuevo VARCHAR(50),
  rol_anterior VARCHAR(50),
  rol_nuevo VARCHAR(50),
  motivo TEXT,
  usuario_modificador VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usuarios_crm_historial_usuario_id ON usuarios_crm_historial(usuario_id);

COMMENT ON TABLE usuarios_crm IS 'Usuarios que se registran desde el CRM (vendedores y clientes)';
COMMENT ON COLUMN usuarios_crm.rol IS 'Rol del usuario: pendiente (recién registrado), vendedor, o cliente';
COMMENT ON COLUMN usuarios_crm.estado IS 'Estado: pendiente_aprobacion, activo, rechazado, suspendido';
COMMENT ON COLUMN usuarios_crm.vendedor_id IS 'Referencia al vendedor si el rol es vendedor';
COMMENT ON COLUMN usuarios_crm.cliente_id IS 'Referencia al cliente si el rol es cliente';
