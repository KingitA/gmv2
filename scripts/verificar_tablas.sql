-- PASO 1: Ver todas las tablas que existen en tu base de datos
SELECT 
  table_schema,
  table_name,
  table_type
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- PASO 2: Si las tablas existen, ver su contenido
-- Ejecutá esto solo si el PASO 1 muestra que las tablas existen
SELECT 
  'comprobantes_compra' as tabla,
  COUNT(*) as total_registros
FROM comprobantes_compra
UNION ALL
SELECT 
  'comprobantes_compra_detalle' as tabla,
  COUNT(*) as total_registros
FROM comprobantes_compra_detalle;

-- PASO 3: Ver comprobantes con datos sospechosos (sin usar public.)
SELECT 
  id,
  numero_comprobante,
  tipo_comprobante,
  total_factura_declarado,
  total_calculado,
  created_at
FROM comprobantes_compra
WHERE total_calculado > 1000000000
   OR total_factura_declarado > 1000000000
ORDER BY created_at DESC;
