-- Agregar columna bultos a la tabla pedidos
ALTER TABLE pedidos ADD COLUMN bultos integer DEFAULT 0;

-- Comentario de la columna
COMMENT ON COLUMN pedidos.bultos IS 'Cantidad de bultos del pedido (campo informativo editable)';
