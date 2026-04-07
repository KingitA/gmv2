-- Permite que un pedido tenga una lista de precio distinta a la del cliente
ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS lista_precio_pedido_id uuid REFERENCES listas_precio(id) ON DELETE SET NULL;
