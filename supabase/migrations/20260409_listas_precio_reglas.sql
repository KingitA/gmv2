-- =====================================================
-- Tabla de reglas de precios por fórmula
-- Reemplaza la lógica hardcodeada de recargas porcentuales
-- por fórmulas configurables por segmento.
--
-- Cada fila define un "segmento" (grupo_precio × iva_compras × iva_ventas)
-- y almacena en JSONB las fórmulas para cada sublista.
--
-- Ejemplo de formulas:
-- {
--   "bahia_presupuesto": "Base/1.11",
--   "bahia_con_iva":     "Base*0.95",
--   "neco_presupuesto":  "bahia_presupuesto*1.12",
--   "neco_con_iva":      "(Base*1.12)*1.1",
--   "viajante":          "Base*1.20"
-- }
--
-- Variables disponibles en las fórmulas:
--   Base         = precio_base del artículo
--   BaseContado  = precio_base_contado del artículo
--   + cualquier código de sublista ya calculado (cascada)
-- =====================================================

CREATE TABLE IF NOT EXISTS listas_precio_reglas (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_precio VARCHAR(50)  NOT NULL,
  iva_compras  VARCHAR(20)  NOT NULL,
  iva_ventas   VARCHAR(20)  NOT NULL,
  formulas     JSONB        NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE(grupo_precio, iva_compras, iva_ventas),
  CONSTRAINT chk_lpr_grupo_precio CHECK (grupo_precio IN ('LIMPIEZA_BAZAR', 'PERFUMERIA')),
  CONSTRAINT chk_lpr_iva_compras  CHECK (iva_compras  IN ('factura', 'adquisicion_stock', 'mixto')),
  CONSTRAINT chk_lpr_iva_ventas   CHECK (iva_ventas   IN ('factura', 'presupuesto'))
);

-- Trigger para updated_at (usa CREATE OR REPLACE para que sea idempotente)
CREATE OR REPLACE FUNCTION update_lpr_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';

DROP TRIGGER IF EXISTS trg_listas_precio_reglas_updated_at ON listas_precio_reglas;
CREATE TRIGGER trg_listas_precio_reglas_updated_at
  BEFORE UPDATE ON listas_precio_reglas
  FOR EACH ROW EXECUTE FUNCTION update_lpr_updated_at();

-- Pre-poblar las 12 filas (2 grupos × 3 iva_compras × 2 iva_ventas) con fórmulas vacías.
-- ON CONFLICT DO NOTHING → idempotente, se puede re-ejecutar.
INSERT INTO listas_precio_reglas (grupo_precio, iva_compras, iva_ventas) VALUES
  ('LIMPIEZA_BAZAR', 'factura',           'factura'),
  ('LIMPIEZA_BAZAR', 'factura',           'presupuesto'),
  ('LIMPIEZA_BAZAR', 'adquisicion_stock', 'factura'),
  ('LIMPIEZA_BAZAR', 'adquisicion_stock', 'presupuesto'),
  ('LIMPIEZA_BAZAR', 'mixto',             'factura'),
  ('LIMPIEZA_BAZAR', 'mixto',             'presupuesto'),
  ('PERFUMERIA',     'factura',           'factura'),
  ('PERFUMERIA',     'factura',           'presupuesto'),
  ('PERFUMERIA',     'adquisicion_stock', 'factura'),
  ('PERFUMERIA',     'adquisicion_stock', 'presupuesto'),
  ('PERFUMERIA',     'mixto',             'factura'),
  ('PERFUMERIA',     'mixto',             'presupuesto')
ON CONFLICT (grupo_precio, iva_compras, iva_ventas) DO NOTHING;

-- Índice para lookups rápidos desde el calculador de precios
CREATE INDEX IF NOT EXISTS idx_listas_precio_reglas_lookup
  ON listas_precio_reglas (grupo_precio, iva_compras, iva_ventas);
