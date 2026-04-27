-- Agrega precio_unitario_bruto al kardex:
-- Es el precio ANTES de descuentos de oferta (descuento_propio) y descuento del cliente.
-- Permite reconstruir la cascada de descuentos en reportes y vistas de kardex.
-- Si no hay descuentos de oferta, coincide con precioLista (post-recargo, pre-cliente).

ALTER TABLE kardex
  ADD COLUMN IF NOT EXISTS precio_unitario_bruto DECIMAL(10,4) DEFAULT NULL;
