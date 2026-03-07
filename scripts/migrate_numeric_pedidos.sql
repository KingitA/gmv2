-- Migration: Convert prefixed order numbers to numeric-only
-- Handles duplicates by assigning new sequential numbers

-- Step 1: Use a CTE to assign new unique sequential numbers to ALL pedidos
-- ordered by fecha ASC (oldest first), so newest get highest numbers
WITH numbered AS (
  SELECT id, numero_pedido,
    ROW_NUMBER() OVER (ORDER BY fecha ASC, id ASC) as new_num
  FROM pedidos
)
UPDATE pedidos p
SET numero_pedido = LPAD(n.new_num::text, 6, '0')
FROM numbered n
WHERE p.id = n.id;

-- Verify results
-- SELECT id, numero_pedido, estado, fecha FROM pedidos ORDER BY numero_pedido::integer DESC;
