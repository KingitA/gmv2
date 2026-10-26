-- =====================================================================
-- #22 (prueba integral de salida, regla de Juan 26/10): los bultos se cargan
-- en el ERP, por pedido, en cualquier momento antes de finalizar el viaje, y
-- pueden ser BULTOS o PALLETS. pedidos.bultos ya existía; esto suma los pallets.
-- No bloquea nada: un pedido sin bultos ni pallets se despacha igual.
-- ADITIVA e IDEMPOTENTE. El código tolera que todavía no esté aplicada.
-- =====================================================================
ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS pallets SMALLINT NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pedidos_pallets_check') THEN
    ALTER TABLE public.pedidos ADD CONSTRAINT pedidos_pallets_check CHECK (pallets >= 0);
  END IF;
END $$;
