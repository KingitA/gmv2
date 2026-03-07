-- DIAGNÓSTICO COMPLETO: MARIO SILVA

-- 1. Ver TODOS los vendedores con nombre MARIO SILVA
SELECT 
  'VENDEDORES CON NOMBRE MARIO SILVA' as tipo,
  id,
  nombre,
  email,
  activo
FROM vendedores
WHERE nombre ILIKE '%MARIO%SILVA%';

-- 2. Ver el vendedor específico que estás usando
SELECT 
  'VENDEDOR ID ESPECIFICO' as tipo,
  id,
  nombre,
  email,
  activo
FROM vendedores
WHERE id = 'e0e1ebd0-3bc3-4025-903d-54f1f2bf51ad';

-- 3. Ver cliente CARDOZO JORGE y qué vendedor tiene asignado
SELECT 
  'CLIENTE CARDOZO JORGE' as tipo,
  id as cliente_id,
  razon_social,
  vendedor_id,
  activo
FROM clientes
WHERE razon_social ILIKE '%CARDOZO%JORGE%';

-- 4. Ver TODOS los pedidos de CARDOZO JORGE (sin importar vendedor)
SELECT 
  'PEDIDOS DE CARDOZO JORGE' as tipo,
  p.id as pedido_id,
  p.numero_pedido,
  p.cliente_id,
  p.vendedor_id,
  p.estado,
  p.total,
  c.razon_social as cliente_nombre,
  v.nombre as vendedor_nombre
FROM pedidos p
LEFT JOIN clientes c ON p.cliente_id = c.id
LEFT JOIN vendedores v ON p.vendedor_id = v.id
WHERE c.razon_social ILIKE '%CARDOZO%JORGE%'
ORDER BY p.created_at DESC;

-- 5. Resumen: ver cuántos clientes tiene cada MARIO SILVA
SELECT 
  v.id as vendedor_id,
  v.nombre as vendedor_nombre,
  v.email,
  COUNT(c.id) as total_clientes
FROM vendedores v
LEFT JOIN clientes c ON v.id = c.vendedor_id AND c.activo = true
WHERE v.nombre ILIKE '%MARIO%SILVA%'
GROUP BY v.id, v.nombre, v.email;
