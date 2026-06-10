-- Agrega columna qr_url a comprobantes_venta
-- Guarda la URL completa codificada en el QR (https://www.afip.gob.ar/fe/qr/?p=...)
-- Permite verificar/depurar el QR sin tocar el PDF inmutable

ALTER TABLE comprobantes_venta
  ADD COLUMN IF NOT EXISTS qr_url TEXT;
