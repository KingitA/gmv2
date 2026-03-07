-- =====================================================
-- Phase 3: Extend importaciones_articulos for Gmail integration
-- Run this in Supabase SQL Editor
-- =====================================================

-- 1. Extend importaciones_articulos table
ALTER TABLE importaciones_articulos
  ADD COLUMN IF NOT EXISTS proveedor_id UUID REFERENCES proveedores(id),
  ADD COLUMN IF NOT EXISTS fecha_vigencia DATE,
  ADD COLUMN IF NOT EXISTS estado VARCHAR(50) DEFAULT 'aplicada',
  ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS gmail_email_id UUID;

COMMENT ON COLUMN importaciones_articulos.proveedor_id IS 'Proveedor asociado a la importación de precios';
COMMENT ON COLUMN importaciones_articulos.fecha_vigencia IS 'Fecha de vigencia de los nuevos precios';
COMMENT ON COLUMN importaciones_articulos.estado IS 'Estado: pendiente, aplicada, cancelada';
COMMENT ON COLUMN importaciones_articulos.source IS 'Fuente: manual, gmail';
COMMENT ON COLUMN importaciones_articulos.gmail_email_id IS 'Referencia al email de Gmail si fue importado automáticamente';

-- 2. Create index for efficient queries
CREATE INDEX IF NOT EXISTS idx_importaciones_proveedor ON importaciones_articulos(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_importaciones_estado ON importaciones_articulos(estado);
CREATE INDEX IF NOT EXISTS idx_importaciones_source ON importaciones_articulos(source);

-- 3. Update existing records to have 'aplicada' status and 'manual' source
UPDATE importaciones_articulos SET estado = 'aplicada' WHERE estado IS NULL;
UPDATE importaciones_articulos SET source = 'manual' WHERE source IS NULL;

-- 4. Allow 'factura_servicio' classification if needed (optional)
-- This extends the existing check constraint to allow the new classification
-- Uncomment if you want to add this classification type:
-- ALTER TABLE ai_emails DROP CONSTRAINT IF EXISTS ai_emails_classification_check;
-- ALTER TABLE ai_emails ADD CONSTRAINT ai_emails_classification_check 
--   CHECK (classification IN ('pedido', 'orden_compra', 'pago', 'cambio_precio', 'reclamo', 'consulta', 'spam', 'otro', 'factura_servicio'));
