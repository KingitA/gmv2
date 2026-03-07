-- Cargar 100 unidades de stock a todos los productos para pruebas con CRM
-- Fecha: 2025-01-06

-- Eliminado stock_minimo porque no existe en la tabla articulos
UPDATE articulos
SET 
  stock_actual = 100,
  updated_at = NOW()
WHERE activo = true;

-- Verificar la actualización
SELECT 
  COUNT(*) as total_articulos_actualizados,
  SUM(stock_actual) as stock_total
FROM articulos
WHERE activo = true;
