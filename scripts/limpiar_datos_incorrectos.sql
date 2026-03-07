-- Script para limpiar datos incorrectos del sistema de IA/OCR
-- Agregando schema "public" explícitamente para evitar errores

-- PASO 1: Identificar comprobantes con datos sospechosos
SELECT 
  c.id,
  c.numero_comprobante,
  c.tipo_comprobante,
  c.total_factura_declarado,
  c.total_calculado,
  COUNT(d.id) as items_count
FROM public.comprobantes_compra c
LEFT JOIN public.comprobantes_compra_detalle d ON c.id = d.comprobante_id
WHERE 
  c.total_calculado > 1000000000 -- Total mayor a mil millones (claramente incorrecto)
  OR d.cantidad_recibida > 10000 -- Cantidades absurdas (más de 10000 unidades)
  OR d.precio_unitario > 100000 -- Precios absurdos (más de $100000 por unidad)
GROUP BY c.id;

-- PASO 2: Eliminar items de comprobantes con datos incorrectos
-- IMPORTANTE: Ejecutá el PASO 1 primero para ver qué se va a eliminar
DELETE FROM public.comprobantes_compra_detalle
WHERE comprobante_id IN (
  SELECT DISTINCT c.id
  FROM public.comprobantes_compra c
  LEFT JOIN public.comprobantes_compra_detalle d ON c.id = d.comprobante_id
  WHERE 
    c.total_calculado > 1000000000
    OR d.cantidad_recibida > 10000
    OR d.precio_unitario > 100000
);

-- PASO 3: Verificar que se limpiaron correctamente
SELECT 
  c.id,
  c.numero_comprobante,
  c.tipo_comprobante,
  c.total_factura_declarado,
  c.total_calculado,
  COUNT(d.id) as items_count
FROM public.comprobantes_compra c
LEFT JOIN public.comprobantes_compra_detalle d ON c.id = d.comprobante_id
GROUP BY c.id
ORDER BY c.created_at DESC
LIMIT 10;
