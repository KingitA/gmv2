-- Marca en kardex si el pedido fue eliminado, para excluirlo de reportes
ALTER TABLE kardex
  ADD COLUMN IF NOT EXISTS pedido_eliminado BOOLEAN DEFAULT FALSE;

-- Backfill: todos los existentes quedan en FALSE
UPDATE kardex SET pedido_eliminado = FALSE WHERE pedido_eliminado IS NULL;

-- Backfill: marcar kardex de pedidos ya eliminados
UPDATE kardex k
SET pedido_eliminado = TRUE
FROM pedidos p
WHERE k.pedido_id = p.id
  AND p.estado = 'eliminado';

CREATE INDEX IF NOT EXISTS idx_kardex_pedido_eliminado
  ON kardex(pedido_eliminado) WHERE pedido_eliminado = TRUE;

SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE pedido_eliminado = TRUE) AS eliminados
FROM kardex;
