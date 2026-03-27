-- ============================================================
-- Migración 104: precio_base almacenado + precio_base_contado
-- ============================================================
-- Desvincula el precio_base del cálculo automático desde precio_compra.
-- Ahora precio_base es un campo que se puede importar o editar manualmente.
-- precio_base_contado = precio_base * 0.90 (actualizado via trigger)
-- ============================================================

-- 1. Nuevos campos en articulos
ALTER TABLE articulos
  ADD COLUMN IF NOT EXISTS precio_base NUMERIC(20,6) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS precio_base_contado NUMERIC(20,6) DEFAULT NULL;

-- 2. Trigger: mantiene precio_base_contado sincronizado con precio_base
CREATE OR REPLACE FUNCTION sync_precio_base_contado()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.precio_base IS NOT NULL THEN
    NEW.precio_base_contado := ROUND(NEW.precio_base * 0.9, 6);
  ELSE
    NEW.precio_base_contado := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_precio_base_contado ON articulos;
CREATE TRIGGER trg_sync_precio_base_contado
  BEFORE INSERT OR UPDATE OF precio_base ON articulos
  FOR EACH ROW EXECUTE FUNCTION sync_precio_base_contado();

-- 3. Índices para búsquedas por rango de precio
CREATE INDEX IF NOT EXISTS idx_articulos_precio_base ON articulos (precio_base) WHERE precio_base IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_articulos_precio_base_contado ON articulos (precio_base_contado) WHERE precio_base_contado IS NOT NULL;

-- 4. Artículo bonificación (SKU 11115) — utilizado en NC/REV por pago contado
INSERT INTO articulos (
  sku,
  descripcion,
  iva_compras,
  iva_ventas,
  precio_compra,
  porcentaje_ganancia,
  activo,
  categoria
)
VALUES (
  '11115',
  'BONIFICACION',
  'factura',
  'factura',
  0,
  0,
  true,
  'SERVICIO'
)
ON CONFLICT (sku) DO UPDATE SET
  descripcion = EXCLUDED.descripcion,
  activo = true;

COMMENT ON COLUMN articulos.precio_base IS 'Precio base almacenado, importado desde Excel o ingresado manualmente. Si está seteado, se usa directamente en lugar de calcular desde precio_compra.';
COMMENT ON COLUMN articulos.precio_base_contado IS 'Precio base con 10% de descuento por pago contado. Se calcula automáticamente como precio_base * 0.9 via trigger.';
