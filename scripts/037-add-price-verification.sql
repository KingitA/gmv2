-- Script 037: Agregar Campos de Precio a Recepciones
-- Autor: Sistema ERP
-- Fecha: 2025-12-12
-- Propósito: Permitir triple verificación incluyendo precios (OC vs Documento vs Real)

-- Agregar columnas de precio a recepciones_items
ALTER TABLE recepciones_items
ADD COLUMN IF NOT EXISTS precio_oc DECIMAL(12, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS precio_documentado DECIMAL(12, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS precio_real DECIMAL(12, 2) DEFAULT 0;

COMMENT ON COLUMN recepciones_items.precio_oc IS 'Precio unitario según Orden de Compra (después de descuentos)';
COMMENT ON COLUMN recepciones_items.precio_documentado IS 'Precio unitario leído del documento (factura/remito) por OCR';
COMMENT ON COLUMN recepciones_items.precio_real IS 'Precio unitario real acordado (puede editarse manualmente si OCR falla)';
