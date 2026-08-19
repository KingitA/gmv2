-- Bonificación viajante "solo este pedido" (app vendedor, panel 👤 del pedido).
-- NULL = heredar la bonificación viajante de la ficha del cliente (tabla
-- bonificaciones, tipo 'viajante'); número = % aplicado a TODOS los segmentos
-- de este pedido. Mismo patrón que pedidos.bonif_mercaderia_pct /
-- lista_precio_pedido_id / metodo_facturacion_pedido.
ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS bonif_viajante_pedido_pct numeric
  CHECK (bonif_viajante_pedido_pct IS NULL OR (bonif_viajante_pedido_pct >= 0 AND bonif_viajante_pedido_pct <= 100));

COMMENT ON COLUMN pedidos.bonif_viajante_pedido_pct IS
  'Override de bonificación viajante solo para este pedido (todos los segmentos). NULL = hereda de la ficha del cliente.';
