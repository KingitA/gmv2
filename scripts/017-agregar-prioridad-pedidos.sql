-- Agregar columna de prioridad a pedidos
ALTER TABLE pedidos 
ADD COLUMN IF NOT EXISTS prioridad INTEGER DEFAULT 0;

-- Asignar prioridades iniciales basadas en la fecha de creación
-- Los pedidos más antiguos tienen menor número (mayor prioridad)
WITH pedidos_numerados AS (
  SELECT 
    id,
    ROW_NUMBER() OVER (ORDER BY created_at ASC) as nueva_prioridad
  FROM pedidos
  WHERE estado IN ('pendiente', 'en_preparacion')
)
UPDATE pedidos p
SET prioridad = pn.nueva_prioridad
FROM pedidos_numerados pn
WHERE p.id = pn.id;

-- Los pedidos finalizados tienen prioridad 0 (no se ordenan)
UPDATE pedidos 
SET prioridad = 0 
WHERE estado NOT IN ('pendiente', 'en_preparacion');

-- Crear índice para mejorar performance
CREATE INDEX IF NOT EXISTS idx_pedidos_prioridad ON pedidos(prioridad) WHERE estado IN ('pendiente', 'en_preparacion');
