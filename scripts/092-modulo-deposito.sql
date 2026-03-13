-- =====================================================
-- Script 092: Módulo Depósito — Picking y Preparación
-- =====================================================

-- Tabla de sesiones de picking (una por pedido, puede haber varios usuarios)
CREATE TABLE IF NOT EXISTS picking_sesiones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  estado VARCHAR(30) DEFAULT 'en_progreso' CHECK (estado IN ('en_progreso', 'pausado', 'finalizado')),
  fecha_inicio TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  fecha_fin TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(pedido_id) -- Un pedido = una sesión de picking
);

-- Tabla de items de picking (progreso por artículo)
CREATE TABLE IF NOT EXISTS picking_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sesion_id UUID NOT NULL REFERENCES picking_sesiones(id) ON DELETE CASCADE,
  pedido_detalle_id UUID NOT NULL REFERENCES pedidos_detalle(id) ON DELETE CASCADE,
  articulo_id UUID NOT NULL REFERENCES articulos(id) ON DELETE RESTRICT,
  cantidad_pedida DECIMAL(10,2) NOT NULL,
  cantidad_preparada DECIMAL(10,2) DEFAULT 0,
  estado VARCHAR(20) DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'preparado', 'faltante', 'parcial')),
  usuario_id UUID, -- quien escaneó este item
  usuario_nombre VARCHAR(255),
  fecha_escaneo TIMESTAMP WITH TIME ZONE,
  observaciones TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(sesion_id, pedido_detalle_id)
);

-- Tabla de ajustes de stock desde depósito
CREATE TABLE IF NOT EXISTS deposito_ajustes_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  articulo_id UUID NOT NULL REFERENCES articulos(id) ON DELETE RESTRICT,
  tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('entrada', 'salida', 'ajuste')),
  cantidad DECIMAL(10,2) NOT NULL,
  stock_anterior DECIMAL(10,2),
  stock_nuevo DECIMAL(10,2),
  motivo TEXT,
  usuario_id UUID,
  usuario_nombre VARCHAR(255),
  estado VARCHAR(20) DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'confirmado', 'rechazado')),
  confirmado_por VARCHAR(255),
  fecha_confirmacion TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_picking_sesiones_pedido ON picking_sesiones(pedido_id);
CREATE INDEX IF NOT EXISTS idx_picking_sesiones_estado ON picking_sesiones(estado);
CREATE INDEX IF NOT EXISTS idx_picking_items_sesion ON picking_items(sesion_id);
CREATE INDEX IF NOT EXISTS idx_picking_items_articulo ON picking_items(articulo_id);
CREATE INDEX IF NOT EXISTS idx_deposito_ajustes_articulo ON deposito_ajustes_stock(articulo_id);
CREATE INDEX IF NOT EXISTS idx_deposito_ajustes_estado ON deposito_ajustes_stock(estado);

-- Trigger updated_at
CREATE TRIGGER update_picking_sesiones_updated_at 
  BEFORE UPDATE ON picking_sesiones
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_picking_items_updated_at 
  BEFORE UPDATE ON picking_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Comentarios
COMMENT ON TABLE picking_sesiones IS 'Sesiones de preparación de pedidos en depósito. Un pedido = una sesión, múltiples usuarios pueden participar.';
COMMENT ON TABLE picking_items IS 'Estado de cada artículo dentro de una sesión de picking.';
COMMENT ON TABLE deposito_ajustes_stock IS 'Ajustes de stock iniciados desde la app depósito, requieren confirmación en ERP.';
