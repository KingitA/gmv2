-- Descuentos de proveedor por ítem de recepción.
-- Se capturan al ingresar la recepción y se propagan al kardex al finalizar.
ALTER TABLE recepciones_items
  ADD COLUMN IF NOT EXISTS descuento_pct            NUMERIC(8,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS descuento_financiero_pct NUMERIC(8,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS descuento_comercial_pct  NUMERIC(8,4) DEFAULT 0;
