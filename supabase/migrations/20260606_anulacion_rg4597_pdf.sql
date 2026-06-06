-- Anulación: columna para marcar cuándo fue anulado un comprobante
ALTER TABLE comprobantes_venta
  ADD COLUMN IF NOT EXISTS anulado_en timestamptz;

-- RG 4597 - Libro IVA Digital: campos requeridos por la norma.
-- Todos en 0 para esta empresa en la operatoria actual.
ALTER TABLE comprobantes_venta
  ADD COLUMN IF NOT EXISTS importe_no_gravado       numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS percepcion_no_cat         numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS importe_exento            numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS percepcion_municipal      numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS impuestos_internos        numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS otros_tributos            numeric DEFAULT 0;

-- PDF: URL del comprobante generado y guardado en Supabase Storage
ALTER TABLE comprobantes_venta
  ADD COLUMN IF NOT EXISTS pdf_url text;

-- Índice para buscar rápido comprobantes anulados
CREATE INDEX IF NOT EXISTS idx_comprobantes_anulado_en
  ON comprobantes_venta (anulado_en)
  WHERE anulado_en IS NOT NULL;
