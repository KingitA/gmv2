-- PDF metadata columns for comprobantes_venta
-- Enables immutable PDF storage, hash verification and audit snapshot

ALTER TABLE comprobantes_venta
  ADD COLUMN IF NOT EXISTS pdf_path              TEXT,
  ADD COLUMN IF NOT EXISTS pdf_hash              VARCHAR(64),
  ADD COLUMN IF NOT EXISTS fecha_generacion_pdf  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS estado_pdf            VARCHAR(20) DEFAULT 'pendiente',
  ADD COLUMN IF NOT EXISTS pdf_snapshot          JSONB;
