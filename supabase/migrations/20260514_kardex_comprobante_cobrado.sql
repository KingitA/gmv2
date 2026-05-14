-- Agrega tracking de cobro del cliente al kardex
-- (se asumía que ya existía, pero no estaba en el schema original)
ALTER TABLE kardex
  ADD COLUMN IF NOT EXISTS comprobante_cobrado       BOOLEAN     DEFAULT false,
  ADD COLUMN IF NOT EXISTS fecha_comprobante_cobrado TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_kardex_cobrado
  ON kardex(comprobante_venta_id)
  WHERE comprobante_cobrado = true;
