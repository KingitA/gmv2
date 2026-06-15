-- ─────────────────────────────────────────────────────────────────────────────
-- Feature 1 — Override de la condición de proveedor SÓLO para un pedido.
-- Espejo de cliente_proveedor_condicion materializado por pedido: precarga lo del
-- cliente y se puede ajustar al armar el pedido sin afectar la ficha del cliente.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pedido_proveedor_condicion (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id          uuid NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  proveedor_id       uuid NOT NULL REFERENCES proveedores(id),
  lista_precio_id    uuid REFERENCES listas_precio(id),
  metodo_facturacion varchar(50),
  dto_general_pct    numeric(5,2),
  dto_viajante_pct   numeric(5,2),
  dto_mercaderia_pct numeric(5,2),
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pedido_id, proveedor_id)
);

CREATE INDEX IF NOT EXISTS idx_pedido_proveedor_condicion_pedido
  ON pedido_proveedor_condicion (pedido_id);
