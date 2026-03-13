-- =====================================================
-- Ampliar tabla transportes con tarifas y notas
-- + tabla de destinos (transportes ↔ localidades)
-- =====================================================

-- Nuevas columnas en transportes
ALTER TABLE transportes ADD COLUMN IF NOT EXISTS precio_bulto DECIMAL(12,2) DEFAULT NULL;
ALTER TABLE transportes ADD COLUMN IF NOT EXISTS precio_pallet DECIMAL(12,2) DEFAULT NULL;
ALTER TABLE transportes ADD COLUMN IF NOT EXISTS porcentaje_seguro DECIMAL(5,2) DEFAULT NULL;
ALTER TABLE transportes ADD COLUMN IF NOT EXISTS notas TEXT DEFAULT NULL;

-- Tabla intermedia: destinos de cada transporte
CREATE TABLE IF NOT EXISTS transportes_destinos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transporte_id UUID NOT NULL REFERENCES transportes(id) ON DELETE CASCADE,
  localidad_id UUID NOT NULL REFERENCES localidades(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(transporte_id, localidad_id)
);

CREATE INDEX IF NOT EXISTS idx_transportes_destinos_transporte ON transportes_destinos(transporte_id);
CREATE INDEX IF NOT EXISTS idx_transportes_destinos_localidad ON transportes_destinos(localidad_id);
