-- ─────────────────────────────────────────────────────────────────────────────
-- Feature 1 — Condiciones de precio por proveedor, a nivel cliente.
--
-- IMPORTANTE: se factura SIEMPRE a clientes. proveedor_id sólo identifica QUÉ
-- mercadería (articulos.proveedor_id) recibe estas condiciones para este cliente.
-- "Para el cliente X, la mercadería del proveedor Colgate va con esta lista /
--  método / descuentos". No modifica nada de la tabla proveedores.
--
-- Los 3 descuentos viven acá (no en bonificaciones.proveedor_id): toda la condición
-- de la mercadería de un proveedor queda en un solo lugar. No duplica bonificaciones,
-- que sigue siendo sólo descuentos por RUBRO a nivel cliente — acá el eje es distinto.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cliente_proveedor_condicion (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id         uuid NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  proveedor_id       uuid NOT NULL REFERENCES proveedores(id),
  lista_precio_id    uuid REFERENCES listas_precio(id),
  metodo_facturacion varchar(50),
  dto_general_pct    numeric(5,2),
  dto_viajante_pct   numeric(5,2),
  dto_mercaderia_pct numeric(5,2),
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cliente_id, proveedor_id)
);

CREATE INDEX IF NOT EXISTS idx_cliente_proveedor_condicion_cliente
  ON cliente_proveedor_condicion (cliente_id);
