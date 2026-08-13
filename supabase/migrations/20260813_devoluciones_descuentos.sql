-- ─────────────────────────────────────────────────────────────────────────────
-- Descuento de devoluciones en cobros del vendedor (13/08/2026)
--
-- El vendedor puede descontar una devolución pendiente (sin NC aún) del cobro
-- en la calle, incluso PARCIAL (el resto queda para otro cobro). Contablemente
-- no toca la cuenta corriente: el cobro imputa menos y el saldo restante del
-- comprobante lo cancela la NC/REV cuando la oficina la emite. Esta tabla
-- registra el vínculo devolución→pago para:
--   · impedir descontar dos veces más de lo devuelto (tope por suma),
--   · mostrar en la app cuánto de cada devolución ya se usó,
--   · limpiar los descuentos si el pago se anula (lo hace anularCobranza).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS devoluciones_descuentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  devolucion_id uuid NOT NULL REFERENCES devoluciones(id) ON DELETE CASCADE,
  pago_id uuid NOT NULL REFERENCES pagos_clientes(id) ON DELETE CASCADE,
  monto numeric(12,2) NOT NULL CHECK (monto > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (devolucion_id, pago_id)
);

CREATE INDEX IF NOT EXISTS idx_devdesc_devolucion ON devoluciones_descuentos (devolucion_id);
CREATE INDEX IF NOT EXISTS idx_devdesc_pago ON devoluciones_descuentos (pago_id);
