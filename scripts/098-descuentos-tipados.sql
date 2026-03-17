-- =====================================================
-- Script 098: Descuentos tipados + Bonificación/Recargo
-- =====================================================

-- Tabla de descuentos por artículo (reemplaza descuento1-4)
CREATE TABLE IF NOT EXISTS articulos_descuentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  articulo_id UUID NOT NULL REFERENCES articulos(id) ON DELETE CASCADE,
  tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('comercial', 'financiero', 'promocional')),
  porcentaje DECIMAL(5,2) NOT NULL DEFAULT 0,
  orden INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_articulos_descuentos_articulo ON articulos_descuentos(articulo_id);
CREATE INDEX IF NOT EXISTS idx_articulos_descuentos_tipo ON articulos_descuentos(tipo);

-- Bonificación/Recargo en artículo (% positivo = recargo, negativo = bonificación)
ALTER TABLE articulos ADD COLUMN IF NOT EXISTS bonif_recargo DECIMAL(5,2) DEFAULT 0;

COMMENT ON TABLE articulos_descuentos IS 'Descuentos por artículo. Tipo: comercial, financiero, promocional. Pueden ser N por artículo.';
COMMENT ON COLUMN articulos.bonif_recargo IS 'Bonificación (negativo) o recargo (positivo) % ocasional sobre el precio.';

-- Migrar descuentos existentes (descuento1-4) a la nueva tabla
-- Solo migra los que tengan valor > 0
INSERT INTO articulos_descuentos (articulo_id, tipo, porcentaje, orden)
SELECT id, 'comercial', descuento1, 1 FROM articulos WHERE descuento1 IS NOT NULL AND descuento1 > 0;

INSERT INTO articulos_descuentos (articulo_id, tipo, porcentaje, orden)
SELECT id, 'comercial', descuento2, 2 FROM articulos WHERE descuento2 IS NOT NULL AND descuento2 > 0;

INSERT INTO articulos_descuentos (articulo_id, tipo, porcentaje, orden)
SELECT id, 'comercial', descuento3, 3 FROM articulos WHERE descuento3 IS NOT NULL AND descuento3 > 0;

INSERT INTO articulos_descuentos (articulo_id, tipo, porcentaje, orden)
SELECT id, 'comercial', descuento4, 4 FROM articulos WHERE descuento4 IS NOT NULL AND descuento4 > 0;
