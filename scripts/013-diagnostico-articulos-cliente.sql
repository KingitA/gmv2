-- Script de diagnóstico para verificar por qué no aparecen artículos

-- 1. Verificar artículos activos
SELECT 
  COUNT(*) as total_articulos_activos,
  COUNT(CASE WHEN stock_actual > 0 THEN 1 END) as con_stock,
  COUNT(CASE WHEN proveedor_id IS NOT NULL THEN 1 END) as con_proveedor
FROM articulos 
WHERE activo = true;

-- 2. Ver algunos artículos activos
SELECT 
  id,
  sku,
  descripcion,
  precio_compra, -- Corregido de precio_costo a precio_compra
  stock_actual,
  proveedor_id,
  activo
FROM articulos 
WHERE activo = true
LIMIT 5;

-- 3. Verificar el cliente CARDOZO JORGE
SELECT 
  id,
  nombre,
  localidad_id, -- Corregido de zona_id a localidad_id
  puntaje,
  retira_en_deposito, -- Corregido de retira_deposito a retira_en_deposito
  condicion_pago, -- Corregido de condicion_venta a condicion_pago
  vendedor_id,
  activo
FROM clientes 
WHERE nombre ILIKE '%CARDOZO%JORGE%';

-- 4. Verificar si el cliente tiene zona asignada
SELECT 
  c.nombre as cliente,
  cz.zona_id, -- Usando tabla intermedia clientes_zonas
  z.nombre as zona_nombre,
  z.porcentaje_flete -- Corregido de flete_porcentaje a porcentaje_flete
FROM clientes c
LEFT JOIN clientes_zonas cz ON c.id = cz.cliente_id -- Agregado JOIN con tabla intermedia
LEFT JOIN zonas z ON cz.zona_id = z.id
WHERE c.nombre ILIKE '%CARDOZO%JORGE%';

-- 5. Ver proveedores disponibles
SELECT id, nombre, tipo_descuento, margen_ganancia -- Corregido de descuento_valor a margen_ganancia
FROM proveedores
WHERE activo = true
LIMIT 5;
