-- Script 030: Reestructurar estados de pedidos y agregar condición de entrega
-- Autor: Sistema ERP
-- Descripción: Agrega condicion_entrega a clientes y pedidos, reestructura estados

-- 1. Agregar campo condicion_entrega a tabla clientes
ALTER TABLE clientes 
ADD COLUMN IF NOT EXISTS condicion_entrega VARCHAR(50) DEFAULT 'entregamos_nosotros';

-- Migrar datos existentes: si retira_en_deposito = true, entonces retira_mostrador
UPDATE clientes 
SET condicion_entrega = CASE 
  WHEN retira_en_deposito = true THEN 'retira_mostrador'
  ELSE 'entregamos_nosotros'
END
WHERE condicion_entrega IS NULL OR condicion_entrega = 'entregamos_nosotros';

-- 2. Agregar campo condicion_entrega a tabla pedidos (para override por pedido)
ALTER TABLE pedidos 
ADD COLUMN IF NOT EXISTS condicion_entrega VARCHAR(50);

-- 3. Crear constraint para validar valores de condicion_entrega
ALTER TABLE clientes
DROP CONSTRAINT IF EXISTS clientes_condicion_entrega_check;

ALTER TABLE clientes
ADD CONSTRAINT clientes_condicion_entrega_check 
CHECK (condicion_entrega IN ('retira_mostrador', 'transporte', 'entregamos_nosotros'));

ALTER TABLE pedidos
DROP CONSTRAINT IF EXISTS pedidos_condicion_entrega_check;

ALTER TABLE pedidos
ADD CONSTRAINT pedidos_condicion_entrega_check 
CHECK (condicion_entrega IS NULL OR condicion_entrega IN ('retira_mostrador', 'transporte', 'entregamos_nosotros'));

-- Migrar estados ANTES de crear el constraint
-- 4. Migrar estados antiguos a nuevos estados primero
UPDATE pedidos SET estado = 'pendiente_facturacion' WHERE estado = 'listo';

-- Mantener estados que ya existen en el nuevo esquema
-- UPDATE pedidos SET estado = 'entregado' WHERE estado = 'entregado'; (no hace falta)
-- UPDATE pedidos SET estado = 'en_viaje' WHERE estado = 'en_viaje'; (no hace falta)
-- UPDATE pedidos SET estado = 'facturado' WHERE estado = 'facturado'; (no hace falta)

-- 5. Crear constraint para validar valores de estado DESPUÉS de migrar
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
  'rechazado'
));

-- 6. Comentarios para documentación
COMMENT ON COLUMN clientes.condicion_entrega IS 'Condición de entrega por defecto del cliente: retira_mostrador, transporte, entregamos_nosotros';
COMMENT ON COLUMN pedidos.condicion_entrega IS 'Condición de entrega específica para este pedido (override del cliente)';
COMMENT ON COLUMN pedidos.estado IS 'Estado del pedido: pendiente, en_preparacion, pendiente_facturacion, facturado, listo_para_retirar, listo_para_enviar, en_viaje, entregado, rechazado';

-- 7. Crear índices para mejorar rendimiento
CREATE INDEX IF NOT EXISTS idx_pedidos_estado ON pedidos(estado);
CREATE INDEX IF NOT EXISTS idx_pedidos_condicion_entrega ON pedidos(condicion_entrega);
CREATE INDEX IF NOT EXISTS idx_clientes_condicion_entrega ON clientes(condicion_entrega);
