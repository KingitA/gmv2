-- Migration 050: Fix missing columns for price updates and reception persistence
-- Author: Antigravity
-- Date: 2025-12-18

-- 1. Add missing columns to articles for price history/tracking
ALTER TABLE articulos ADD COLUMN IF NOT EXISTS ultimo_costo NUMERIC(20, 6) DEFAULT 0;
ALTER TABLE articulos ADD COLUMN IF NOT EXISTS fecha_actualizacion TIMESTAMP WITH TIME ZONE;

-- 2. Add proveedor_id to recepciones to support OC-less receptions and persistent linking
ALTER TABLE recepciones ADD COLUMN IF NOT EXISTS proveedor_id UUID REFERENCES proveedores(id) ON DELETE SET NULL;

-- 3. Correct any existing recepciones by copying proveedor_id from their OCs
UPDATE recepciones r
SET proveedor_id = oc.proveedor_id
FROM ordenes_compra oc
WHERE r.orden_compra_id = oc.id
AND r.proveedor_id IS NULL;

-- 4. Add comments for documentation
COMMENT ON COLUMN articulos.ultimo_costo IS 'Precio de la última compra registrada';
COMMENT ON COLUMN articulos.fecha_actualizacion IS 'Fecha del último cambio de precio de compra';
COMMENT ON COLUMN recepciones.proveedor_id IS 'ID del proveedor para esta recepción (persistente incluso sin OC)';
