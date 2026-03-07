-- Increase price precision to 6 decimal places to prevent rounding issues in unit prices
ALTER TABLE articulos ALTER COLUMN precio_compra TYPE NUMERIC(20, 6);
ALTER TABLE ordenes_compra_detalle ALTER COLUMN precio_unitario TYPE NUMERIC(20, 6);
ALTER TABLE recepciones_items ALTER COLUMN precio_oc TYPE NUMERIC(20, 6);
ALTER TABLE recepciones_items ALTER COLUMN precio_documentado TYPE NUMERIC(20, 6);
ALTER TABLE comprobantes_compra_detalle ALTER COLUMN precio_unitario TYPE NUMERIC(20, 6);

-- Optional: Add comments to explain the precision
COMMENT ON COLUMN articulos.precio_compra IS 'Precio de compra base con alta precisión (6 decimales)';
COMMENT ON COLUMN recepciones_items.precio_oc IS 'Precio unitario OC con alta precisión (6 decimales)';
COMMENT ON COLUMN recepciones_items.precio_documentado IS 'Precio unitario Documento con alta precisión (6 decimales)';
