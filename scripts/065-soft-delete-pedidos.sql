-- Script 065: Soft-delete para pedidos
-- Agrega 'eliminado' al constraint de estados y columna eliminado_at

-- 1. Agregar columna eliminado_at
ALTER TABLE pedidos
ADD COLUMN IF NOT EXISTS eliminado_at TIMESTAMPTZ DEFAULT NULL;

-- 2. Actualizar constraint de estados para incluir 'eliminado'
ALTER TABLE pedidos
DROP CONSTRAINT IF EXISTS pedidos_estado_check;

ALTER TABLE pedidos
ADD CONSTRAINT pedidos_estado_check
CHECK (estado IN (
  'pendiente',
  'en_preparacion',
  'pendiente_facturacion',
  'facturado',
  'listo_para_retirar',
  'listo_para_enviar',
  'en_viaje',
  'entregado',
  'rechazado',
  'eliminado'
));

-- 3. Índice para consultas de purga
CREATE INDEX IF NOT EXISTS idx_pedidos_eliminado_at ON pedidos(eliminado_at) WHERE eliminado_at IS NOT NULL;

-- 4. Comentarios
COMMENT ON COLUMN pedidos.eliminado_at IS 'Fecha de soft-delete. Tras 45 días se purga definitivamente.';
COMMENT ON COLUMN pedidos.estado IS 'Estado del pedido: pendiente, en_preparacion, pendiente_facturacion, facturado, listo_para_retirar, listo_para_enviar, en_viaje, entregado, rechazado, eliminado';
