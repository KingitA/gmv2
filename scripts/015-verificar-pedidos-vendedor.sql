-- Verificar pedidos del vendedor Mario Silva
-- vendedor_id = e0e1ebd0-3bc3-4025-903d-54f1f2bf51ad

-- 1. Verificar datos del vendedor
SELECT 
    'DATOS DEL VENDEDOR' as tipo,
    id,
    nombre,
    email,
    activo
FROM vendedores
WHERE id = 'e0e1ebd0-3bc3-4025-903d-54f1f2bf51ad';

-- 2. Ver cuántos clientes tiene asignados
SELECT 
    'CLIENTES ASIGNADOS AL VENDEDOR' as tipo,
    COUNT(*) as total_clientes,
    COUNT(CASE WHEN activo = true THEN 1 END) as clientes_activos
FROM clientes
WHERE vendedor_id = 'e0e1ebd0-3bc3-4025-903d-54f1f2bf51ad';

-- 3. Ver todos los pedidos del vendedor
SELECT 
    'PEDIDOS DEL VENDEDOR' as tipo,
    p.id,
    p.numero_pedido,
    p.fecha,
    p.estado,
    p.total,
    p.cliente_id,
    c.nombre as cliente_nombre,
    p.vendedor_id
FROM pedidos p
LEFT JOIN clientes c ON p.cliente_id = c.id
WHERE p.vendedor_id = 'e0e1ebd0-3bc3-4025-903d-54f1f2bf51ad'
ORDER BY p.created_at DESC;

-- 4. Resumen de pedidos por estado
SELECT 
    'RESUMEN POR ESTADO' as tipo,
    estado,
    COUNT(*) as cantidad_pedidos,
    SUM(total) as total_monto
FROM pedidos
WHERE vendedor_id = 'e0e1ebd0-3bc3-4025-903d-54f1f2bf51ad'
GROUP BY estado;

-- 5. Ver si hay pedidos sin vendedor_id asignado
SELECT 
    'PEDIDOS SIN VENDEDOR' as tipo,
    COUNT(*) as pedidos_sin_vendedor
FROM pedidos
WHERE vendedor_id IS NULL;
