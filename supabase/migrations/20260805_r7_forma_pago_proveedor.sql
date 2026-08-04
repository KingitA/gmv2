-- ─────────────────────────────────────────────────────────────────────────────
-- R7 (mini) — Forma de pago habitual del proveedor
-- Al validar una factura, el vencimiento hereda esta forma de pago (antes
-- quedaba vacía y el panel la asumía transferencia). Editable desde la
-- Ficha Fiscal del proveedor.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.proveedores
  ADD COLUMN IF NOT EXISTS forma_pago_default varchar(15);

DO $$
BEGIN
  ALTER TABLE public.proveedores
    ADD CONSTRAINT proveedores_forma_pago_default_check
    CHECK (forma_pago_default IS NULL OR forma_pago_default IN ('efectivo', 'transferencia', 'cheque'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
