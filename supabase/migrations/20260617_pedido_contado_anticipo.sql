-- Anticipo con 10% contado sobre pedido SIN facturar.
-- El cliente paga el neto (90%) como anticipo (saldo a favor) y el pedido queda
-- marcado: al generar los comprobantes, el sistema emite la NC del 10% y la imputa
-- al pago anticipo, dejando saldo 0. (descuento_* existentes son de precio, no de pago.)
ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS pago_contado_10  boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS anticipo_pago_id uuid REFERENCES pagos_clientes(id) ON DELETE SET NULL;
