-- Consulta para verificar RECEPCIÓN ID: 68417dfd-fc8d-4ecc-95c7-d85fbb1fac78
-- (Extraído de la URL del navegador)

-- Paso 1: Ver la cantidad documentada actual en recepciones_items
SELECT 
    a.descripcion,
    ri.cantidad_oc,
    ri.cantidad_documentada,
    ri.cantidad_fisica,
    ri.estado_linea
FROM recepciones_items ri
JOIN articulos a ON a.id = ri.articulo_id
WHERE ri.recepcion_id = '68417dfd-fc8d-4ecc-95c7-d85fbb1fac78'
  AND a.descripcion ILIKE '%golf%';

-- Paso 2: Ver qué leyó el OCR de cada documento
SELECT 
    rd.tipo_documento,
    rd.created_at,
    jsonb_pretty(rd.datos_ocr) as datos_ocr_completos
FROM recepciones_documentos rd
WHERE rd.recepcion_id = '68417dfd-fc8d-4ecc-95c7-d85fbb1fac78'
ORDER BY rd.created_at;

-- Paso 3: Extraer solo los items de GOLF de cada documento OCR
SELECT 
    rd.tipo_documento,
    rd.created_at,
    item->>'descripcion_ocr' as descripcion,
    item->>'cantidad' as cantidad_leida,
    item->>'precio_unitario' as precio
FROM recepciones_documentos rd,
LATERAL jsonb_array_elements(rd.datos_ocr->'items') as item
WHERE rd.recepcion_id = '68417dfd-fc8d-4ecc-95c7-d85fbb1fac78'
  AND item->>'descripcion_ocr' ILIKE '%golf%'
ORDER BY rd.created_at;
