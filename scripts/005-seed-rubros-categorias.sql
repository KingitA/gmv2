-- Insertar rubros predefinidos
INSERT INTO articulos (sku, descripcion, rubro, unidad_medida, stock_actual, activo, unidades_por_bulto)
VALUES 
  ('999998', 'RUBRO: LIMPIEZA', 'limpieza', 'unidad', 0, false, 1),
  ('999997', 'RUBRO: PERFUMERIA', 'perfumeria', 'unidad', 0, false, 1),
  ('999996', 'RUBRO: BAZAR', 'bazar', 'unidad', 0, false, 1)
ON CONFLICT (sku) DO NOTHING;

COMMENT ON COLUMN articulos.rubro IS 'Valores: limpieza, perfumeria, bazar';
COMMENT ON COLUMN articulos.categoria IS 'Categoría del artículo dentro del rubro';
COMMENT ON COLUMN articulos.subcategoria IS 'Subcategoría específica del artículo';
