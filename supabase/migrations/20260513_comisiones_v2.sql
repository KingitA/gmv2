-- ============================================================
-- Comisiones v2: cálculo por artículo, segmentos nuevos, billetera
-- ============================================================

-- 1. Nuevas columnas de comisión por segmento en vendedores
ALTER TABLE vendedores
  ADD COLUMN IF NOT EXISTS comision_limpieza_bazar  DECIMAL(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comision_perfumeria_0    DECIMAL(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comision_perfumeria_plus DECIMAL(5,2) DEFAULT 0;

-- Poblar desde columnas existentes:
--   comision_bazar_limpieza → limpieza_bazar y perfumeria_0 (misma tasa actualmente)
--   comision_perfumeria     → perfumeria_plus
UPDATE vendedores SET
  comision_limpieza_bazar  = COALESCE(comision_bazar_limpieza, 0),
  comision_perfumeria_0    = COALESCE(comision_bazar_limpieza, 0),
  comision_perfumeria_plus = COALESCE(comision_perfumeria, 0);

-- 2. Nuevas columnas en comisiones para granularidad por artículo
ALTER TABLE comisiones
  ADD COLUMN IF NOT EXISTS tipo                 TEXT DEFAULT 'vendida'
    CHECK (tipo IN ('vendida', 'cobrada')),
  ADD COLUMN IF NOT EXISTS articulo_id          UUID REFERENCES articulos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS segmento             TEXT,
  ADD COLUMN IF NOT EXISTS cantidad             DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS precio_neto_unitario DECIMAL(12,4);

-- Los registros actuales quedan con tipo='vendida' (correcto, son los generados al crear pedido)

CREATE INDEX IF NOT EXISTS idx_comisiones_tipo     ON comisiones(tipo, viajante_id);
CREATE INDEX IF NOT EXISTS idx_comisiones_articulo ON comisiones(articulo_id);

-- 3. Tabla billetera de viajantes
CREATE TABLE IF NOT EXISTS billetera_movimientos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  viajante_id     UUID NOT NULL,
  tipo            TEXT NOT NULL CHECK (tipo IN ('cobro_cliente', 'retiro_comision', 'debito', 'credito')),
  medio           TEXT CHECK (medio IN ('efectivo', 'cheque', 'transferencia')),
  monto           DECIMAL(12,2) NOT NULL,
  concepto        TEXT,
  referencia_id   UUID,
  referencia_tipo TEXT,
  fecha           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  creado_por      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billetera_viajante ON billetera_movimientos(viajante_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_billetera_ref      ON billetera_movimientos(referencia_id);
