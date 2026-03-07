-- Script para cargar datos de prueba completos
-- Asigna precios, márgenes y zona al cliente

-- 1. Asignar precios de compra a los artículos
UPDATE articulos SET precio_compra = 500.00 WHERE sku = '000001'; -- TRAPO DE PISO
UPDATE articulos SET precio_compra = 800.00 WHERE sku = '000002'; -- LAMPAZO
UPDATE articulos SET precio_compra = 1200.00 WHERE sku = '000003'; -- LUSTRAMUEBLES
UPDATE articulos SET precio_compra = 950.00 WHERE sku = '000004'; -- DESODORANTE
UPDATE articulos SET precio_compra = 350.00 WHERE sku = '000005'; -- BOLSA RESIDUO
UPDATE articulos SET precio_compra = 1500.00 WHERE sku = '000006'; -- Si existe
UPDATE articulos SET precio_compra = 2000.00 WHERE sku = '000007'; -- Si existe
UPDATE articulos SET precio_compra = 750.00 WHERE sku = '000008'; -- Si existe
UPDATE articulos SET precio_compra = 1100.00 WHERE sku = '000009'; -- Si existe

-- 2. Asignar margen de ganancia a los proveedores (30%)
UPDATE proveedores SET margen_ganancia = 30.00 WHERE nombre = 'Distribuidora Central';
UPDATE proveedores SET margen_ganancia = 30.00 WHERE nombre = 'Mayorista del Sur';
UPDATE proveedores SET margen_ganancia = 30.00 WHERE nombre = 'Proveedor Express';
UPDATE proveedores SET margen_ganancia = 30.00 WHERE nombre = 'YASH S.A.';

-- 3. Asignar zona al cliente CARDOZO JORGE
-- Primero obtenemos el ID de una zona existente
INSERT INTO clientes_zonas (cliente_id, zona_id)
SELECT 
  '417ebee8-c01c-45f0-bab6-820e358e4004'::uuid, -- CARDOZO JORGE
  id
FROM zonas
LIMIT 1
ON CONFLICT DO NOTHING;

-- Verificación final
SELECT 
  'Artículos con precio' as tipo,
  COUNT(*) as cantidad
FROM articulos 
WHERE activo = true AND precio_compra > 0

UNION ALL

SELECT 
  'Proveedores con margen' as tipo,
  COUNT(*) as cantidad
FROM proveedores 
WHERE activo = true AND margen_ganancia > 0

UNION ALL

SELECT 
  'Cliente con zona' as tipo,
  COUNT(*) as cantidad
FROM clientes_zonas
WHERE cliente_id = '417ebee8-c01c-45f0-bab6-820e358e4004';
