-- Agregar numero_pedido al kardex
ALTER TABLE kardex
  ADD COLUMN IF NOT EXISTS numero_pedido VARCHAR;

-- Backfill desde pedidos
UPDATE kardex k
SET numero_pedido = p.numero_pedido
FROM pedidos p
WHERE k.pedido_id = p.id
  AND k.pedido_id IS NOT NULL
  AND k.numero_pedido IS NULL;

-- Índice para búsqueda por número de pedido
CREATE INDEX IF NOT EXISTS idx_kardex_numero_pedido
  ON kardex(numero_pedido) WHERE numero_pedido IS NOT NULL;

SELECT
  COUNT(*) AS total_filas,
  COUNT(*) FILTER (WHERE numero_pedido IS NOT NULL) AS filas_con_numero_pedido
FROM kardex;
