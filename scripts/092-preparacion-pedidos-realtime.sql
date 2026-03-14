-- =====================================================
-- Sistema de preparación de pedidos en tiempo real
-- Para app depósito + seguimiento desde ERP
-- =====================================================

-- Cambiar prioridad de INTEGER a VARCHAR para usar categorías
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS prioridad_nivel VARCHAR(20) DEFAULT 'normal';

-- Actualizar existentes
UPDATE pedidos SET prioridad_nivel = 'normal' WHERE prioridad_nivel IS NULL;

-- Tabla de preparación: quién prepara cada pedido y estado de cada artículo
CREATE TABLE IF NOT EXISTS preparacion_pedidos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  operario_id UUID REFERENCES usuarios(id),
  operario_nombre VARCHAR(255),
  estado VARCHAR(30) DEFAULT 'asignado', -- asignado, en_proceso, completado, pausado
  iniciado_at TIMESTAMP,
  completado_at TIMESTAMP,
  notas TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(pedido_id)
);

-- Detalle: estado de cada artículo en la preparación
CREATE TABLE IF NOT EXISTS preparacion_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  preparacion_id UUID NOT NULL REFERENCES preparacion_pedidos(id) ON DELETE CASCADE,
  pedido_detalle_id UUID NOT NULL REFERENCES pedidos_detalle(id) ON DELETE CASCADE,
  articulo_id UUID REFERENCES articulos(id),
  cantidad_solicitada INTEGER NOT NULL,
  cantidad_preparada INTEGER DEFAULT 0,
  estado VARCHAR(20) DEFAULT 'pendiente', -- pendiente, preparado, faltante, parcial
  escaneado_at TIMESTAMP,
  notas TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Índices para queries rápidos
CREATE INDEX IF NOT EXISTS idx_preparacion_pedido ON preparacion_pedidos(pedido_id);
CREATE INDEX IF NOT EXISTS idx_preparacion_operario ON preparacion_pedidos(operario_id);
CREATE INDEX IF NOT EXISTS idx_preparacion_estado ON preparacion_pedidos(estado);
CREATE INDEX IF NOT EXISTS idx_preparacion_items_prep ON preparacion_items(preparacion_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_prioridad_nivel ON pedidos(prioridad_nivel);

-- Habilitar Realtime en las tablas de preparación
ALTER PUBLICATION supabase_realtime ADD TABLE preparacion_pedidos;
ALTER PUBLICATION supabase_realtime ADD TABLE pedidos;
