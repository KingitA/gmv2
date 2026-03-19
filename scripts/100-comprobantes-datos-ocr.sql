-- Script 100: Agregar datos_ocr a comprobantes_compra
-- Guarda el detalle de artículos extraídos por OCR de cada comprobante
-- Formato: { items: [{ codigo, descripcion, cantidad, precio_unitario, ... }], total: X }

ALTER TABLE comprobantes_compra ADD COLUMN IF NOT EXISTS datos_ocr JSONB DEFAULT NULL;

COMMENT ON COLUMN comprobantes_compra.datos_ocr IS 'Resultado del OCR: artículos, cantidades y precios extraídos del PDF/imagen del comprobante';
