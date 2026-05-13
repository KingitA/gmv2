-- Agrega columnas de descuentos individuales y precio_lista al kardex.
-- Reemplaza progresivamente el uso de descuentos_json por columnas tipadas
-- que permiten filtros SQL directos en reportes (ej: "ventas con dto viajante").

ALTER TABLE kardex
  ADD COLUMN IF NOT EXISTS precio_lista               NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS descuento_mercaderia_pct   NUMERIC(8,4),
  ADD COLUMN IF NOT EXISTS descuento_mercaderia_monto NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS descuento_general_pct      NUMERIC(8,4),
  ADD COLUMN IF NOT EXISTS descuento_general_monto    NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS descuento_viajante_pct     NUMERIC(8,4),
  ADD COLUMN IF NOT EXISTS descuento_viajante_monto   NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS descuento_financiero_pct   NUMERIC(8,4),
  ADD COLUMN IF NOT EXISTS descuento_financiero_monto NUMERIC(14,4);
