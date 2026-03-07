-- Script 032: Función RPC para actualizar stock reservado atómicamente
-- Autor: Sistema ERP
-- Fecha: 2024

-- Función para incrementar/decrementar stock reservado
CREATE OR REPLACE FUNCTION increment_stock_reservado(p_articulo_id UUID, p_cantidad DECIMAL)
RETURNS VOID AS $$
BEGIN
  UPDATE articulos
  SET stock_reservado = COALESCE(stock_reservado, 0) + p_cantidad
  WHERE id = p_articulo_id;
END;
$$ LANGUAGE plpgsql;

-- Función para incrementar/decrementar stock actual (por si acaso)
CREATE OR REPLACE FUNCTION increment_stock_actual(p_articulo_id UUID, p_cantidad DECIMAL)
RETURNS VOID AS $$
BEGIN
  UPDATE articulos
  SET stock_actual = COALESCE(stock_actual, 0) + p_cantidad
  WHERE id = p_articulo_id;
END;
$$ LANGUAGE plpgsql;
